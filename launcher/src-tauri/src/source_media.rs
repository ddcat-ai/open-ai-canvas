//! Optional, release-local FFmpeg tools. The caller owns staging/publication and PATH.
use anyhow::{ensure, Context, Result};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const NOTICE: &str = "FFmpeg redistribution notice\n\
This directory contains FFmpeg and ffprobe, not code covered by the launcher's license.\n\
Their upstream license is included as LICENSE; retain it when redistributing these tools.\n\
FFmpeg builds may be LGPL or GPL; source-distribution obligations follow that license.\n\
FFmpeg project and corresponding source: https://ffmpeg.org/\n\
For a Gyan build, build information/source links: https://www.gyan.dev/ffmpeg/builds/\n\
Review the included license and upstream source/build information before redistribution.\n";

/// Return true only when both release-local executables pass isolated version probes.
/// Missing/self-contained-incompatible host tools are optional on Unix (Ok(false)).
/// Windows instead downloads a digest-pinned portable build; download errors propagate.
/// The caller must supply a staging release with no existing runtime/media directory.
pub fn prepare_media(release: &Path, cache: &Path) -> Result<bool> {
    let runtime = release.join("runtime");
    fs::create_dir_all(&runtime)?;
    let runtime = fs::canonicalize(runtime)?;
    let destination = runtime.join("media");
    ensure!(
        !destination.exists(),
        "runtime/media already exists; use a fresh staging release"
    );
    // The caller already owns an unpublished release staging tree. Do not rename
    // a nested directory after Windows loader/antivirus probes have opened its EXEs.
    fs::create_dir(&destination)?;
    let result = prepare_in(&destination, cache);
    if !matches!(&result, Ok(true)) { let _ = fs::remove_dir_all(&destination); }
    result
}

#[cfg(test)]
fn new_staging(runtime: &Path) -> Result<PathBuf> {
    for index in 0..100 {
        let path = runtime.join(format!(".media-prepare-{}-{index}", std::process::id()));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    anyhow::bail!("Cannot allocate media staging directory")
}

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn prepare_in(media: &Path, cache: &Path) -> Result<bool> {
    let bin = media.join("bin");
    fs::create_dir(&bin)?;
    // Host PATH is used only for discovery/probing, never saved into the release.
    for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
        if !directory.is_absolute() {
            continue;
        }
        let ffmpeg = directory.join(executable("ffmpeg"));
        let ffprobe = directory.join(executable("ffprobe"));
        let license = directory.parent().map(|root| root.join("LICENSE"));
        if !ffmpeg.is_file()
            || !ffprobe.is_file()
            || !license.as_ref().map(|p| p.is_file()).unwrap_or(false)
            || !probe(&ffmpeg, None)
            || !probe(&ffprobe, None)
        {
            continue;
        }
        // Only the executables and license: no DLLs or arbitrary host tool directories.
        let copied = (|| -> Result<bool> {
            fs::copy(&ffmpeg, bin.join(executable("ffmpeg")))?;
            fs::copy(&ffprobe, bin.join(executable("ffprobe")))?;
            let license = license.as_ref().context("FFmpeg license is missing")?;
            ensure!(
                fs::metadata(license)?.len() <= 4 * 1024 * 1024,
                "FFmpeg license is too large"
            );
            fs::copy(license, media.join("LICENSE"))?;
            Ok(probe_pair(&bin))
        })();
        if copied.unwrap_or(false) {
            fs::write(media.join("REDISTRIBUTION.txt"), NOTICE)?;
            return Ok(true);
        }
        // Remove only files written in our exclusively-created staging directory.
        for path in [
            bin.join(executable("ffmpeg")),
            bin.join(executable("ffprobe")),
            media.join("LICENSE"),
        ] {
            if path.exists() {
                fs::remove_file(path)?;
            }
        }
    }
    #[cfg(windows)]
    {
        portable::install(media, cache)?;
        ensure!(
            probe_pair(&bin),
            "Portable FFmpeg failed the isolated version probe"
        );
        fs::write(media.join("REDISTRIBUTION.txt"), NOTICE)?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = cache;
        Ok(false)
    }
}

fn probe_pair(bin: &Path) -> bool {
    probe(&bin.join(executable("ffmpeg")), Some(bin))
        && probe(&bin.join(executable("ffprobe")), Some(bin))
}

