//! Resumable large-file download. The file is fetched as consecutive `Range` segments appended to
//! a `.part` file, so a stalled or dropped connection only costs the current segment and a
//! restarted launcher continues from the bytes already on disk. Each segment has its own timeout,
//! so a slow-but-moving download is never cut off by one total deadline. A server that ignores
//! `Range` (some public proxies) is handled by streaming the whole body once.
use anyhow::{anyhow, bail, ensure, Context, Result};
use reqwest::{blocking::Client, header, StatusCode};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    thread,
    time::{Duration, Instant},
};

pub const SEGMENT_BYTES: u64 = 8 * 1024 * 1024;
const SEGMENT_TIMEOUT: Duration = Duration::from_secs(120);
const WHOLE_TIMEOUT: Duration = Duration::from_secs(1800);
const SEGMENT_ATTEMPTS: u32 = 3;

pub struct Options {
    /// Hard size limit for the finished file.
    pub max: u64,
    pub segment: u64,
    pub segment_timeout: Duration,
    /// Deadline for the single request used when the server does not honour `Range`.
    pub whole_timeout: Duration,
}

impl Options {
    pub fn new(max: u64) -> Self {
        Self {
            max,
            segment: SEGMENT_BYTES,
            segment_timeout: SEGMENT_TIMEOUT,
            whole_timeout: WHOLE_TIMEOUT,
        }
    }
}

/// `bytes 0-8388607/314572800` -> (start, end, total)
fn parse_content_range(value: &str) -> Option<(u64, u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let total = match total.trim() {
        "*" => None,
        number => Some(number.parse().ok()?),
    };
    Some((start.trim().parse().ok()?, end.trim().parse().ok()?, total))
}

fn read_limited(mut reader: impl Read, limit: u64, sink: &mut Vec<u8>) -> Result<()> {
    reader.by_ref().take(limit + 1).read_to_end(sink)?;
    ensure!(sink.len() as u64 <= limit, "下载内容超过预期大小");
    Ok(())
}

/// Streams a complete body into `part` (truncating it), reporting progress about once a second.
fn stream_whole(
    response: reqwest::blocking::Response,
    part: &Path,
    max: u64,
    progress: &dyn Fn(u64, Option<u64>),
) -> Result<u64> {
    let total = response.content_length();
    ensure!(total.unwrap_or(0) <= max, "下载内容超过大小上限");
    let mut file = File::create(part)?;
    let mut response = response.take(max + 1);
    let mut count = 0u64;
    let mut buffer = [0u8; 65536];
    let mut last = Instant::now();
    loop {
        let n = response.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        count += n as u64;
        ensure!(count <= max, "下载内容超过大小上限");
        file.write_all(&buffer[..n])?;
        if last.elapsed() >= Duration::from_secs(1) {
            progress(count, total);
            last = Instant::now();
        }
    }
    file.sync_all()?;
    ensure!(count > 0, "下载内容为空");
    Ok(count)
}

enum Segment {
    /// Bytes appended; `total` is the full size when the server reported it.
    Appended { total: Option<u64>, short: bool },
    /// The server answered 200 with the whole body instead of the requested range.
    RangeIgnored,
}

