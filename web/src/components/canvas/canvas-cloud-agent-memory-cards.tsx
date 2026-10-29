import { App, Button } from "antd";
import { BookMarked, Check, Plus, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";

import type { canvasThemes } from "@/lib/canvas-theme";
import { undoAgentMemoryRevision } from "@/services/api/agent-memory";
import { addSkill } from "@/services/api/skills";
import type { CloudAgentMemoryUpdate, CloudAgentSkillSuggestion } from "./canvas-cloud-agent-chat-ui";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

const SECTION_LABELS: Record<string, string> = { user: "关于用户", notes: "工作笔记" };
const CHANGE_LABELS: Record<string, string> = { add: "新增", replace: "改写", remove: "删除" };

/** 聊天里的记忆变更卡：说明 Agent 记住或改了什么；已生效的修改可以一键撤销。 */
export function AgentMemoryUpdateCard({ update, theme }: { update: CloudAgentMemoryUpdate; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const [state, setState] = useState<"idle" | "undoing" | "undone">("idle");
    const pending = update.status === "pending";
    const undo = async () => {
        if (!update.revisionId) return;
        setState("undoing");
        try {
            await undoAgentMemoryRevision(update.revisionId);
            setState("undone");
            message.success("已撤销这次记忆修改");
        } catch (error) {
            setState("idle");
            message.error(error instanceof Error ? error.message : "撤销失败");
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
                        {state === "undone" ? "已撤销这次记忆修改" : pending ? "Agent 想修改长期记忆，等你确认" : "长期记忆已更新"}
                    </span>
                    {update.summary ? <span className="opacity-70">{update.summary}</span> : null}
                </div>
                {update.changes.length ? (
                    <ul className="mt-1 space-y-0.5">
                        {update.changes.slice(0, 4).map((change, index) => (
                            <li key={`${change.kind}-${index}`} className={state === "undone" ? "line-through opacity-60" : undefined}>
                                <span className="opacity-70">
                                    {CHANGE_LABELS[change.kind] || change.kind} · {SECTION_LABELS[change.section] || change.section}：
                                </span>
                                {change.after || change.before}
                            </li>
                        ))}
                    </ul>
                ) : null}
                {pending ? <p className="mt-1 opacity-70">在「Agent 设置 → 个人记忆」里确认后才会生效。</p> : null}
            </div>
            {!pending && update.revisionId && state !== "undone" ? (
                <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} loading={state === "undoing"} onClick={() => void undo()} aria-label="撤销这次记忆修改">
                    撤销
                </Button>
            ) : null}
        </div>
    );
}

/** Agent 推荐安装技能的卡片：只有用户点击才会安装，装好后下一条消息起 Agent 可以自动使用。 */
export function AgentSkillSuggestionCard({ suggestion, theme }: { suggestion: CloudAgentSkillSuggestion; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const [installing, setInstalling] = useState<string | null>(null);
    const [installed, setInstalled] = useState<Record<string, boolean>>({});
    const install = async (skillId: string, name: string) => {
        setInstalling(skillId);
        try {
            await addSkill(skillId);
            setInstalled((current) => ({ ...current, [skillId]: true }));
            message.success(`已安装「${name}」，下一条消息起 Agent 可以自动使用`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "安装失败");
        } finally {
            setInstalling(null);
        }
    };
    return (
        <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-3.5" style={{ color: theme.accent.primary }} aria-hidden="true" />
                Agent 推荐安装技能
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
                                已安装
                            </span>
                        ) : (
                            <Button size="small" icon={<Plus className="size-3.5" />} loading={installing === skill.skillId} disabled={Boolean(installing)} onClick={() => void install(skill.skillId, skill.name)} aria-label={`安装技能 ${skill.name}`}>
                                安装
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
