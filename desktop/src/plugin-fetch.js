// 支付插件的按需拉取（G1 瘦身，2026-11-11）。
//
// 背景：5 个官方支付适配器（支付宝/微信/易支付/虎皮椒/支付FM）各含一份
// 约 2.5 MB 的 Rust/Go provider 二进制，合计 12.7 MB，占了安装包的 9%，
// 而它们只在「管理员配置支付渠道」时才会被后端加载。桌面版绝大多数用户
// 纯本地使用，一辈子不会碰支付配置。
//
// 做法：安装包只带 105 个轻量插件（合计 0.9 MB），支付插件在首次启动后
// 后台静默拉取，写入 <resources>/plugin-packages/，下次启动即被后端加载。
//
// 为什么不在本次启动就生效：后端在 spawn 时扫描一次插件目录
// （CANVAS_OFFICIAL_PLUGIN_DIR），运行中不热重载。强行重启后端会打断
// 用户正在跑的任务，代价大于收益——支付属于低频管理操作，多一次重启无感。
//
// 失败一律静默：缺支付插件只会让「支付渠道」列表为空，不影响任何创作功能。

const fs = require("fs");
const path = require("path");

/** 与 plugin-packages 目录内的文件名一一对应。 */
const PAYMENT_PLUGINS = [
    "official-payment-alipay-page",
    "official-payment-wechat-native",
    "official-payment-epay",
    "official-payment-xunhupay",
    "official-payment-zhifufm",
];

/**
 * 托管地址。挂在 /v1/ 下复用 Caddy 已配好的 CORS 与静态服务，
 * 避免为此新增一段生产配置。
 */
const REMOTE_BASE = "https://peekreel.peekcart.com/v1/assets/plugins/";

/** 单个插件的最小合理体积（防止把 404 页面当成插件写进目录）。 */
const MIN_PLUGIN_BYTES = 64 * 1024;

function isValidPluginFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size < MIN_PLUGIN_BYTES) return false;
        // .yingce-plugin 是 zip：校验魔数 PK\x03\x04
        const fd = fs.openSync(filePath, "r");
        try {
            const head = Buffer.alloc(4);
            fs.readSync(fd, head, 0, 4, 0);
            return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return false;
    }
}

/**
 * 确保 pluginDir 下存在全部支付插件；缺失的从远端补齐。
 *
 * @param {string} pluginDir  <resources>/plugin-packages
 * @param {{ log?: (msg: string) => void, timeoutMs?: number }} options
 * @returns {Promise<{ downloaded: string[], failed: string[], skipped: boolean }>}
 */
async function ensurePaymentPlugins(pluginDir, options = {}) {
    const log = options.log || (() => {});
    const timeoutMs = options.timeoutMs || 120000;
    const result = { downloaded: [], failed: [], skipped: false };

    if (!pluginDir || !fs.existsSync(pluginDir)) {
        log(`支付插件目录不存在，跳过按需拉取：${pluginDir}`);
        result.skipped = true;
        return result;
    }

    const missing = PAYMENT_PLUGINS.filter((name) => !isValidPluginFile(path.join(pluginDir, `${name}.yingce-plugin`)));
    if (missing.length === 0) {
        result.skipped = true;
        return result;
    }

    log(`准备后台拉取 ${missing.length} 个支付插件（${missing.join(", ")}）`);

    for (const name of missing) {
        const fileName = `${name}.yingce-plugin`;
        const target = path.join(pluginDir, fileName);
        const temp = `${target}.part`;
        try {
            const response = await fetch(REMOTE_BASE + fileName, { signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length < MIN_PLUGIN_BYTES) throw new Error(`响应过小（${buffer.length} 字节）`);
            fs.writeFileSync(temp, buffer);
            if (!isValidPluginFile(temp)) throw new Error("不是有效的插件包（zip 魔数不匹配）");
            fs.renameSync(temp, target);
            result.downloaded.push(name);
            log(`支付插件已就绪：${fileName}（${(buffer.length / 1024 / 1024).toFixed(1)} MB），下次启动生效`);
        } catch (error) {
            try {
                if (fs.existsSync(temp)) fs.unlinkSync(temp);
            } catch {
                // 清理失败不影响结论
            }
            result.failed.push(name);
            log(`支付插件拉取失败：${fileName} — ${error.message}`);
        }
    }

    return result;
}

module.exports = { ensurePaymentPlugins, PAYMENT_PLUGINS };