import { expect, test } from "bun:test";

const scenarios = [
    ["leases", "上传预热不创建URL，两个消费者共享地址且最后释放才撤销"],
    ["poster-leases", "视频抽帧失败和取消都会释放实际使用的缓存租约"],
    ["memory-budget", "64MiB闲置缓存预算淘汰旧Blob但保留活动租约"],
    ["entry-budget", "闲置缓存最多128项且读取更新LRU顺序"],
    ["disk-budget", "磁盘淘汰可清理活动媒体副本但不会撤销其URL"],
    ["scope-races", "账号切换后迟到的磁盘读取和下载不能重新发布旧资源"],
    ["queue-budget", "缓存写队列有字节预算，不无限持有上传预热Blob"],
    ["local-ownership", "本地同key替换保留旧读者，删除时回收全部版本且不删被引用原件"],
    ["local-scope", "会话清理只回收本地URL，迟到读取不能跨账号发布"],
    ["upload-errors", "图片永久失败和本地保存失败会回收预览，瞬时失败保留可恢复原件"],
    ["hook-lifecycle", "真实图片lease hook重渲染和减少可见度不破坏旧图，卸载释放"],
] as const;

for (const [scenario, title] of scenarios) {
    test(title, async () => {
        const result = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
            const worker = new Worker(new URL("./helpers/media-cache-lifecycle.worker.ts", import.meta.url).href, { type: "module" });
            worker.onmessage = (event) => {
                worker.terminate();
                resolve(event.data);
            };
            worker.onerror = (event) => {
                worker.terminate();
                reject(event.error || new Error(event.message));
            };
            worker.postMessage(scenario);
        });
        expect(result.error).toBeUndefined();
        expect(result.ok).toBe(true);
    });
}
