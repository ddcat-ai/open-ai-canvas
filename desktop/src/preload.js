const { contextBridge, ipcRenderer } = require("electron");

// 桌面能力以最小面暴露给页面：重试、目录打开与 PeekReel 激活流，不开放任何 Node API。
contextBridge.exposeInMainWorld("desktop", {
    platform: process.platform,
    retry: () => ipcRenderer.invoke("app:retry"),
    openDataDir: () => ipcRenderer.invoke("app:open-data-dir"),
    openLogDir: () => ipcRenderer.invoke("app:open-log-dir"),
    checkUpdate: () => ipcRenderer.invoke("app:check-update"),
    // 页内更新提示：读取状态快照、订阅状态变化、触发静默安装。
    getUpdateState: () => ipcRenderer.invoke("app:get-update-state"),
    onUpdateState: (callback) => {
        const handler = (_event, state) => callback(state);
        ipcRenderer.on("app:update-state", handler);
        return () => ipcRenderer.removeListener("app:update-state", handler);
    },
    applyUpdate: () => ipcRenderer.invoke("app:apply-update"),
    // PeekReel 激活流：本地账户凭据由主进程托管在 userData/config.json。
    activationGet: () => ipcRenderer.invoke("peekreel:activation-get"),
    activationSave: (state) => ipcRenderer.invoke("peekreel:activation-save", state),
    syncLocalChannels: () => ipcRenderer.invoke("peekreel:sync-local-channels"),
    activationClear: () => ipcRenderer.invoke("peekreel:activation-clear"),
    yingceRequest: (method, input) => ipcRenderer.invoke("yingce:request", method, input),
    openConsole: () => ipcRenderer.invoke("peekreel:open-console"),
    openAccount: () => ipcRenderer.invoke("peekreel:open-account"),
    resetData: () => ipcRenderer.invoke("peekreel:reset-data"),
    // 豆包桥连接信息（本机回环桥的地址与令牌；非桌面环境返回 null）。
    doubaoBridgeInfo: () => ipcRenderer.invoke("doubao:bridge-info"),
    doubaoBridgeStatus: () => ipcRenderer.invoke("doubao:bridge-status"),
    retryDoubaoBridge: () => ipcRenderer.invoke("doubao:bridge-retry"),
    onDoubaoBridgeStatus: (callback) => {
        const handler = (_event, state) => callback(state);
        ipcRenderer.on("doubao:bridge-status", handler);
        return () => ipcRenderer.removeListener("doubao:bridge-status", handler);
    },
    // 完成提示音：交给主进程用系统 beep 发声，渲染进程不创建 AudioContext
    //（一次 WebAudio 会拉起 audio.mojom.AudioService，常驻约 100 MB）。
    beep: (kind) => ipcRenderer.invoke("app:beep", kind),
});
