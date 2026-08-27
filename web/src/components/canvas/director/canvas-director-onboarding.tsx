import { useCallback, useEffect, useRef, useState } from "react";

import {
    advanceDirectorOnboarding,
    createDirectorOnboardingGate,
    loadDirectorOnboardingProgress,
    resetDirectorOnboardingProgress,
    resolveDirectorOnboardingView,
    type DirectorOnboardingAction,
    type DirectorOnboardingProgress,
    type DirectorOnboardingStorage,
    type DirectorOnboardingView,
} from "@/lib/canvas/director/director-onboarding";

/**
 * 导演台首次上手引导浮层（P2）。
 *
 * 硬约束：
 * - 非阻塞。不是 dialog，没有遮罩，不抢焦点，不做焦点陷阱：引导旁边就是要动手的工作台，
 *   任何模态化都会把「照着做」变成「先关掉」。因此用 role="region" 而不是 role="dialog"。
 * - 只用原生 button。三个动作都是真正的按钮，键盘 Tab/Enter/Space 与读屏天然可用。
 * - 只用既有 token（CSS 变量 + Tailwind 布局类），不新增全局 CSS，不写颜色/圆角/字号字面值。
 * - 读不到持久进度（IndexedDB 失败）时不展示：无法确认用户是否已经跳过，就不要再骚扰他。
 */

type DirectorOnboardingController = {
    /** null 表示不展示：未加载完、已跳过、已完成、或持久层不可用。 */
    view: DirectorOnboardingView | null;
    /** 有动作在写盘。用于禁用按钮，避免连点产生并发写。 */
    busy: boolean;
    next: () => void;
    back: () => void;
    dismiss: () => void;
    complete: () => void;
    /** 重新开始引导。已跳过/已完成的用户只能靠它回到第一步。 */
    reset: () => void;
};

/**
 * 引导状态接线。
 *
 * scope 变化（切账号）会重新加载并丢弃在途结果：generation 守卫保证旧账号的进度
 * 不会落到新账号的界面上。enabled 为 false 或 scope 为空时不读盘、不展示。
 *
 * 并发写保护用 gateRef（同步闭包锁）而不是只靠 busy state：同一 tick 内的重复调用
 * （双击、程序化连点）在 busy state 反映到下一次渲染之前就已经发生，只看 state 挡不住。
 *
 * 关键边界：gateRef 在换代（scope/enabled 变化）时必须整体替换成全新实例，而不是对
 * 共享的旧实例调用 release()。原因：如果旧一代的写入仍在途，release 共享实例会把
 * 刚为新一代腾出来的锁也一起放开；而新一代锁上之后，旧写入 .finally() 里如果重新读
 * `gateRef.current`（这时已经指向新一代的锁）去 release，会把新一代还在写的锁误放掉——
 * generation 守卫只保护展示状态，保护不了锁。因此 run() 必须在拿锁的同一刻把
 * `gateRef.current` 同步捕获进局部变量 `gate`，tryEnter/release 全部作用在这份捕获上，
 * 绝不在 .then/.catch/.finally 里重新读取 `gateRef.current`。
 */
export function useDirectorOnboarding({ scope, enabled = true, storage }: { scope: string; enabled?: boolean; storage?: DirectorOnboardingStorage }): DirectorOnboardingController {
    const [progress, setProgress] = useState<DirectorOnboardingProgress | null>(null);
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    const gateRef = useRef(createDirectorOnboardingGate());
    const normalizedScope = scope.trim();
    const active = enabled && normalizedScope.length > 0;

    useEffect(() => {
        generation.current += 1;
        const current = generation.current;
        // 换新实例而不是 release 旧实例：旧实例可能仍被上一代在途的写入持有。
        gateRef.current = createDirectorOnboardingGate();
        setProgress(null);
        setBusy(false);
        if (!active) return;
        void loadDirectorOnboardingProgress(normalizedScope, storage)
            .then((loaded) => {
                if (generation.current === current) setProgress(loaded);
            })
            .catch(() => {
                // 持久层不可用：保持不展示。引导不值得为它弹错误提示。
            });
    }, [active, normalizedScope, storage]);

    const run = useCallback(
        (action: DirectorOnboardingAction) => {
            if (!active || !progress) return;
            // 同步捕获本次调用时刻的锁实例：即使换代把 gateRef.current 换成新实例，
            // 这次调用后续的 tryEnter/release 也只作用在捕获到的这一份上。
            const gate = gateRef.current;
            // 同步拦截：拿不到锁说明上一次调用还没落盘，本次直接放弃，不基于同一份旧 progress 重复发起写入。
            if (!gate.tryEnter()) return;
            const current = generation.current;
            setBusy(true);
            void advanceDirectorOnboarding(normalizedScope, progress, action, storage)
                .then((next) => {
                    if (generation.current === current) setProgress(next);
                })
                .catch(() => {
                    // 写盘失败：停在当前步骤，用户可以再点一次。绝不在界面上假装已前进。
                })
                .finally(() => {
                    // 释放捕获的 gate，不是 gateRef.current —— 换代后 ref 可能已经指向
                    // 新一代的锁，重新读取会把新一代还在写的锁误放掉。
                    gate.release();
                    if (generation.current === current) setBusy(false);
                });
        },
        [active, progress, normalizedScope, storage],
    );

    const next = useCallback(() => run("next"), [run]);
    const back = useCallback(() => run("back"), [run]);
    const dismiss = useCallback(() => run("dismiss"), [run]);
    const complete = useCallback(() => run("complete"), [run]);
    const reset = useCallback(() => {
        if (!active) return;
        const gate = gateRef.current;
        if (!gate.tryEnter()) return;
        // A restart supersedes the pending load for this scope. Advancing the
        // generation prevents that older read from restoring a completed or
        // dismissed progress record after the reset has landed.
        generation.current += 1;
        const current = generation.current;
        setBusy(true);
        void resetDirectorOnboardingProgress(normalizedScope, storage)
            .then((next) => {
                if (generation.current === current) setProgress(next);
            })
            .catch(() => {
                if (generation.current !== current) return;
                // 重置失败后把同一 scope 的持久进度重新读回来。重置开始时已经让旧读取
                // 失效，若这里不补读，加载期触发重置的用户会一直停在 progress=null。
                return loadDirectorOnboardingProgress(normalizedScope, storage)
                    .then((loaded) => {
                        if (generation.current === current) setProgress(loaded);
                    })
                    .catch(() => {
                        // 持久层仍不可用时继续隐藏；标题栏入口允许用户稍后再次尝试。
                    });
            })
            .finally(() => {
                gate.release();
                if (generation.current === current) setBusy(false);
            });
    }, [active, normalizedScope, storage]);

    return { view: progress ? resolveDirectorOnboardingView(progress) : null, busy, next, back, dismiss, complete, reset };
}

