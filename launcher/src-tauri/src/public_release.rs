//! Public GitHub branch metadata. No signing keys, private API, or credentials.
use anyhow::{bail, ensure, Context, Result};
use reqwest::{blocking::Client, header, StatusCode};
use serde::Deserialize;
use std::{io::Read, time::Duration};
use url::Url;

pub const REPOSITORY_URL: &str = "https://github.com/ddcat-ai/open-ai-canvas";
pub const DEFAULT_API_ROOT: &str = "https://api.github.com/repos/ddcat-ai/open-ai-canvas/";
const MAX_JSON_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TREE_JSON_BYTES: u64 = 24 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 50_000;
/// Fixed tracked branch of the upstream repository.
pub const TRACKED_BRANCH: &str = "main";

/// Tip of the tracked branch. The upstream publishes no GitHub Releases.
#[derive(Debug, Clone)]
pub struct PublicRelease {
    pub version: String,
    pub commit: String,
    pub notes: String,
}

#[derive(Deserialize)]
struct CommitJson {
    sha: String,
    commit: Option<CommitDetail>,
}

#[derive(Deserialize)]
struct CommitDetail {
    message: Option<String>,
}

fn validate_api_root(api_root: &Url) -> Result<()> {
    ensure!(
        api_root.as_str() == DEFAULT_API_ROOT
            || crate::core::PUBLIC_MIRRORS
                .iter()
                .any(|host| api_root.as_str() == format!("https://{host}/{DEFAULT_API_ROOT}")),
        "源码来源仅支持影策官方 GitHub API 或已知 HTTPS 代理的官方仓库前缀。"
    );
    Ok(())
}

fn get_json<T: serde::de::DeserializeOwned>(client: &Client, url: &Url, limit: u64) -> Result<T> {
    let response = client
        .get(url.clone())
        .header(header::USER_AGENT, "yingce-launcher")
        .header(header::ACCEPT, "application/vnd.github+json")
        .timeout(Duration::from_secs(30))
        .send()
        .context("无法连接 GitHub 发布服务，请检查网络后重试。")?;
    match response.status() {
        StatusCode::NOT_FOUND => {
            bail!("GitHub 未找到上游仓库或默认分支。")
        }
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            bail!("GitHub 请求受限（可能超过匿名访问频率或访问被拒绝），请稍后重试。")
        }
        status if !status.is_success() => {
            bail!("GitHub 发布服务返回 HTTP {}，请稍后重试。", status.as_u16())
        }
        _ => {}
    }
    ensure!(response.url() == url, "GitHub API 返回了非预期重定向。");
    ensure!(
        response.content_length().unwrap_or(0) <= limit,
        "GitHub 发布信息过大，已停止读取。"
    );
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .context("读取 GitHub 发布信息失败，请重试。")?;
    ensure!(
        bytes.len() as u64 <= limit,
        "GitHub 发布信息过大，已停止读取。"
    );
    serde_json::from_slice(&bytes).context("GitHub 发布信息格式无效。")
}

fn parse_commit(json: CommitJson) -> Result<PublicRelease> {
    ensure!(
        (json.sha.len() == 40 || json.sha.len() == 64)
            && json.sha.bytes().all(|b| b.is_ascii_hexdigit()),
        "GitHub 分支对应的提交编号无效。"
    );
    let commit = json.sha.to_ascii_lowercase();
    let notes = json
        .commit
        .and_then(|c| c.message)
        .unwrap_or_default()
        .chars()
        .take(2000)
        .collect();
    Ok(PublicRelease {
        version: format!("{TRACKED_BRANCH}-{}", &commit[..7]),
        commit,
        notes,
    })
}

/// Resolves the current full commit of the tracked branch.
pub fn fetch_latest(client: &Client, api_root: &Url) -> Result<PublicRelease> {
    validate_api_root(api_root)?;
    let mut commit_url = api_root.join("commits/")?;
    commit_url
        .path_segments_mut()
        .map_err(|_| anyhow::anyhow!("无法构造 GitHub 提交地址。"))?
        .pop_if_empty()
        .push(TRACKED_BRANCH);
    parse_commit(get_json(client, &commit_url, MAX_JSON_BYTES)?)
}

/// One regular file of a commit tree, as listed by GitHub (`blob` is the git object id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeEntry {
    pub path: String,
    pub sha: String,
    pub size: u64,
    pub executable: bool,
}

#[derive(Deserialize)]
struct TreeJson {
    truncated: bool,
    tree: Vec<TreeNode>,
}

#[derive(Deserialize)]
struct TreeNode {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
    size: Option<u64>,
}

