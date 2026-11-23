/** 上游已完成但结果地址缺失时，后台仍可通过 URL 转存后回写同一任务。 */
export function creationMessageMayHaveExternalVideoResult(message: { mode?: string; status?: string; errorKind?: string; error?: string }) {
    if (message.mode !== "video" || message.status !== "error" || message.errorKind !== "task") return false;
    return /声明式协议已完成但没有返回(?:结果|媒体地址)|任务成功但(?:没有|未)返回视频 URL/i.test(message.error || "");
}
