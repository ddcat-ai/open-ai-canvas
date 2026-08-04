import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Select, Tag } from "antd";
import { Check, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { nanoid } from "nanoid";

import { AgentChatComposer, AgentChatMessage, AgentWorkingMessage, type CanvasAgentChatMessage } from "@/components/canvas/canvas-agent-chat-ui";
import { ModelPicker } from "@/components/model-picker";
import { computeLineDiff } from "@/lib/text-line-diff";
import { canvasThemes } from "@/lib/canvas-theme";
import { expandSkillMentions, renderSkillPrompt } from "@/lib/canvas/canvas-skill-mentions";
import { navigateToSettings } from "@/lib/settings-navigation";
import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

import { plainTextToChapterHtml, proposeChapterRewrite, type ChapterAiMode, type ChapterAiProposal } from "./chapter-ai-agent";

type Props = {
    open: boolean;
    projectId: string;
    projectName: string;
    chapterId: string;
    chapterTitle: string;
    sourcePlain: string;
    disabled?: boolean;
    onClose: () => void;
    onApply: (proposal: ChapterAiProposal) => void;
    onUndo?: () => void;
    canUndo?: boolean;
};

type ChapterThread = {
    id: string;
    title: string;
    messages: CanvasAgentChatMessage[];
    pendingProposal: ChapterAiProposal | null;
    editedAfter: string;
};

const MAX_STEPS = 6;
const SYSTEM_PROMPT = `你是短剧项目的章节编剧助手，常驻在章节编辑页右侧。
你可以多轮对话，通过工具读取正文、提出改写提案、应用/撤销写回。
规则：
1. 需要改写正文时，先用 chapter_get_text 了解现状（若上下文已足够可跳过），再用 chapter_propose_rewrite 生成提案；不要声称已经写回，除非用户确认并调用 chapter_apply_proposal。
2. 用户说「写回/应用/接受」时调用 chapter_apply_proposal。
3. 用户说「撤销」时调用 chapter_undo_apply。
4. 可用已激活 skill：调用时把 skillId 传给 chapter_propose_rewrite，或在指令里用 @[skill:dir]。
5. 回答简洁，不要解释产品流程，不要输出 JSON。`;

const CHAPTER_TOOLS: ResponseFunctionTool[] = [
    {
        type: "function",
        function: {
            name: "chapter_get_text",
            description: "读取当前章节纯文本正文与标题",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "chapter_list_skills",
            description: "列出当前已激活、可用于文本改写的 skill",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "chapter_propose_rewrite",
            description: "根据指令与可选 skill 生成改写提案（不会自动写回）",
            parameters: {
                type: "object",
                properties: {
                    mode: { type: "string", enum: ["rewrite", "polish", "expand", "shorten", "custom"] },
                    instruction: { type: "string" },
                    skillId: { type: "string", description: "已激活 skill 的 dir" },
                },
                required: ["instruction"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "chapter_apply_proposal",
            description: "把当前待确认提案写回编辑器（未保存，用户可继续改或撤销）",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "chapter_undo_apply",
            description: "撤销最近一次 AI 写回",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
];

export function ChapterAiPanel({ open, projectId, projectName, chapterId, chapterTitle, sourcePlain, disabled, onClose, onApply, onUndo, canUndo }: Props) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);
    const [skillId, setSkillId] = useState<string | undefined>();
    const [selectedModel, setSelectedModel] = useState(() => effectiveConfig.textModel || effectiveConfig.model || "");
    const [threads, setThreads] = useState<ChapterThread[]>(() => [createThread(chapterTitle)]);
    const [activeThreadId, setActiveThreadId] = useState(() => threads[0]?.id || "");
    const listRef = useRef<HTMLDivElement>(null);
    const sourceRef = useRef(sourcePlain);
    const titleRef = useRef(chapterTitle);
    const canUndoRef = useRef(Boolean(canUndo));
    const skillIdRef = useRef<string | undefined>(undefined);
    const modelRef = useRef(selectedModel);
    const pendingRef = useRef<ChapterAiProposal | null>(null);
    const editedAfterRef = useRef("");

    const skillsQuery = useQuery({
        queryKey: ["added-skills", "chapter-ai"],
        queryFn: listAddedSkills,
        enabled: open,
        staleTime: 60_000,
    });
    const skills: Skill[] = skillsQuery.data?.skills || [];
    const activeThread = threads.find((item) => item.id === activeThreadId) || threads[0];

    useEffect(() => {
        sourceRef.current = sourcePlain;
    }, [sourcePlain]);
    useEffect(() => {
        titleRef.current = chapterTitle;
    }, [chapterTitle]);
    useEffect(() => {
        canUndoRef.current = Boolean(canUndo);
    }, [canUndo]);
    useEffect(() => {
        skillIdRef.current = skillId;
    }, [skillId]);
    useEffect(() => {
        modelRef.current = selectedModel;
    }, [selectedModel]);
    useEffect(() => {
        // 配置变更时：若当前选中为空，或不再合法，回落到 textModel/model
        const fallback = effectiveConfig.textModel || effectiveConfig.model || "";
        setSelectedModel((current) => current || fallback);
    }, [effectiveConfig.model, effectiveConfig.textModel]);
    useEffect(() => {
        pendingRef.current = activeThread?.pendingProposal || null;
        editedAfterRef.current = activeThread?.editedAfter || "";
    }, [activeThread?.editedAfter, activeThread?.pendingProposal]);

    useEffect(() => {
        if (!open) return;
        // 切换章节时新开线程，保留面板打开；同章不重置多轮上下文
        setThreads((current) => {
            if (current.some((thread) => thread.id.startsWith(`${chapterId}:`))) return current;
            const next = createThread(chapterTitle, chapterId);
            setActiveThreadId(next.id);
            return [next, ...current.filter((thread) => !thread.id.startsWith(`${chapterId}:`)).slice(0, 8)];
        });
        setPrompt("");
        setSending(false);
    }, [chapterId, chapterTitle, open]);

    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
        return () => cancelAnimationFrame(frame);
    }, [activeThread?.messages, activeThread?.pendingProposal, open, sending]);

    if (!open || !activeThread) return null;

    const updateActiveThread = (patch: Partial<ChapterThread> | ((thread: ChapterThread) => ChapterThread)) => {
        setThreads((current) => current.map((thread) => {
            if (thread.id !== activeThread.id) return thread;
            return typeof patch === "function" ? patch(thread) : { ...thread, ...patch };
        }));
    };

    const pushMessages = (...items: CanvasAgentChatMessage[]) => {
        updateActiveThread((thread) => ({ ...thread, messages: [...thread.messages, ...items] }));
    };

    const runTool = async (call: ResponseToolCall): Promise<string> => {
        const name = call.function.name;
        const args = parseToolArguments(call.function.arguments);
        if (name === "chapter_get_text") {
            return JSON.stringify({
                title: titleRef.current,
                plainText: sourceRef.current,
                charCount: sourceRef.current.length,
            });
        }
        if (name === "chapter_list_skills") {
            return JSON.stringify({
                skills: skills.map((skill) => ({ id: skill.skill_id, name: skill.skill_name, description: skill.description })),
            });
        }
        if (name === "chapter_propose_rewrite") {
            if (disabled) throw new Error("章节正文尚未加载完成");
            if (!sourceRef.current.trim()) throw new Error("当前章节没有正文");
            const mode = (["rewrite", "polish", "expand", "shorten", "custom"].includes(String(args.mode)) ? String(args.mode) : "rewrite") as ChapterAiMode;
            const instruction = String(args.instruction || "").trim();
            const requestSkillId = String(args.skillId || skillIdRef.current || "").trim() || undefined;
            const skill = skills.find((item) => item.skill_id === requestSkillId);
            if (!instruction && !skill) throw new Error("请提供改写指令或选择 skill");
            const model = (modelRef.current || effectiveConfig.textModel || effectiveConfig.model || "").trim();
            if (!model) throw new Error("请先选择文本模型");
            const proposal = await proposeChapterRewrite({
                projectId,
                chapterId,
                chapterTitle: titleRef.current,
                projectName,
                mode,
                instruction,
                sourcePlain: sourceRef.current,
                sourceHtml: "",
                skill,
                skills,
                config: effectiveConfig,
                model,
            });
            pendingRef.current = proposal;
            editedAfterRef.current = proposal.afterPlain;
            updateActiveThread({ pendingProposal: proposal, editedAfter: proposal.afterPlain });
            return JSON.stringify({
                ok: true,
                mode: proposal.mode,
                skillName: proposal.skillName,
                preview: proposal.afterPlain.slice(0, 400),
                note: "提案已生成，等待用户确认写回。可提示用户查看 diff 卡片。",
            });
        }
        if (name === "chapter_apply_proposal") {
            const proposal = pendingRef.current;
            if (!proposal) throw new Error("没有待写回的提案，请先生成改写提案");
            const plain = (editedAfterRef.current || proposal.afterPlain).trim();
            const next: ChapterAiProposal = {
                ...proposal,
                afterPlain: plain,
                afterHtml: plain === proposal.afterPlain ? proposal.afterHtml : plainTextToChapterHtml(plain),
            };
            onApply(next);
            pendingRef.current = null;
            editedAfterRef.current = "";
            updateActiveThread({ pendingProposal: null, editedAfter: "" });
            return JSON.stringify({ ok: true, message: "已写回编辑器（未自动保存）" });
        }
        if (name === "chapter_undo_apply") {
            if (!canUndoRef.current || !onUndo) throw new Error("当前没有可撤销的 AI 写回");
            onUndo();
            return JSON.stringify({ ok: true, message: "已撤销最近一次 AI 写回" });
        }
        throw new Error(`未知工具：${name}`);
    };

    const send = async () => {
        const text = prompt.trim();
        if (!text || sending) return;
        const model = (selectedModel || effectiveConfig.textModel || effectiveConfig.model || "").trim();
        if (!model) {
            message.warning("请先选择文本模型");
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const skill = skills.find((item) => item.skill_id === skillId);
        const userVisible = skill ? `${text}\n\n（附带技能：${skill.skill_name}）` : text;
        const userMessage: CanvasAgentChatMessage = { id: nanoid(), role: "user", text: userVisible };
        const historyForModel = [...activeThread.messages, userMessage];
        pushMessages(userMessage);
        setPrompt("");
        setSending(true);
        try {
            const prior = historyForModel
                .filter((item) => item.role === "user" || item.role === "assistant")
                .slice(-8)
                .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.text}`)
                .join("\n");
            let input: ResponseInputMessage[] = [
                {
                    role: "user",
                    content: [
                        SYSTEM_PROMPT,
                        prior ? `【近期对话】\n${prior}` : "",
                        `项目：${projectName}`,
                        `章节：${titleRef.current}`,
                        `章节 ID：${chapterId}`,
                        `当前模型：${model}`,
                        skill ? `用户已点选技能：${skill.skill_name}（${skill.skill_id}）\n${renderSkillPrompt(skill)}` : "",
                        `当前正文摘要：\n${sourceRef.current.slice(0, 8000)}`,
                        `用户：${expandSkillMentions(text, skills)}`,
                    ]
                        .filter(Boolean)
                        .join("\n\n"),
                },
            ];

            for (let step = 0; step < MAX_STEPS; step += 1) {
                const result = await requestToolResponse({ ...effectiveConfig, model, textModel: model, systemPrompt: "" }, input, CHAPTER_TOOLS, "auto");
                if (result.toolCalls?.length) {
                    const toolResults: Array<{ call: ResponseToolCall; output: string; error?: string }> = [];
                    for (const call of result.toolCalls) {
                        const name = call.function.name;
                        pushMessages({
                            id: nanoid(),
                            role: "tool",
                            title: toolTitle(name),
                            text: toolPendingText(name),
                            detail: { name, arguments: parseToolArguments(call.function.arguments), status: "running" },
                        });
                        try {
                            const output = await runTool(call);
                            toolResults.push({ call, output });
                            pushMessages({
                                id: nanoid(),
                                role: "tool",
                                title: toolTitle(name),
                                text: toolDoneText(name, output),
                                detail: { name, arguments: parseToolArguments(call.function.arguments), status: "done", output: safeJson(output) },
                            });
                        } catch (error) {
                            const errText = error instanceof Error ? error.message : "工具失败";
                            toolResults.push({ call, output: JSON.stringify({ error: errText }), error: errText });
                            pushMessages({
                                id: nanoid(),
                                role: "tool",
                                title: toolTitle(name),
                                text: errText,
                                detail: { name, status: "error", error: errText },
                            });
                        }
                    }
                    input = [
                        ...input,
                        ...(result.content?.trim()
                            ? [{ role: "assistant" as const, content: result.content }]
                            : []),
                        ...result.toolCalls.map((call) => ({
                            type: "function_call" as const,
                            call_id: call.id,
                            name: call.function.name,
                            arguments: call.function.arguments,
                            ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
                        })),
                        ...toolResults.map(({ call, output }) => ({
                            role: "tool" as const,
                            tool_call_id: call.id,
                            content: output,
                        })),
                    ];
                    continue;
                }
                const answer = (result.content || "").trim() || "好的。";
                pushMessages({ id: nanoid(), role: "assistant", text: answer });
                break;
            }
        } catch (error) {
            pushMessages({ id: nanoid(), role: "error", text: error instanceof Error ? error.message : "章节 Agent 请求失败" });
            message.error(error instanceof Error ? error.message : "章节 Agent 请求失败");
        } finally {
            setSending(false);
        }
    };

    const applyPending = () => {
        const proposal = activeThread.pendingProposal;
        if (!proposal) return;
        const plain = (activeThread.editedAfter || proposal.afterPlain).trim();
        onApply({
            ...proposal,
            afterPlain: plain,
            afterHtml: plain === proposal.afterPlain ? proposal.afterHtml : plainTextToChapterHtml(plain),
        });
        pendingRef.current = null;
        updateActiveThread({ pendingProposal: null, editedAfter: "" });
        pushMessages({ id: nanoid(), role: "system", text: "已写回正文（未保存）" });
    };

    const diffLines = useMemo(() => {
        if (!activeThread.pendingProposal) return [];
        return computeLineDiff(activeThread.pendingProposal.beforePlain, activeThread.editedAfter || activeThread.pendingProposal.afterPlain);
    }, [activeThread.editedAfter, activeThread.pendingProposal]);

    const newThread = () => {
        const next = createThread(chapterTitle, chapterId);
        setThreads((current) => [next, ...current].slice(0, 12));
        setActiveThreadId(next.id);
        setPrompt("");
    };

    return (
        <aside className="flex h-full min-h-0 w-full max-w-[420px] flex-col overflow-hidden border-l border-border/80 bg-background">
            <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
                <Sparkles className="size-4 text-[var(--workspace-accent)]" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">章节 Agent</div>
                    <div className="truncate text-[10px] text-foreground/45">{chapterTitle}</div>
                </div>
                {canUndo && onUndo ? (
                    <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={onUndo} title="撤销 AI 写回" />
                ) : null}
                <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={newThread} title="新对话" />
                <button type="button" className="grid size-7 place-items-center rounded hover:bg-foreground/[.06]" onClick={onClose} aria-label="关闭">
                    <X className="size-4" />
                </button>
            </header>

            {threads.length > 1 ? (
                <div className="thin-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5">
                    {threads.filter((thread) => thread.id.startsWith(`${chapterId}:`) || thread.id === activeThreadId).map((thread) => (
                        <button
                            key={thread.id}
                            type="button"
                            className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${thread.id === activeThreadId ? "bg-foreground/[.08] font-medium" : "text-foreground/55 hover:bg-foreground/[.04]"}`}
                            onClick={() => setActiveThreadId(thread.id)}
                        >
                            {thread.title}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-foreground/45">模型</span>
                    <div className="min-w-0 flex-1">
                        <ModelPicker
                            config={effectiveConfig}
                            value={selectedModel || effectiveConfig.textModel || effectiveConfig.model}
                            capability="text"
                            fullWidth
                            placeholder="选择文本模型"
                            onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            onChange={(model) => {
                                setSelectedModel(model);
                                modelRef.current = model;
                            }}
                        />
                    </div>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-foreground/45">技能</span>
                    <Select
                        className="min-w-0 flex-1"
                        size="small"
                        allowClear
                        placeholder={skills.length ? "可选，附带到本轮" : "无已激活技能"}
                        value={skillId}
                        options={skills.map((skill) => ({ value: skill.skill_id, label: skill.skill_name }))}
                        onChange={(value) => setSkillId(value)}
                    />
                </div>
            </div>

            <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {!activeThread.messages.length && !activeThread.pendingProposal ? (
                    <div className="px-1 py-6 text-center text-xs leading-5 text-foreground/40">
                        直接说你想怎么改这一章。
                        <div className="mt-1 text-[11px] opacity-80">例如：开场更抓人 / 压缩对白 / 用某个 skill 润色</div>
                    </div>
                ) : null}
                {activeThread.messages.map((item) => (
                    <AgentChatMessage key={item.id} item={item} theme={theme} user={user} />
                ))}
                {sending ? <AgentWorkingMessage theme={theme} /> : null}

                {activeThread.pendingProposal ? (
                    <div className="rounded-lg border border-border/80 p-2.5" style={{ background: theme.spatial?.surface || undefined }}>
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <Tag className="!m-0">待写回</Tag>
                            {activeThread.pendingProposal.skillName ? <Tag className="!m-0">{activeThread.pendingProposal.skillName}</Tag> : null}
                        </div>
                        <div className="thin-scrollbar mb-2 max-h-36 overflow-auto rounded-md border border-border/60 bg-foreground/[.02] font-mono text-[10px] leading-4">
                            {diffLines.slice(0, 80).map((line, index) => (
                                <div
                                    key={`${line.type}-${index}`}
                                    className={`whitespace-pre-wrap px-2 py-0.5 ${line.type === "add" ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200" : line.type === "del" ? "bg-red-500/10 text-red-700 line-through dark:text-red-200" : "text-foreground/55"}`}
                                >
                                    <span className="mr-1 inline-block w-3 opacity-50">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                                    {line.text || " "}
                                </div>
                            ))}
                            {diffLines.length > 80 ? <div className="px-2 py-1 text-foreground/40">… 其余已省略，完整内容在下方可编辑</div> : null}
                        </div>
                        <textarea
                            className="thin-scrollbar mb-2 max-h-40 min-h-24 w-full resize-y rounded-md border border-border/70 bg-transparent px-2 py-1.5 text-xs leading-5 outline-none"
                            value={activeThread.editedAfter}
                            onChange={(event) => updateActiveThread({ editedAfter: event.target.value })}
                        />
                        <div className="flex gap-2">
                            <Button type="primary" className="flex-1" size="small" icon={<Check className="size-3.5" />} onClick={applyPending}>
                                写回
                            </Button>
                            <Button size="small" onClick={() => updateActiveThread({ pendingProposal: null, editedAfter: "" })}>
                                丢弃
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <AgentChatComposer
                prompt={prompt}
                disabled={disabled || sending}
                sending={sending}
                placeholder="继续聊：改这一段、换语气、用 skill…"
                theme={theme}
                onPromptChange={setPrompt}
                onSubmit={() => void send()}
            />
        </aside>
    );
}

function createThread(chapterTitle: string, chapterId = "draft"): ChapterThread {
    return {
        id: `${chapterId}:${nanoid(6)}`,
        title: "对话",
        messages: [],
        pendingProposal: null,
        editedAfter: "",
    };
}

function toolTitle(name: string) {
    switch (name) {
        case "chapter_get_text":
            return "读取正文";
        case "chapter_list_skills":
            return "技能列表";
        case "chapter_propose_rewrite":
            return "生成提案";
        case "chapter_apply_proposal":
            return "写回正文";
        case "chapter_undo_apply":
            return "撤销写回";
        default:
            return name;
    }
}

function toolPendingText(name: string) {
    return `正在执行 ${toolTitle(name)}…`;
}

function toolDoneText(name: string, output: string) {
    if (name === "chapter_propose_rewrite") return "提案已就绪，可在下方 diff 卡片确认写回";
    if (name === "chapter_apply_proposal") return "已写回编辑器";
    if (name === "chapter_undo_apply") return "已撤销写回";
    try {
        const parsed = JSON.parse(output) as { skills?: unknown[]; charCount?: number };
        if (Array.isArray(parsed.skills)) return `已激活 ${parsed.skills.length} 个技能`;
        if (typeof parsed.charCount === "number") return `已读取正文（${parsed.charCount} 字）`;
    } catch {
        /* ignore */
    }
    return "完成";
}

function safeJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function parseToolArguments(raw: string) {
    try {
        const parsed = JSON.parse(raw || "{}");
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
