import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";

/** The shared scope can change in a different tab before this tab has reloaded its session. */
export function browserGenerationScope() {
    const { user, hydrated } = useUserStore.getState();
    const scope = user?.id || "guest";
    if (!hydrated || getActiveUserScope() !== scope) throw new Error("账号状态已变更或尚未加载，请刷新页面后继续个人渠道任务");
    return scope;
}

export function assertBrowserGenerationScope(scope: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (browserGenerationScope() !== scope) throw new Error("账号状态已变更，请刷新页面后继续个人渠道任务");
}
