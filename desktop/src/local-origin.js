const fs = require("fs");
const path = require("path");

// IndexedDB directory names preserve the actual historical origin without reading user records.
function resolveLocalPort(userDataDir, savedPort) {
    if (savedPort !== undefined && savedPort !== null) {
        if (!Number.isInteger(savedPort) || savedPort < 1024 || savedPort > 65535) throw new Error("本地来源端口配置无效，请检查配置");
        return savedPort;
    }
    let names = [];
    try { names = fs.readdirSync(path.join(userDataDir, "IndexedDB")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const ports = [...new Set(names.flatMap((name) => {
        const match = /^http_127\.0\.0\.1_(\d+)\.indexeddb\.(?:leveldb|blob)$/.exec(name);
        return match ? [Number(match[1])] : [];
    }))];
    if (ports.length > 1) throw new Error("发现多个历史本地来源，已保留全部数据。请确认使用的来源端口后重试，未切换到新来源。");
    return ports[0] || 17831;
}

module.exports = { resolveLocalPort };
