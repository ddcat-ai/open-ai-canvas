export type DirectorLoadPhase = "loading" | "ready" | "error";

export type DirectorLoadState = {
    phase: DirectorLoadPhase;
    /** 每次 retry 递增；晚到的旧 generation 回调必须被忽略。 */
    generation: number;
};

export type DirectorLoadEvent = { type: "start" } | { type: "loaded"; generation: number } | { type: "failed"; generation: number } | { type: "retry" };

export const directorLoadInitial: DirectorLoadState = { phase: "loading", generation: 0 };

/** 加载状态机：只接受当前 generation 的结果，retry 递增 generation 并回到 loading。 */
export function reduceDirectorLoad(state: DirectorLoadState, event: DirectorLoadEvent): DirectorLoadState {
    if (event.type === "start") return { phase: "loading", generation: state.generation };
    if (event.type === "retry") return { phase: "loading", generation: state.generation + 1 };
    if (event.generation !== state.generation) return state;
    return { phase: event.type === "loaded" ? "ready" : "error", generation: state.generation };
}

export type DirectorContextState = "ok" | "lost";

export type DirectorCanvasTarget = {
    addEventListener: (type: string, listener: (event: Event) => void) => void;
    removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

/**
 * WebGL 上下文监听：lost 必须 preventDefault，否则浏览器不会补发 restored。
 * 返回 disposer，随 renderer / 重试 / unmount 精确摘除。
 */
export function installDirectorContextListeners(target: DirectorCanvasTarget, handlers: { onLost: () => void; onRestored: () => void }) {
    const onLost = (event: Event) => {
        event.preventDefault();
        handlers.onLost();
    };
    const onRestored = () => handlers.onRestored();
    target.addEventListener("webglcontextlost", onLost);
    target.addEventListener("webglcontextrestored", onRestored);
    return () => {
        target.removeEventListener("webglcontextlost", onLost);
        target.removeEventListener("webglcontextrestored", onRestored);
    };
}

/** 加载失败登记表：对象 id -> 该对象自己的 retry。 */
export type DirectorFailedLoads = Record<string, () => void>;

/** 登记信号：除加载态外，还包含「对象已卸载」这一必须注销的情形。 */
export type DirectorLoadSignal = DirectorLoadPhase | "unmounted";

/**
 * 按信号登记/注销失败对象。ready/loading/unmounted 都必须移除，
 * 否则 retry 回到 loading、或对象被删除后，通知会一直挂着陈旧条目。
 */
export function upsertDirectorFailedLoad(current: DirectorFailedLoads, id: string, signal: DirectorLoadSignal, retry: () => void): DirectorFailedLoads {
    if (signal === "error") return current[id] === retry ? current : { ...current, [id]: retry };
    return removeDirectorFailedLoad(current, id);
}

/** 对象卸载（删除、隐藏、换 URL/kind、Canvas 重建）必须注销自己，不能残留不存在对象的 Retry。 */
export function removeDirectorFailedLoad(current: DirectorFailedLoads, id: string): DirectorFailedLoads {
    if (!(id in current)) return current;
    const next = { ...current };
    delete next[id];
    return next;
}

/**
 * WebGL capture 可用性：上下文丢失期间不得继续使用失效 renderer，
 * 恢复后必须重新登记 capture context 才算可用。
 */
export type DirectorCaptureState = { registered: boolean; contextLost: boolean };

export const directorCaptureInitial: DirectorCaptureState = { registered: false, contextLost: false };

export function reduceDirectorCapture(state: DirectorCaptureState, event: "register" | "lost" | "restored" | "reset"): DirectorCaptureState {
    if (event === "register") return { registered: true, contextLost: false };
    if (event === "lost") return { ...state, contextLost: true };
    // restored 只清丢失标记；capture context 需由 renderer 重新登记后才可用。
    if (event === "restored") return { registered: false, contextLost: false };
    return directorCaptureInitial;
}

export function directorCaptureUsable(state: DirectorCaptureState) {
    return state.registered && !state.contextLost;
}

/**
 * 上下文恢复的完整序列，生产 handler 与测试必须共用同一个实现。
 * reduceDirectorCapture("restored") 会把 registered 置回 false，
 * 因此恢复后必须用当前 renderer 重新登记 capture context，否则
 * capture/record/readCameraTransform 会永久不可用（只有手动重建 Canvas 才恢复）。
 * 顺序：先复位可用性 -> 再登记新 context -> 最后请求重绘。
 */
export function restoreDirectorCapture<TContext>(input: { readContext: () => TContext; onAvailability: (event: "restored") => void; onRegister: (context: TContext) => void; invalidate?: () => void }) {
    input.onAvailability("restored");
    input.onRegister(input.readContext());
    input.invalidate?.();
}

/**
 * 释放 capture context，生产接线与测试共用。
 * Canvas 子树因 render error 或重建而卸载时必须走这里：
 * 先清掉指向已销毁 renderer 的引用，再把可用性打回初态，
 * 否则 ErrorBoundary 显示恢复页后「应用到镜头」仍会拿到死 renderer。
 * reset 后仍可由新的 renderer 重新 register，不影响重试路径。
 */
export function releaseDirectorCapture(input: { clearContext: () => void; onAvailability: (event: "reset") => void }) {
    input.clearContext();
    input.onAvailability("reset");
}

/**
 * 加载身份：generation + 解析输入。展示状态必须携带它，
 * 这样 prop/retry 变化的第一次 render 就能屏蔽旧资源 —— 不能依赖 effect 之后的 render 才安全。
 */
export function directorLoadIdentity(input: { generation: number; url?: string | null; storageKey?: string | null; kind?: string | null }) {
    return [input.generation, input.url ?? "", input.storageKey ?? "", input.kind ?? ""].join("|");
}

/** render 阶段的守卫：identity 不匹配就当作「还没有可展示资源」。 */
export function resolveDirectorDisplay<TValue>(state: { identity: string; value: TValue } | null, identity: string): TValue | null {
    return state && state.identity === identity ? state.value : null;
}