fn probe(executable: &Path, isolated_bin: Option<&Path>) -> bool {
    let mut command = Command::new(executable);
    command
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(bin) = isolated_bin {
        command.env_clear().current_dir(bin);
        let mut paths = vec![bin.to_path_buf()];
        #[cfg(windows)]
        {
            // Keep only Windows' OS directory, not the developer's DLL search PATH.
            let Some(root) = env::var_os("SystemRoot") else {
                return false;
            };
            let root = PathBuf::from(root);
            if !root.is_absolute() {
                return false;
            }
            paths.push(root.join("System32"));
            command.env("SystemRoot", &root).env("WINDIR", &root);
        }
        let Ok(path) = env::join_paths(&paths) else {
            return false;
        };
        command.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW; a failed/hung loader probe is bounded by the timeout below.
        command.creation_flags(0x08000000);
    }
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < Duration::from_secs(15) => {
                thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "copies installed media tools or explicitly downloads verified portable tools"]
    fn media_tools_live_probe() {
        let root = PathBuf::from(env::var_os("YINGCE_MEDIA_SMOKE_ROOT").expect("isolated root required"));
        fs::create_dir_all(&root).unwrap();
        let release = new_staging(&root).unwrap();
        let cache = root.join("cache"); fs::create_dir_all(&cache).unwrap();
        assert!(prepare_media(&release, &cache).unwrap());
        assert!(probe_pair(&release.join("runtime/media/bin")));
        println!("MEDIA_READY={}", release.display());
    }
}
#[cfg(windows)]
mod portable {
    use super::*;
    use reqwest::{blocking::Client, redirect::Policy};
    use sha2::{Digest, Sha256};
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Write},
    };
    use zip::ZipArchive;

    // Pinned from the response to SOURCE_SHA_URL. No mutable "latest" metadata is used.
    const SOURCE_SHA_URL: &str =
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
    const ZIP_URL: &str =
        "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip";
    const SHA256: &str = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
    const ROOT: &str = "ffmpeg-9.0.2-essentials_build";
    const MAX_ARCHIVE: u64 = 500 * 1024 * 1024;
    const MAX_BINARY: u64 = 200 * 1024 * 1024;
    const MAX_TEXT: u64 = 4 * 1024 * 1024;
    const MAX_EXPANDED: u64 = 1500 * 1024 * 1024;

    fn trusted_url(url: &reqwest::Url) -> bool {
        url.scheme() == "https"
            && url.host_str() == Some("www.gyan.dev")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
            && url.path().starts_with("/ffmpeg/builds/packages/")
            && url.query().is_none()
            && url.fragment().is_none()
    }

    fn verified(path: &Path) -> Result<bool> {
        let mut file = File::open(path)?;
        if file.metadata()?.len() > MAX_ARCHIVE {
            return Ok(false);
        }
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut count = 0u64;
        loop {
            let size = file.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            count += size as u64;
            if count > MAX_ARCHIVE {
                return Ok(false);
            }
            digest.update(&buffer[..size]);
        }
        Ok(hex::encode(digest.finalize()) == SHA256)
    }

    pub(super) fn install(media: &Path, cache: &Path) -> Result<()> {
        fs::create_dir_all(cache)?;
        let archive = cache.join(format!("ffmpeg-9.0.2-{SHA256}.zip"));
        if !archive.is_file() || !verified(&archive)? {
            let client = Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(30))
                .timeout(Duration::from_secs(600))
                .user_agent("yingce-launcher-media")
                .redirect(Policy::custom(|attempt| {
                    if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                        attempt.error("FFmpeg redirect is outside the trusted Gyan packages host")
                    } else {
                        attempt.follow()
                    }
                }))
                .build()?;
            let url = reqwest::Url::parse(ZIP_URL)?;
            ensure!(trusted_url(&url), "Invalid pinned FFmpeg URL");
            let response = client.get(url).send()?.error_for_status()?;
            ensure!(trusted_url(response.url()), "Untrusted FFmpeg response URL");
            ensure!(
                response.content_length().unwrap_or(0) <= MAX_ARCHIVE,
                "FFmpeg archive exceeds 500 MiB"
            );
            let (temporary, mut file) = new_download(cache)?;
            let downloaded = (|| -> Result<()> {
                let bytes = std::io::copy(&mut response.take(MAX_ARCHIVE + 1), &mut file)?;
                ensure!(bytes <= MAX_ARCHIVE, "FFmpeg archive exceeds 500 MiB");
                file.flush()?;
                ensure!(verified(&temporary)?, "FFmpeg archive SHA-256 mismatch");
                Ok(())
            })();
            drop(file);
            if let Err(error) = downloaded {
                let _ = fs::remove_file(&temporary);
                return Err(error);
            }
            if archive.exists() {
                fs::remove_file(&archive)?;
            }
            if let Err(error) = fs::rename(&temporary, &archive) {
                let _ = fs::remove_file(&temporary);
                return Err(error.into());
            }
        }
        // Verify on every use, including a cache hit, before opening any ZIP entry.
        ensure!(verified(&archive)?, "Cached FFmpeg SHA-256 mismatch");
        extract(&archive, media)?;
        fs::write(media.join("SOURCE.txt"), format!(
            "FFmpeg 9.0.2 Gyan essentials build\nArchive: {ZIP_URL}\nSHA256: {SHA256}\nOriginal checksum source: {SOURCE_SHA_URL}\n"
        ))?;
        Ok(())
    }

    fn new_download(cache: &Path) -> Result<(PathBuf, File)> {
        for index in 0..100 {
            let path = cache.join(format!(
                ".ffmpeg-download-{}-{index}.tmp",
                std::process::id()
            ));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => return Ok((path, file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        anyhow::bail!("Cannot allocate FFmpeg download file")
    }

    fn extract(archive: &Path, media: &Path) -> Result<()> {
        let mut archive = ZipArchive::new(File::open(archive)?)?;
        ensure!(archive.len() <= 256, "Too many FFmpeg ZIP entries");
        let mut expanded = 0u64;
        let mut seen = [false; 4];
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            let name = entry.name().to_owned();
            ensure!(
                !name.contains('\\')
                    && !name.contains(':')
                    && !name.chars().any(|c| c.is_control()),
                "Unsafe FFmpeg ZIP path"
            );
            let trimmed = name.trim_end_matches('/');
            let parts: Vec<_> = trimmed.split('/').collect();
            ensure!(
                parts.first() == Some(&ROOT)
                    && parts
                        .iter()
                        .all(|p| !p.is_empty() && *p != "." && *p != ".."),
                "Unexpected FFmpeg ZIP root or path traversal"
            );
            if let Some(mode) = entry.unix_mode() {
                let kind = mode & 0o170000;
                ensure!(
                    kind == 0 || kind == 0o100000 || kind == 0o040000,
                    "FFmpeg ZIP links/special files are forbidden"
                );
            }
            expanded = expanded
                .checked_add(entry.size())
                .context("FFmpeg ZIP size overflow")?;
            ensure!(
                expanded <= MAX_EXPANDED,
                "FFmpeg ZIP expanded size is excessive"
            );
            if entry.is_dir() {
                continue;
            }
            let relative = parts[1..].join("/");
            let selected = match relative.as_str() {
                "bin/ffmpeg.exe" => Some((0, "bin/ffmpeg.exe", MAX_BINARY)),
                "bin/ffprobe.exe" => Some((1, "bin/ffprobe.exe", MAX_BINARY)),
                "LICENSE" => Some((2, "LICENSE", MAX_TEXT)),
                "README" | "README.txt" => Some((3, "README.txt", MAX_TEXT)),
                _ => None,
            };
            if let Some((slot, destination, cap)) = selected {
                ensure!(!seen[slot], "Duplicate FFmpeg ZIP entry");
                ensure!(
                    entry.size() > 0 && entry.size() <= cap,
                    "FFmpeg ZIP entry size invalid"
                );
                let expected = entry.size();
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(media.join(destination))?;
                let copied = std::io::copy(&mut (&mut entry).take(cap + 1), &mut output)?;
                ensure!(
                    copied == expected && copied <= cap,
                    "FFmpeg ZIP entry size mismatch"
                );
                seen[slot] = true;
            }
        }
        ensure!(
            seen.iter().all(|found| *found),
            "FFmpeg ZIP lacks tools, LICENSE or README"
        );
        Ok(())
    }
}
