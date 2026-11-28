import type { StoredJimengMedia } from "@/lib/canvas/jimeng-import";
import type { RemoteResource } from "@/services/api/resources";

const BATCH_SIZE = 20;
// 下载抖动这类瞬时失败的额外尝试次数；超限、超额等确定性失败不重试。
export const JIMENG_MEDIA_RETRY_LIMIT = 2;
// 连续多次调用都没有任何进展时停止，避免服务端异常时无限等待。
const MAX_STALLED_CALLS = 30;

export type JimengMediaStoreItem = { resourceId: string; resource?: RemoteResource; deferred?: boolean; retryable?: boolean; error?: string };
export type JimengMediaStoreBatch = { items: JimengMediaStoreItem[]; retryAfterSeconds: number };
export type JimengMediaTransferProgress = { done: number; total: number; waitSeconds: number };
export type JimengMediaTransfer = { stored: Map<string, StoredJimengMedia>; failures: Map<string, string> };

export type JimengMediaTransferParams = {
    resourceIds: string[];
    store: (resourceIds: string[]) => Promise<JimengMediaStoreBatch>;
    toStoredMedia: (resource: RemoteResource) => StoredJimengMedia;
    onProgress: (progress: JimengMediaTransferProgress) => void;
    shouldStop: () => boolean;
    /** 等待站点限额恢复，每秒回调一次剩余秒数；等待期间可被 shouldStop 打断。 */
    waitForQuota: (seconds: number, onTick: (remaining: number) => void) => Promise<void>;
};

/**
 * 把即梦素材逐批转存为影策资源。
 *
 * 被站点限流或超出时间预算的素材由服务端原样退回（deferred），等限额恢复后继续；
 * 下载失败、超时等可重试的失败排到队尾再试有限次；超限、超额等确定性失败记入 failures，
 * 对应节点保留即梦的临时链接。整批请求失败按可重试处理。
 */
export async function transferJimengImportMedia({ resourceIds, store, toStoredMedia, onProgress, shouldStop, waitForQuota }: JimengMediaTransferParams): Promise<JimengMediaTransfer> {
    const stored = new Map<string, StoredJimengMedia>();
    const failures = new Map<string, string>();
    const queue = [...new Set(resourceIds)];
    const total = queue.length;
    const attempts = new Map<string, number>();
    let done = 0;
    let stalled = 0;
    const report = (waitSeconds = 0) => onProgress({ done, total, waitSeconds });
    // 返回 true 表示已排到队尾等待重试。
    const requeue = (resourceId: string, retryable: boolean) => {
        const attempt = (attempts.get(resourceId) ?? 0) + 1;
        attempts.set(resourceId, attempt);
        if (!retryable || attempt > JIMENG_MEDIA_RETRY_LIMIT) return false;
        queue.push(resourceId);
        return true;
    };

    report();
    while (queue.length && !shouldStop()) {
        const batch = queue.splice(0, BATCH_SIZE);
        const before = done;
        let retryAfterSeconds = 0;
        let requestFailed = false;
        try {
            const response = await store(batch);
            retryAfterSeconds = response.retryAfterSeconds;
            for (const item of response.items) {
                if (item.deferred) {
                    queue.push(item.resourceId);
                    continue;
                }
                if (item.resource) {
                    stored.set(item.resourceId, toStoredMedia(item.resource));
                    done += 1;
                    continue;
                }
                if (requeue(item.resourceId, Boolean(item.retryable))) continue;
                failures.set(item.resourceId, item.error || "转存失败");
                done += 1;
            }
        } catch {
            requestFailed = true;
        }
        if (requestFailed) {
            for (const resourceId of batch) {
                if (requeue(resourceId, true)) continue;
                failures.set(resourceId, "转存请求失败");
                done += 1;
            }
        }
        stalled = done === before ? stalled + 1 : 0;
        if (stalled >= MAX_STALLED_CALLS) break;
        report();
        if (retryAfterSeconds > 0 && queue.length) await waitForQuota(retryAfterSeconds, (remaining) => onProgress({ done, total, waitSeconds: remaining }));
    }
    report();
    return { stored, failures };
}