fn fetch_segment(client: &Client, url: &str, part: &Path, have: u64, options: &Options) -> Result<Segment> {
    let wanted = options.segment.min(options.max.saturating_sub(have) + 1);
    let response = client
        .get(url)
        .header(header::RANGE, format!("bytes={have}-{}", have + wanted - 1))
        .timeout(options.segment_timeout)
        .send()
        .context("连接下载站失败")?;
    match response.status() {
        StatusCode::PARTIAL_CONTENT => {
            let range = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_content_range)
                .context("下载站返回的 Content-Range 无效")?;
            ensure!(range.0 == have, "下载站返回的片段起点与请求不一致");
            let expected = range.1.checked_sub(range.0).map(|n| n + 1).context("下载站返回的片段范围无效")?;
            ensure!(expected <= wanted, "下载站返回了超出请求的片段");
            let mut buffer = Vec::with_capacity(expected as usize);
            read_limited(response, expected, &mut buffer).context("读取下载片段失败")?;
            ensure!(buffer.len() as u64 == expected, "下载片段被截断");
            let mut file = OpenOptions::new().create(true).append(true).open(part)?;
            ensure!(file.metadata()?.len() == have, "续传文件与已记录的进度不一致");
            file.write_all(&buffer)?;
            file.sync_all()?;
            Ok(Segment::Appended {
                total: range.2,
                short: expected < wanted,
            })
        }
        // The part file already holds the whole file (`bytes */<total>`).
        StatusCode::RANGE_NOT_SATISFIABLE if have > 0 => {
            let total = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().strip_prefix("bytes */"))
                .and_then(|v| v.trim().parse::<u64>().ok());
            if total == Some(have) {
                return Ok(Segment::Appended { total, short: true });
            }
            let _ = fs::remove_file(part);
            bail!("续传文件与服务器不一致，已丢弃重下")
        }
        // Dropping the response closes the connection without reading the body.
        StatusCode::OK => Ok(Segment::RangeIgnored),
        status => bail!("下载返回 HTTP {}", status.as_u16()),
    }
}

/// One request for the complete body, for servers that do not honour `Range`.
fn fetch_whole(client: &Client, url: &str, part: &Path, options: &Options, progress: &dyn Fn(u64, Option<u64>)) -> Result<u64> {
    let mut failure = None;
    for attempt in 1..=SEGMENT_ATTEMPTS {
        let result = client
            .get(url)
            .timeout(options.whole_timeout)
            .send()
            .context("连接下载站失败")
            .and_then(|response| {
                ensure!(response.status().is_success(), "下载返回 HTTP {}", response.status().as_u16());
                stream_whole(response, part, options.max, progress)
            });
        match result {
            Ok(size) => return Ok(size),
            Err(error) => {
                let _ = fs::remove_file(part);
                failure = Some(error);
                thread::sleep(Duration::from_secs(u64::from(attempt)));
            }
        }
    }
    Err(failure.unwrap_or_else(|| anyhow!("下载失败")))
}

