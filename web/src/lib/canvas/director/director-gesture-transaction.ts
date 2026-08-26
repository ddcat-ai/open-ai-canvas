import { directorGestureIdle, reduceDirectorGesture } from "./director-animation-semantics";

export type DirectorTransactionHooks<TSnapshot> = {
    /** 读取当前值；返回 null 表示无法开始/结束事务。 */
    read: () => TSnapshot | null;
    /** 取消路径：把快照写回。 */
    restore: (snapshot: TSnapshot) => void;
    /** 成功路径：恰好调用一次。 */
    commit: (from: TSnapshot, to: TSnapshot) => void;
    /** 进入/退出手势；任何终态都会收到 false。 */
    setActive: (active: boolean) => void;
    /** 取消时结束第三方控件内部拖拽状态。 */
    terminateDrag?: () => void;
};

export type DirectorTransaction = {
    begin: () => void;
    end: (outcome: "commit" | "cancel") => void;
    active: () => boolean;
};

/**
 * 一次手势一个事务：begin 抓快照，end 恰好产生一个终态。
 * 幂等——非活跃时的 end 是空操作，终态后可以重新 begin。
 */
export function createDirectorTransaction<TSnapshot>(hooks: DirectorTransactionHooks<TSnapshot>): DirectorTransaction {
    let state = directorGestureIdle;
    // 快照可能是任何值（含 0 / ""），所以用独立标记表示「有快照」，不能用真值判断。
    let snapshot: TSnapshot | null = null;
    let hasSnapshot = false;
    return {
        begin: () => {
            if (state.active) return;
            const current = hooks.read();
            if (current === null || current === undefined) return;
            snapshot = current;
            hasSnapshot = true;
            state = reduceDirectorGesture(state, "start");
            hooks.setActive(true);
        },
        end: (outcome) => {
            if (!state.active) return;
            const base = snapshot;
            const settled = reduceDirectorGesture(state, outcome);
            const hadSnapshot = hasSnapshot;
            snapshot = null;
            hasSnapshot = false;
            state = directorGestureIdle;
            // 先进入终态再结束第三方拖拽：stdlib 在 domElement.ownerDocument 注册 pointerup，
            // 其 pointerUp({button:0}) 会 dispatch mouseUp 后清 dragging=false / axis=null。
            // 该回调会回到本事务，此时已非活跃，因此不会二次提交。
            if (outcome === "cancel") hooks.terminateDrag?.();
            if (!hadSnapshot || base === null || base === undefined) {
                hooks.setActive(false);
                return;
            }
            if (settled.committed) {
                const current = hooks.read();
                if (current !== null && current !== undefined) hooks.commit(base, current);
            } else {
                hooks.restore(base);
            }
            hooks.setActive(false);
        },
        active: () => state.active,
    };
}

export type DirectorListenerTarget = {
    addEventListener: (type: string, listener: (event: Event) => void) => void;
    removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

export type DirectorTerminalTargets = {
    /** 承载 keydown / blur / pointercancel / pointerup 的目标（通常是 window）。 */
    window: DirectorListenerTarget;
    /** 承载 visibilitychange 的目标（通常是 document）。 */
    document: DirectorListenerTarget;
    /** 读取可见性；hidden 视为「离开」而非「放弃」。 */
    isHidden: () => boolean;
};

/**
 * 无条件安装终止监听，绝不以「当前是否有手势」为安装条件——
 * 手势只 mutate 事务内部状态，不会重跑安装逻辑。
 * 非活跃时 transaction.end 自身是空操作，因此常驻监听是安全的。
 *
 * 终态语义（#305 验收）：
 * - pointerup / window blur / document hidden → commit 当前可见值。
 *   失焦或切页只是「离开」，用户已经把对象拖到那里了，不能把它弹回原位。
 * - Escape / pointercancel → cancel 并恢复快照，这是用户明确表达的放弃。
 */
export function installDirectorTerminalListeners(transaction: DirectorTransaction, targets: DirectorTerminalTargets) {
    const cancel = () => transaction.end("cancel");
    const commit = () => transaction.end("commit");
    const onKeyDown = (event: Event) => {
        if ((event as KeyboardEvent).key === "Escape") cancel();
    };
    const onVisibility = () => {
        if (targets.isHidden()) commit();
    };
    targets.window.addEventListener("keydown", onKeyDown);
    targets.window.addEventListener("blur", commit);
    targets.window.addEventListener("pointercancel", cancel);
    targets.window.addEventListener("pointerup", commit);
    targets.document.addEventListener("visibilitychange", onVisibility);
    return () => {
        targets.window.removeEventListener("keydown", onKeyDown);
        targets.window.removeEventListener("blur", commit);
        targets.window.removeEventListener("pointercancel", cancel);
        targets.window.removeEventListener("pointerup", commit);
        targets.document.removeEventListener("visibilitychange", onVisibility);
    };
}
