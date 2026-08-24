import { Button, Switch, Tooltip } from "antd";
import { BookOpenText, Bot, Clapperboard, Focus, Globe2, LayoutTemplate, Laptop, PanelRightClose, PanelsTopLeft, RotateCcw, Workflow } from "lucide-react";

import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasAgentMode } from "./canvas-agent-chat-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export function AgentPanelChrome({
    theme,
    mode,
    context,
    referenceCount,
    confirmTools,
    canUndo,
    undoCount,
    onModeChange,
    onConfirmToolsChange,
    onUndo,
    onCollapse,
}: {
    theme: CanvasTheme;
    mode: CanvasAgentMode;
    context: CanvasContextSummary;
    referenceCount: number;
    confirmTools: boolean;
    canUndo: boolean;
    undoCount: number;
    onModeChange: (mode: CanvasAgentMode) => void;
    onConfirmToolsChange: (confirm: boolean) => void;
    onUndo: () => void;
    onCollapse: () => void;
}) {
    const { t } = useTranslation("canvas");
    return (
        <header className="shrink-0 px-3 pb-2 pt-3">
            <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-md" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                    <Bot className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold leading-5">{t("domain:agent")}</div>
                    <div className="truncate text-[var(--fs-label)] leading-4" style={{ color: theme.node.muted }}>
                        {t("domain:canvas-copilot")}
                    </div>
                </div>
                <AgentModeSwitch value={mode} theme={theme} onChange={onModeChange} />
                <Tooltip title={t("domain:collapse-agent")}>
                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={onCollapse} />
                </Tooltip>
            </div>

            <div className="mt-2 flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 px-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                <span className="font-medium" style={{ color: theme.node.text }}>
                    {context.nodeCount} {t("canvas:nodes-2")}
                </span>
                {context.selectedCount ? (
                    <span className="inline-flex items-center gap-1">
                        <Focus className="size-3" />
                        {t("domain:selected-2")} {context.selectedCount}
                    </span>
                ) : (
                    <span>{t("domain:no-node-selected")}</span>
                )}
                {context.chapterLabel ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                        <BookOpenText className="size-3 shrink-0" />
                        <span className="max-w-32 truncate">
                            {context.chapterLabel}
                            {context.shotLabel ? ` · ${context.shotLabel}` : ""}
                        </span>
                    </span>
                ) : null}
                {referenceCount ? (
                    <span>
                        {referenceCount} {t("domain:references-2")}
                    </span>
                ) : null}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <Tooltip title={undoCount ? t("domain:undo-the-latest-agent-write-back-param-batches-undoable", { undoCount: undoCount }) : t("canvas:no-agent-write-back-to-undo")}>
                        <Button
                            type="text"
                            shape="circle"
                            className="!h-7 !w-7 !min-w-7"
                            disabled={!canUndo}
                            style={{ color: theme.node.muted }}
                            icon={<RotateCcw className="size-3.5" />}
                            onClick={onUndo}
                            aria-label={t("canvas:undo-the-latest-agent-write-back")}
                        />
                    </Tooltip>
                    <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5" style={{ color: theme.node.muted }}>
                        <Switch size="small" checked={confirmTools} onChange={onConfirmToolsChange} />
                        <span className="whitespace-nowrap">{t("domain:confirm-before-executing")}</span>
                    </label>
                </div>
            </div>
        </header>
    );
}

function AgentModeSwitch({ value, theme, onChange }: { value: CanvasAgentMode; theme: CanvasTheme; onChange: (value: CanvasAgentMode) => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="inline-flex h-8 shrink-0 items-center rounded-md p-0.5 text-[var(--fs-label)]" style={{ background: theme.spatial.surface }} role="group" aria-label={t("domain:agent-runs-on")}>
            {(["online", "local"] as const).map((item) => {
                const active = value === item;
                const Icon = item === "online" ? Globe2 : Laptop;
                return (
                    <button
                        key={item}
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 transition-colors"
                        style={{ background: active ? theme.node.fill : "transparent", color: active ? theme.node.text : theme.node.muted, boxShadow: active ? `0 1px 5px ${theme.spatial.shadow}` : "none" }}
                        onClick={() => onChange(item)}
                        aria-pressed={active}
                    >
                        <Icon className="size-3" />
                        {item === "online" ? t("domain:web") : t("domain:local")}
                    </button>
                );
            })}
        </div>
    );
}

const starterActions = [
    { key: "set-up-drama-workflow", labelKey: "domain:set-up-drama-workflow", icon: Clapperboard },
    { key: "organize-this-canvas", labelKey: "domain:organize-this-canvas", icon: LayoutTemplate },
    { key: "generate-shot-storyboards", labelKey: "domain:generate-shot-storyboards", icon: PanelsTopLeft },
    { key: "check-node-connections", labelKey: "domain:check-node-connections", icon: Workflow },
];

export function AgentChatEmptyState({ theme, nodeCount, onSelect }: { theme: CanvasTheme; nodeCount: number; onSelect: (value: string) => void }) {
    const { t } = useTranslation("canvas");
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const visibleStarterActions = shortDramaEnabled ? starterActions : starterActions.filter((item) => item.key !== "set-up-drama-workflow");
    return (
        <div className="flex h-full items-center px-5 py-8">
            <div className="mx-auto w-full max-w-[380px]">
                <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-md" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                        <Bot className="size-3.5" />
                    </span>
                    <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.muted }}>
                        {nodeCount} {t("domain:nodes-ready")}
                    </span>
                </div>
                <h2 className="mt-3 text-[var(--fs-heading-lg)] font-semibold leading-6" style={{ color: theme.node.text }}>
                    {t("domain:start-from-current-canvas")}
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-1">
                    {visibleStarterActions.map(({ labelKey, icon: Icon }) => (
                        <button
                            key={labelKey}
                            type="button"
                            className="group flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-medium transition-colors"
                            style={{ color: theme.node.text }}
                            onMouseEnter={(event) => {
                                event.currentTarget.style.background = theme.spatial.surface;
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.background = "transparent";
                            }}
                            onFocus={(event) => {
                                event.currentTarget.style.background = theme.spatial.surface;
                            }}
                            onBlur={(event) => {
                                event.currentTarget.style.background = "transparent";
                            }}
                            onClick={() => onSelect(t(labelKey))}
                        >
                            <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.spatial.surface, color: theme.node.muted }}>
                                <Icon className="size-3.5" />
                            </span>
                            <span className="min-w-0 truncate">{t(labelKey)}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