/// Bytes each URL delivers within `window` (0 when it fails to answer). The free public proxies
/// differ by more than 50x in throughput and often drop connections, so the order in which they
/// are tried matters more than any retry policy.
pub fn measure(client: &Client, urls: &[String], window: Duration) -> Vec<u64> {
    thread::scope(|scope| {
        let handles: Vec<_> = urls
            .iter()
            .map(|url| {
                scope.spawn(move || {
                    let started = Instant::now();
                    let Ok(mut response) = client.get(url).timeout(window).send() else { return 0 };
                    if !response.status().is_success() {
                        return 0;
                    }
                    let mut count = 0u64;
                    let mut buffer = [0u8; 65536];
                    while started.elapsed() < window {
                        match response.read(&mut buffer) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => count += n as u64,
                        }
                    }
                    count
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or(0)).collect()
    })
}

/// Downloads `url` into `part`, continuing from whatever is already there. Returns the final size;
/// the caller verifies content (digest / archive structure) and moves the file into place.
pub fn fetch_to_file(
    client: &Client,
    url: &str,
    part: &Path,
    options: &Options,
    progress: &dyn Fn(u64, Option<u64>),
) -> Result<u64> {
    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > options.max {
        let _ = fs::remove_file(part);
        have = 0;
    }
    let mut total: Option<u64> = None;
    let mut last = Instant::now();
    loop {
        if let Some(total) = total {
            if have == total {
                return Ok(have);
            }
            ensure!(have < total, "续传文件比服务器报告的大小还大");
        }
        ensure!(have <= options.max, "下载内容超过大小上限");
        let mut attempt = 0;
        let outcome = loop {
            attempt += 1;
            match fetch_segment(client, url, part, have, options) {
                Ok(outcome) => break outcome,
                Err(error) if attempt < SEGMENT_ATTEMPTS => {
                    let _ = error;
                    thread::sleep(Duration::from_secs(u64::from(attempt)));
                }
                Err(error) => {
                    return Err(error.context(format!(
                        "下载片段连续 {SEGMENT_ATTEMPTS} 次失败（已保留 {have} 字节，下次可继续）"
                    )))
                }
            }
        };
        match outcome {
            Segment::RangeIgnored => {
                let _ = fs::remove_file(part);
                return fetch_whole(client, url, part, options, progress);
            }
            Segment::Appended { total: reported, short } => {
                have = fs::metadata(part)?.len();
                total = reported.or(total);
                if last.elapsed() >= Duration::from_secs(1) {
                    progress(have, total);
                    last = Instant::now();
                }
                if total.is_none() && short {
                    return Ok(have);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_range() {
        assert_eq!(parse_content_range("bytes 0-99/1000"), Some((0, 99, Some(1000))));
        assert_eq!(parse_content_range("bytes 100-199/*"), Some((100, 199, None)));
        assert_eq!(parse_content_range("bytes */1000"), None);
        assert_eq!(parse_content_range("items 0-1/2"), None);
    }

    /// Minimal one-file HTTP server. `honour_range = false` mimics proxies that always send 200.
    fn serve(body: Vec<u8>, honour_range: bool) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::{io::{BufRead, BufReader}, net::TcpListener, sync::{atomic::{AtomicUsize, Ordering}, Arc}};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        let (a, b) = value.trim().split_once('-').unwrap();
                        range = Some((a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap()));
                    }
                }
                let mut stream = stream;
                let total = body.len();
                let _ = match range.filter(|_| honour_range) {
                    Some((start, _)) if start >= total => write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                    Some((start, end)) => {
                        let end = end.min(total - 1);
                        let chunk = &body[start..=end];
                        write!(stream, "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", chunk.len())
                            .and_then(|_| stream.write_all(chunk))
                    }
                    None => write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n").and_then(|_| stream.write_all(&body)),
                };
            }
        });
        (url, hits)
    }

    fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("yingce-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn small(max: u64) -> Options {
        Options { segment: 4096, ..Options::new(max) }
    }

    #[test]
    fn downloads_in_segments_and_resumes_from_existing_bytes() {
        let body = payload(20_000);
        let (url, hits) = serve(body.clone(), true);
        let dir = scratch("resume");
        let client = Client::new();

        let fresh = dir.join("fresh.part");
        assert_eq!(fetch_to_file(&client, &url, &fresh, &small(1 << 20), &|_, _| {}).unwrap(), 20_000);
        assert_eq!(fs::read(&fresh).unwrap(), body);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 5, "20000 bytes in 4096-byte segments");

        // A previous run was interrupted after 10000 bytes: only the rest is requested.
        let resumed = dir.join("resumed.part");
        fs::write(&resumed, &body[..10_000]).unwrap();
        let before = hits.load(std::sync::atomic::Ordering::SeqCst);
        fetch_to_file(&client, &url, &resumed, &small(1 << 20), &|_, _| {}).unwrap();
        assert_eq!(fs::read(&resumed).unwrap(), body);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst) - before, 3);

        // The part file is already complete: the 416 answer ends the download.
        fetch_to_file(&client, &url, &resumed, &small(1 << 20), &|_, _| {}).unwrap();
        assert_eq!(fs::read(&resumed).unwrap(), body);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn servers_that_ignore_range_still_deliver_the_whole_file() {
        let body = payload(9_000);
        let (url, _) = serve(body.clone(), false);
        let dir = scratch("whole");
        let part = dir.join("a.part");
        // Stale bytes from an earlier attempt must not survive a restart from zero.
        fs::write(&part, b"stale").unwrap();
        fetch_to_file(&Client::new(), &url, &part, &small(1 << 20), &|_, _| {}).unwrap();
        assert_eq!(fs::read(&part).unwrap(), body);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn size_limit_is_enforced() {
        let (url, _) = serve(payload(20_000), true);
        let dir = scratch("limit");
        let part = dir.join("a.part");
        assert!(fetch_to_file(&Client::new(), &url, &part, &small(10_000), &|_, _| {}).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
