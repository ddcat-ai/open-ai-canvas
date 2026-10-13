import { expect, test } from "bun:test";

import { moduleGroupSource } from "./helpers/module-group-source";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function sourceSection(source: string, startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

test("查询通道抖动时不再把仍在推进的任务提前判失败", () => {
    const source = compactSource(moduleGroupSource("services/api/task-center.ts"));
    const waitLoop = sourceSection(source, "export async function waitForGenerationTask(", "async function waitForGenerationTaskTextEvents(");

    // 回归点：曾经连续失败 5 次就 throw，导致后端还在跑、前端已经报「网络异常」。
    // 现在只允许降频继续等待，不允许在查询失败分支里提前退出。
    const failureBranch = sourceSection(waitLoop, "lastQueryError = error;", "if (task.status === \"succeeded\")");
    expect(failureBranch).not.toContain("throw");
    expect(failureBranch).toContain("continue");
    // 降频而不是终止：失败次数达标后拉长间隔，保留任务直到整体超时。
    expect(failureBranch).toContain("backoffMs");
    expect(waitLoop).toContain("const backoffMs = consecutiveFailures >= 5");
});

test("页面卸载不再把后台仍在执行的任务写成失败或已停止", () => {
    const source = compactSource(moduleGroupSource("pages/create/index.tsx"));

    // 卸载用独立标记记录，避免与用户主动「停止」共用同一个 abort 判定。
    expect(source).toContain("unmountedRef.current = true");
    const unmountEffect = sourceSection(source, "const unmountedRef = useRef(false);", "useEffect(() => {");
    expect(unmountEffect).toContain("abortRef.current?.abort()");

    // 卸载导致的取消：只要任务已经建出来（boundTaskIds 非空），就必须保留 pending
    // 交给页面恢复监听接管，不能落成 cancelled / error。
    const cancelBranch = sourceSection(source, "if (runtime.isGenerationTaskCancelled(error, requestLifecycle.signal))", "const message = generationErrorMessage(error);");
    expect(cancelBranch).toContain("unmountedRef.current && boundTaskIds.size > 0");
    const guardIndex = cancelBranch.indexOf("unmountedRef.current && boundTaskIds.size > 0");
    const cancelledIndex = cancelBranch.indexOf('status: "cancelled"');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(cancelledIndex).toBeGreaterThan(guardIndex);
});

test("页面水合阶段通过 autoRecoverCreationMessages 全自动静默恢复成功产物", () => {
    const source = compactSource(moduleGroupSource("pages/create/index.tsx"));
    const conversationsSource = compactSource(moduleGroupSource("pages/create/creation-conversations.ts"));

    // 水合加载时直接调用 autoRecoverCreationMessages 并持久化
    expect(source).toContain("autoRecoverCreationMessages(next, recentTasks)");
    expect(source).toContain("void saveCreationConversations(next)");

    // autoRecoverCreationMessages 实现必须直接提取产物并翻转为 done
    expect(conversationsSource).toContain("export function autoRecoverCreationMessages");
    expect(conversationsSource).toContain('status: "done" as const');
    expect(conversationsSource).toContain('content: message.mode === "video" ? "视频已生成" : "图片已生成"');
});