fn parse_tree(json: TreeJson) -> Result<Vec<TreeEntry>> {
    ensure!(!json.truncated, "GitHub 目录清单被截断，无法做增量更新。");
    ensure!(json.tree.len() <= MAX_TREE_ENTRIES, "GitHub 目录清单过大。");
    let mut entries = Vec::new();
    for node in json.tree {
        if node.kind == "tree" {
            continue;
        }
        // Symlinks and submodules are never part of the managed source layout.
        ensure!(
            node.kind == "blob" && (node.mode == "100644" || node.mode == "100755"),
            "目录清单含有链接或子模块，改用完整源码包。"
        );
        ensure!(
            node.sha.len() == 40 && node.sha.bytes().all(|b| b.is_ascii_hexdigit()),
            "目录清单中的对象编号无效。"
        );
        entries.push(TreeEntry {
            path: node.path,
            sha: node.sha.to_ascii_lowercase(),
            size: node.size.context("目录清单缺少文件大小。")?,
            executable: node.mode == "100755",
        });
    }
    Ok(entries)
}

/// Lists every file of `commit` (one request, no per-file API calls).
pub fn fetch_tree(client: &Client, api_root: &Url, commit: &str) -> Result<Vec<TreeEntry>> {
    validate_api_root(api_root)?;
    ensure!(
        commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()),
        "无效源码提交号。"
    );
    let mut url = api_root.join("git/trees/")?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("无法构造 GitHub 目录地址。"))?
        .pop_if_empty()
        .push(commit);
    url.set_query(Some("recursive=1"));
    parse_tree(get_json(client, &url, MAX_TREE_JSON_BYTES)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(value: serde_json::Value) -> Result<PublicRelease> {
        parse_commit(serde_json::from_value(value)?)
    }

    #[test]
    fn resolves_branch_tip_to_full_commit_and_version() {
        let release = parse(json!({"sha": "AB".repeat(20), "commit": {"message": "fix: 示例

正文"}})).unwrap();
        assert_eq!(release.commit, "ab".repeat(20));
        assert_eq!(release.version, "main-abababa");
        assert!(release.notes.starts_with("fix: 示例"));
        assert!(parse(json!({"sha": "b".repeat(40)})).unwrap().notes.is_empty());
    }

    #[test]
    fn rejects_non_commit_sha() {
        for sha in ["main", "abc", &"z".repeat(40)] {
            assert!(parse(json!({"sha": sha})).is_err(), "{sha}");
        }
    }

    #[test]
    fn parses_tree_and_rejects_links_or_truncation() {
        let ok = json!({"truncated": false, "tree": [
            {"path": "a", "mode": "040000", "type": "tree", "sha": "a".repeat(40)},
            {"path": "a/b.txt", "mode": "100644", "type": "blob", "sha": "B".repeat(40), "size": 3},
            {"path": "run.sh", "mode": "100755", "type": "blob", "sha": "c".repeat(40), "size": 9}
        ]});
        let entries = parse_tree(serde_json::from_value(ok).unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sha, "b".repeat(40));
        assert!(entries[1].executable && !entries[0].executable);
        for bad in [
            json!({"truncated": true, "tree": []}),
            json!({"truncated": false, "tree": [{"path": "l", "mode": "120000", "type": "blob", "sha": "a".repeat(40), "size": 1}]}),
            json!({"truncated": false, "tree": [{"path": "s", "mode": "160000", "type": "commit", "sha": "a".repeat(40)}]}),
            json!({"truncated": false, "tree": [{"path": "x", "mode": "100644", "type": "blob", "sha": "zz", "size": 1}]}),
            json!({"truncated": false, "tree": [{"path": "x", "mode": "100644", "type": "blob", "sha": "a".repeat(40)}]}),
        ] {
            assert!(parse_tree(serde_json::from_value(bad).unwrap()).is_err());
        }
    }

    #[test]
    fn accepts_only_exact_official_api_or_known_proxy_prefix() {
        assert!(validate_api_root(&Url::parse(DEFAULT_API_ROOT).unwrap()).is_ok());
        for host in crate::core::PUBLIC_MIRRORS {
            assert!(validate_api_root(
                &Url::parse(&format!("https://{host}/{DEFAULT_API_ROOT}")).unwrap()
            )
            .is_ok());
        }
        for root in [
            "http://api.github.com/repos/ddcat-ai/open-ai-canvas/",
            "https://api.github.com/repos/other/open-ai-canvas/",
            "https://api.github.com/repos/ddcat-ai/open-ai-canvas/?x=1",
            "https://proxy.example/https://api.github.com/repos/ddcat-ai/open-ai-canvas/",
        ] {
            assert!(validate_api_root(&Url::parse(root).unwrap()).is_err());
        }
    }
}