/** 焦点环与既有 director 控件一致：token 化的 outline，不引入新的全局样式。 */
const FOCUS_RING = "focus-visible:[outline:var(--stroke-2)_solid_var(--control-focus-ring)] focus-visible:[outline-offset:1px]";

/**
 * 引导卡片。
 *
 * scope 必须由调用方显式传入已认证用户 id —— 组件不读取 guest fallback 或当前活跃
 * scope，避免绕过「显式用户 scope」这条边界。
 */
export function CanvasDirectorOnboarding({ scope, open = true, restartSignal = 0, className, storage }: { scope: string; open?: boolean; restartSignal?: number; className?: string; storage?: DirectorOnboardingStorage }) {
    const { view, busy, next, back, dismiss, reset } = useDirectorOnboarding({ scope, enabled: open, storage });
    const previousRestartSignal = useRef(restartSignal);

    useEffect(() => {
        if (previousRestartSignal.current === restartSignal) return;
        previousRestartSignal.current = restartSignal;
        reset();
    }, [reset, restartSignal]);

    if (!view) return null;

    const { step, position, total, isFirst, isLast } = view;

    return (
        <section
            className={`grid gap-[var(--space-2)] ${className || ""}`}
            aria-label="导演台上手引导"
            style={{
                padding: "var(--space-3)",
                border: "var(--stroke-1) solid var(--border-semantic)",
                borderRadius: "var(--r-lg)",
                background: "var(--surface)",
                boxShadow: "var(--elevation-overlay)",
                color: "var(--cn-text)",
            }}
        >
            <header className="flex min-w-0 items-center justify-between gap-[var(--space-2)]">
                <p className="m-0 min-w-0 truncate" style={{ fontSize: "var(--fs-label)", fontWeight: 600 }}>
                    {step.title}
                </p>
                <span style={{ flex: "0 0 auto", color: "var(--cn-muted)", fontSize: "var(--fs-tiny)" }}>{`第 ${position} 步 / 共 ${total} 步`}</span>
            </header>

            {/* 步骤切换靠 aria-live 播报，不靠焦点转移：焦点必须留在用户正在操作的地方。 */}
            <p className="m-0" aria-live="polite" style={{ color: "var(--cn-muted)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
                {step.detail}
            </p>

            {/* 进度点是纯装饰，真实进度由上面的「第 N 步 / 共 M 步」文本承担。 */}
            <div className="flex items-center gap-[var(--space-1)]" aria-hidden>
                {Array.from({ length: total }, (_, index) => (
                    <span
                        key={index}
                        style={{
                            width: "var(--space-1-half)",
                            height: "var(--space-1-half)",
                            borderRadius: "var(--r-full)",
                            background: index < position ? "var(--workspace-accent)" : "var(--cn-stroke)",
                        }}
                    />
                ))}
            </div>

            <div className="flex items-center justify-between gap-[var(--space-2)]">
                <button type="button" className={FOCUS_RING} onClick={dismiss} disabled={busy} style={{ height: "var(--space-6)", padding: "0 var(--space-2)", borderRadius: "var(--r-sm)", color: "var(--cn-muted)", fontSize: "var(--fs-tiny)" }}>
                    跳过引导
                </button>
                <div className="flex items-center gap-[var(--space-1)]">
                    <button
                        type="button"
                        className={FOCUS_RING}
                        onClick={back}
                        disabled={busy || isFirst}
                        style={{
                            height: "var(--space-6)",
                            padding: "0 var(--space-3)",
                            border: "var(--stroke-1) solid var(--control-selected-border)",
                            borderRadius: "var(--r-sm)",
                            background: "var(--control-selected-bg)",
                            color: isFirst ? "var(--control-disabled-fg)" : "var(--control-selected-fg)",
                            fontSize: "var(--fs-tiny)",
                        }}
                    >
                        上一步
                    </button>
                    <button
                        type="button"
                        className={FOCUS_RING}
                        onClick={next}
                        disabled={busy}
                        style={{
                            height: "var(--space-6)",
                            padding: "0 var(--space-3)",
                            border: "var(--stroke-1) solid var(--workspace-accent)",
                            borderRadius: "var(--r-sm)",
                            background: "var(--workspace-accent)",
                            color: "var(--btn-solid-fg)",
                            fontSize: "var(--fs-tiny)",
                        }}
                    >
                        {isLast ? "结束引导" : "下一步"}
                    </button>
                </div>
            </div>
        </section>
    );
}
