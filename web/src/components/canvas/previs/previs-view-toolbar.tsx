import { Tooltip } from "@/components/ui/base/tooltip";

import { releasePrevisFocusAfterPointer } from "@/lib/canvas/previs/previs-shortcuts";
import { PREVIS_VIEW_MODES, type PrevisViewMode } from "@/lib/canvas/previs/previs-view-modes";

type PrevisViewToolbarProps = {
    viewMode: PrevisViewMode;
    onViewModeChange: (mode: PrevisViewMode) => void;
    inline?: boolean;
};

/**
 * 取景模式切换（3D / CAM）。
 *
 * 独立于底部 dock：dock 装的是「改内容」的工具（变换、添加、渲染视图），
 * 这里只切换「从哪只眼睛看」，不产生任何场景改动，也不进 undo/history。
 *
 * 用文字标签而不是图标：3D 与 CAM 是两个含义相反的取景状态，图标化只会更难认。
 * 因此不复用 .previs-viewport-dock-button —— 那条规则写死了正方形尺寸且未分层，
 * Tailwind 工具类改不动它。这里用同一批 --previs-* token 自行排布，不动 globals.css。
 */
export function PrevisViewToolbar({ viewMode, onViewModeChange, inline = false }: PrevisViewToolbarProps) {
    return (
        <div
            role="group"
            aria-label="预演台取景模式"
            className={inline ? "previs-view-toolbar-inline" : "absolute right-3 top-3 z-[var(--z-toolbar)] inline-flex items-center gap-1 rounded-[var(--r-lg)] border p-1 shadow-xl backdrop-blur"}
            style={inline ? undefined : { borderColor: "var(--previs-sequencer-border)", background: "var(--previs-dock-surface)", color: "var(--previs-dock-fg)" }}
        >
            {PREVIS_VIEW_MODES.map((item) => {
                const active = viewMode === item.mode;
                return (
                    <Tooltip key={item.mode} title={item.hint} placement="bottom">
                        <button
                            type="button"
                            // aria-pressed 而不是 type="primary" 语义：这是持久的取景状态切换，
                            // 不是「当前主要命令」。屏幕阅读器要能读出哪一只眼睛是开着的。
                            aria-pressed={active}
                            aria-label={`${item.label} ${item.hint}`}
                            title={item.hint}
                            className="previs-view-toolbar-button inline-flex h-8 min-w-11 items-center justify-center rounded-[var(--r-md)] px-2 text-[var(--fs-tiny)] font-semibold tracking-wide transition-colors hover:bg-[var(--previs-control-hover)] hover:text-[var(--previs-dock-fg-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--control-focus-ring)] motion-reduce:transition-none"
                            style={active ? { background: "var(--previs-dock-active-surface)", color: "var(--previs-dock-fg-strong)" } : undefined}
                            onClick={(event) => {
                                onViewModeChange(item.mode);
                                // 焦点留在按钮上会让交互控件守卫吃掉 W/E/R 变换快捷键。
                                releasePrevisFocusAfterPointer(event);
                            }}
                        >
                            {item.label}
                        </button>
                    </Tooltip>
                );
            })}
        </div>
    );
}
