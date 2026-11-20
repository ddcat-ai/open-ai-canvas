// 画布镜头是否跟随 Agent：关闭后 Agent 改动只在节点外圈轻闪，不移动镜头。小型 UI 偏好，存 localStorage。
const STORAGE_KEY = "canvas-agent-camera-follow:v1";

export function readCanvasAgentCameraFollow(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== "off";
    } catch {
        return true;
    }
}

export function persistCanvasAgentCameraFollow(value: boolean) {
    try {
        window.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
    } catch {
        // 隐私模式或配额已满时只在本次会话生效。
    }
}
