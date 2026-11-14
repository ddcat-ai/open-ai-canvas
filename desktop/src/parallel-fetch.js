// 跨境多连接并行下载器：electron-updater 的差分与全量下载都走单一 TCP 连接，
// 跨境链路下单连接常被压到几十 KB/s。此模块在 updater 下载前用 6 个分块连接
// 把安装器预取到 updater 缓存的 pending 路径并写好 update-info.json，
// electron-updater 随后的 sha512 校验命中即直接复用，不再走它自己的慢速下载。
// 对外仅导出 prefetchUpdateInstaller()，供 main.js 的 checkForUpdates 调用。
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CHUNK = 4 * 1024 * 1024; // 4MB/连接分块（小分块在慢连接上更快完成，重试代价也小）
// 实测跨境扩缩性：单连接 20-600KB/s 波动，6 连接 ~700KB/s，12 连接 ~895KB/s（次线性）。
// 取 8 折中：聚合约 800KB/s，同时 100 个用户并发更新对 4 核源站也只是 800 连接的短峰。
const PARALLEL = 8;
const CHUNK_TRIES = 4; // 单个分块最多尝试 4 次（跨境连接会被重置，必须可重试）

function requestOnce(url, range, cb) {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? require("http") : require("https");
    const req = mod.request(
        { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET" },
        (res) => cb(res),
    );
    if (range) req.setHeader("Range", `bytes=${range}`);
    req.setHeader("User-Agent", "PeekReel-Updater/1.0");
    // req.setTimeout 是套接字空闲超时（非总时长）：连续 45 秒无任何数据才算死
    req.setTimeout(45_000, () => req.destroy(new Error("socket idle")));
    req.on("error", () => { /* 由回调方统一处理 */ });
    req.end();
    return req;
}

// 取 0-1 字节探测：一次请求拿到 总大小 / 是否支持 Range，避免全量 GET 排水。
function probeFile(url) {
    return new Promise((resolve, reject) => {
        requestOnce(url, "0-1", (res) => {
            res.resume();
            res.on("end", () => { /* body 只有 1 字节 */ });
            if (res.statusCode === 206) {
                // content-range: bytes 0-1/276958581
                const m = /\/(\d+)$/.exec(res.headers["content-range"] || "");
                if (!m) return reject(new Error("no content-range on 206"));
                return resolve({ size: Number(m[1]), ranged: true });
            }
            if (res.statusCode === 200) {
                const len = Number(res.headers["content-length"]);
                if (!len) return reject(new Error("no content-length"));
                return resolve({ size: len, ranged: false });
            }
            reject(new Error(`HTTP ${res.statusCode} on probe`));
        });
        // requestOnce 的 req 错误会以无响应结束：补充超时兜底
        setTimeout(() => reject(new Error("probe timeout")), 30_000).unref();
    });
}

// 下载单个字节区间（带重试）。30x 跟随、非 206/200 视为失败重试。
function fetchRange(url, start, end) {
    return new Promise((resolve, reject) => {
        const attempt = (tries, redirected) => {
            if (tries > CHUNK_TRIES) return reject(new Error(`chunk ${start}-${end} failed after ${CHUNK_TRIES} tries`));
            requestOnce(redirected || url, `${start}-${end}`, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    const next = new URL(res.headers.location, redirected || url).toString();
                    return attempt(tries, next);
                }
                if (res.statusCode !== 206) {
                    res.resume();
                    return setTimeout(() => attempt(tries + 1, redirected), 1000);
                }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    if (buf.length !== end - start + 1) return attempt(tries + 1, redirected); // 不完整
                    resolve(buf);
                });
                res.on("error", () => setTimeout(() => attempt(tries + 1, redirected), 1000));
            }).on("error", () => setTimeout(() => attempt(tries + 1, redirected), 1000));
        };
        attempt(0);
    });
}

function sha512Base64(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha512");
        const stream = fs.createReadStream(file);
        stream.on("data", (c) => hash.update(c));
        stream.on("end", () => resolve(hash.digest("base64")));
        stream.on("error", reject);
    });
}

/**
 * 预取安装器到 electron-updater 缓存。
 * @param {string} feedUrl 更新源（…/updates/）
 * @param {object} updateInfo latest.yml 数据 {version, files:[{url, sha512, size}]}（url 可为相对名）
 * @param {(percent:number)=>void} onProgress 进度回调（0-100）
 * @returns {Promise<boolean>} 文件就位且校验通过返回 true；任何失败返回 false（调用方回退原生路径）
 */
async function prefetchUpdateInstaller(feedUrl, updateInfo, onProgress, cacheDir) {
    if (!cacheDir || !path.isAbsolute(cacheDir)) throw new Error("Updater cache directory must be absolute");
    try {
        const file = (updateInfo.files || []).find((f) => /\.exe$/i.test(String(f.url || "")));
        if (!file || !file.sha512) return false;
        const base = feedUrl.endsWith("/") ? feedUrl : feedUrl + "/";
        const url = new URL(file.url, base).toString();
        const fileName = path.basename(new URL(url).pathname);
        const pendingDir = path.join(cacheDir, "pending");
        fs.mkdirSync(pendingDir, { recursive: true });
        const dest = path.join(pendingDir, fileName);

        // 已有完整且校验通过的文件：跳过下载
        if (fs.existsSync(dest)) {
            try {
                if ((await sha512Base64(dest)) === file.sha512) {
                    writeUpdateInfo(pendingDir, fileName, file);
                    return true;
                }
            } catch { /* 校验不过 → 重下 */ }
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
        }

        const info = await probeFile(url);
        if (!info.ranged) return false; // 服务器不支持 Range：交回 updater 原生路径
        const size = info.size;
        const parts = [];
        for (let off = 0; off < size; off += CHUNK) parts.push({ start: off, end: Math.min(off + CHUNK, size) - 1 });
        const fd = fs.openSync(dest, "w");
        let done = 0;
        let cursor = 0;
        let failure = null;
        async function worker() {
            while (cursor < parts.length && !failure) {
                const p = parts[cursor++];
                try {
                    const buf = await fetchRange(url, p.start, p.end);
                    fs.writeSync(fd, buf, 0, buf.length, p.start);
                    done += buf.length;
                    if (onProgress && size) onProgress(Math.min(99, Math.round((done / size) * 100)));
                } catch (e) {
                    failure = e;
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(PARALLEL, parts.length) }, worker));
        fs.closeSync(fd);
        if (failure) {
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
            return false; // 分块重试仍失败：静默回退原生路径
        }
        if ((await sha512Base64(dest)) !== file.sha512) {
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
            return false;
        }
        writeUpdateInfo(pendingDir, fileName, file);
        if (onProgress) onProgress(100);
        return true;
    } catch {
        return false; // 任何异常都静默交回 updater 原生路径
    }
}

function writeUpdateInfo(pendingDir, fileName, file) {
    // 与 electron-updater DownloadedUpdateHelper 的 update-info.json 形状一致。
    try {
        fs.writeFileSync(path.join(pendingDir, "update-info.json"), JSON.stringify({
            fileName,
            sha512: file.sha512,
            isAdminRightsRequired: false,
        }));
    } catch { /* ignore */ }
}

module.exports = { prefetchUpdateInstaller };
