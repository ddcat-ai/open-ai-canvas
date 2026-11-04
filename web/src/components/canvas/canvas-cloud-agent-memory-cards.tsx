import { App, Button } from "antd";
import { BookMarked, Check, Plus, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { canvasThemes } from "@/lib/canvas-theme";
import { undoAgentMemoryRevision } from "@/services/api/agent-memory";
import { addSkill } from "@/services/api/skills";
import type { CloudAgentMemoryUpdate, CloudAgentSkillSuggestion } from "./canvas-cloud-agent-chat-ui";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

const SECTION_LABEL_KEYS: Record<string, string> = { user: "canvasA.memoryCard.sectionUser", notes: "canvasA.memoryCard.sectionNotes" };
const CHANGE_LABEL_KEYS: Record<string, string> = { add: "canvasA.memoryCard.changeAdd", replace: "canvasA.memoryCard.changeReplace", remove: "canvasA.memoryCard.changeRemove" };

/** 聊天里的记忆变更卡：说明 Agent 记住或改了什么；已生效的修改可以一键撤销。 */
export function AgentMemoryUpdateCard({ update, theme }: { update: CloudAgentMemoryUpdate; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [state, setState] = useState<"idle" | "undoing" | "undone">("idle");
    const pending = update.status === "pending";
    const undo = async () => {
        if (!update.revisionId) return;
        setState("undoing");
        try {
            await undoAgentMemoryRevision(update.revisionId);
            setState("undone");
            message.success(t("canvasA.memoryCard.undone"));
        } catch (error) {
            setState("idle");
            message.error(error instanceof Error ? error.message : t("canvasA.memoryCard.undoFailed"));
        }
    };
    return (
        <div className="agent-status-message flex items-start gap-2 text-xs" role="status">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full" style={{ background: theme.node.fill, color: theme.accent.primary }} aria-hidden="true">
                <BookMarked className="size-3" />
            </span>
            <div className="min-w-0 flex-1 leading-5" style={{ color: theme.node.muted }}>
                <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium" style={{ color: theme.node.text }}>
                        {state === "undone" ? t("canvasA.memoryCard.undone") : pending ? t("canvasA.memoryCard.pending") : t("canvasA.memoryCard.updated")}
                    </span>
                    {update.summary ? <span className="opacity-70">{update.summary}</span> : null}
                </div>
                {update.changes.length ? (
                    <ul className="mt-1 space-y-0.5">
                        {update.changes.slice(0, 4).map((change, index) => (
                            <li key={`${change.kind}-${index}`} className={state === "undone" ? "line-through opacity-60" : undefined}>
                                <span className="opacity-70">
                                    {t("canvasA.memoryCard.changeLine", {
                                        kind: CHANGE_LABEL_KEYS[change.kind] ? t(CHANGE_LABEL_KEYS[change.kind]) : change.kind,
                                        section: SECTION_LABEL_KEYS[change.section] ? t(SECTION_LABEL_KEYS[change.section]) : change.section,
                                    })}
                                </span>
                                {change.after || change.before}
                            </li>
                        ))}
                    </ul>
                ) : null}
                {pending ? <p className="mt-1 opacity-70">{t("canvasA.memoryCard.pendingHint")}</p> : null}
            </div>
            {!pending && update.revisionId && state !== "undone" ? (
                <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} loading={state === "undoing"} onClick={() => void undo()} aria-label={t("canvasA.memoryCard.undoLabel")}>
                    {t("canvasA.memoryCard.undo")}
                </Button>
            ) : null}
        </div>
    );
}

/** Agent 推荐安装技能的卡片：只有用户点击才会安装，装好后下一条消息起 Agent 可以自动使用。 */
export function AgentSkillSuggestionCard({ suggestion, theme }: { suggestion: CloudAgentSkillSuggestion; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [installing, setInstalling] = useState<string | null>(null);
    const [installed, setInstalled] = useState<Record<string, boolean>>({});
    const install = async (skillId: string, name: string) => {
        setInstalling(skillId);
        try {
            await addSkill(skillId);
            setInstalled((current) => ({ ...current, [skillId]: true }));
            message.success(t("canvasA.skillSuggestion.installed", { name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasA.skillSuggestion.installFailed"));
        } finally {
            setInstalling(null);
        }
    };
    return (
        <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-3.5" style={{ color: theme.accent.primary }} aria-hidden="true" />
                {t("canvasA.skillSuggestion.title")}
            </div>
            {suggestion.reason ? (
                <p className="mt-1 leading-5" style={{ color: theme.node.muted }}>
                    {suggestion.reason}
                </p>
            ) : null}
            <ul className="mt-2 space-y-1.5">
                {suggestion.skills.map((skill) => (
                    <li key={skill.skillId} className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 leading-5">
                            <div className="font-medium">{skill.name}</div>
                            {skill.summary ? <div style={{ color: theme.node.muted }}>{skill.summary}</div> : null}
                        </div>
                        {installed[skill.skillId] ? (
                            <span className="inline-flex shrink-0 items-center gap-1 py-1" style={{ color: theme.node.muted }}>
                                <Check className="size-3.5" aria-hidden="true" />
                                {t("canvasA.skillSuggestion.installedBadge")}
                            </span>
                        ) : (
                            <Button
                                size="small"
                                icon={<Plus className="size-3.5" />}
                                loading={installing === skill.skillId}
                                disabled={Boolean(installing)}
                                onClick={() => void install(skill.skillId, skill.name)}
                                aria-label={t("canvasA.skillSuggestion.installLabel", { name: skill.name })}
                            >
                                {t("canvasA.skillSuggestion.install")}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
