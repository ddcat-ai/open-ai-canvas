const fs = require("fs");
const path = require("path");

// 配置保存在安装目录下的 user-data，升级时由安装器保留。
function configPath(app) {
    return path.join(app.getPath("userData"), "config.json");
}

function defaults() {
    const feed = process.env.YINGCE_UPDATE_FEED || require('../package.json').peekreel?.updateFeed || 'https://peekreel.peekcart.com/updates/';
    return {
        // 更新渠道由安装包版本决定，避免已有配置让 Lite 接收 full 安装包。
        updateFeed: feed,
        updateFeedFallback: feed,
        allowDevtools: process.env.YINGCE_ALLOW_DEVTOOLS === "1",
        // PeekReel 商业化端点：中转站（NewAPI）与用户控制台。
        // 打包时可用环境变量烘焙，运行后用户不可更改（锁死中转）。
        relayUrl: process.env.YINGCE_RELAY_URL || "https://api.peekcart.com",
        yingceApiUrl: process.env.YINGCE_API_URL || "https://api.peekcart.com/api",
        consoleUrl: process.env.YINGCE_CONSOLE_URL || "https://console.peekcart.com",
        // 直连渠道目录：视频/音频等原生协议渠道由服务器下发（含密钥，隐藏 slug），
        // 客户端启动/激活时拉取并写入本地后端；换钥/增删模型无需发新版。
        directChannelsUrl: process.env.YINGCE_DIRECT_CHANNELS_URL || "https://peekreel.peekcart.com/v1/direct-channels-fbbfb80e5d143f79b812c48a0fc518e4.json",
        // 激活状态：{ username, password, apiKey, activatedAt }
        // 由激活页通过 IPC 写入；本地账户凭据由应用托管，用户无感知。
        activation: null,
        // 生成时自动弹出豆包实时对话框（WOOL 式围观：切模式/填词/bot 提问/出片全程可见）
        doubaoLiveAutoShow: process.env.YINGCE_DOUBAO_LIVE_HIDE !== "1",
    };
}

function loadConfig(app) {
    const base = defaults();
    try {
        const raw = fs.readFileSync(configPath(app), "utf8");
        const parsed = JSON.parse(raw);
        return { ...base, ...parsed, yingceApiUrl: process.env.YINGCE_API_URL || parsed.yingceApiUrl || base.yingceApiUrl, updateFeed: base.updateFeed, updateFeedFallback: base.updateFeedFallback };
    } catch {
        return { ...base };
    }
}

function saveConfig(app, config) {
    const file = configPath(app);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
}

module.exports = { loadConfig, saveConfig };
