import { Tooltip } from "antd";

import { releaseDirectorFocusAfterPointer } from "@/lib/canvas/director/director-shortcuts";
import { DIRECTOR_VIEW_MODES, type DirectorViewMode } from "@/lib/canvas/director/director-view-modes";

type DirectorViewToolbarProps = {
    viewMode: DirectorViewMode;
    onViewModeChange: (mode: DirectorViewMode) => void;
};

/**
 * 取景模式切换（3D / CAM）。
 *
 * 独立于底部 dock：dock 装的是「改内容」的工具（变换、添加、渲染视图），
 * 这里只切换「从哪只眼睛看」，不产生任何场景改动，也不进 undo/history。
 *
 * 用文字标签而不是图标：3D 与 CAM 是两个含义相反的取景状态，图标化只会更难认。
 * 因此不复用 .director-viewport-dock-button —— 那条规则写死了正方形尺寸且未分层，
 * Tailwind 工具类改不动它。这里用同一批 --director-* token 自行排布，不动 globals.css。
 */
export function DirectorViewToolbar({ viewMode, onViewModeChange }: DirectorViewToolbarProps) {
    return (
        <div
            role="group"
            aria-label="导演台取景模式"
            className="absolute right-3 top-3 z-[var(--z-toolbar)] inline-flex items-center gap-1 rounded-[var(--r-lg)] border p-1 shadow-xl backdrop-blur"
            style={{ borderColor: "var(--director-sequencer-border)", background: "var(--director-dock-surface)", color: "var(--director-dock-fg)" }}
        >
            {DIRECTOR_VIEW_MODES.map((item) => {
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
                            className="inline-flex h-8 min-w-11 items-center justify-center rounded-[var(--r-md)] px-2 text-[var(--fs-tiny)] font-semibold tracking-wide transition-colors hover:bg-[var(--director-control-hover)] hover:text-[var(--director-dock-fg-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--control-focus-ring)] motion-reduce:transition-none"
                            style={active ? { background: "var(--director-dock-active-surface)", color: "var(--director-dock-fg-strong)" } : undefined}
                            onClick={(event) => {
                                onViewModeChange(item.mode);
                                // 焦点留在按钮上会让交互控件守卫吃掉 W/E/R 变换快捷键。
                                releaseDirectorFocusAfterPointer(event);
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
