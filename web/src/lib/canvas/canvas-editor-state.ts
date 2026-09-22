type StateUpdate<T> = T | ((current: T) => T);

/** 编辑命令同步提交到 ref；React 只接收快照，不执行含副作用、可被重放的 updater。 */
export function createCanvasStateWriter<T>(
    ref: { current: T },
    publish: (snapshot: T) => void,
    normalize: (before: T, after: T) => T = (_, after) => after,
) {
    return (update: StateUpdate<T>) => {
        const before = ref.current;
        const after = normalize(before, typeof update === "function" ? (update as (current: T) => T)(before) : update);
        // 兼容先提交 ref 再发布快照的调用方；相同引用不代表 React 已收到它。
        ref.current = after;
        publish(after);
    };
}
