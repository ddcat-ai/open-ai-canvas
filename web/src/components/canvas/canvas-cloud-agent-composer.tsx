// 画布 Agent 输入区：场景胶囊、输入框（附件、@ 引用、/ 技能）、发送/插话/停止按钮与图片预览。
//
// 运行中输入框保持可用（产品约定，勿收紧）：发送走插话，停止由 running 驱动，两者互不排斥。

import type { Skill, SkillPreset } from "@/services/api/skills";
import { ArrowLeft, ArrowUp, AtSign, Bookmark, Clapperboard, ImagePlus, Layers3, LoaderCircle, Palette, Shapes, Share2, ShoppingBag, Sparkles, Square, X } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { buildSkillMentionReferences } from "@/services/skill-runtime";
import { motion, useReducedMotion } from "motion/react";
import { WorkingGlow } from "@/components/ai/working-indicator";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Button } from "antd";
import { agentAttachmentReferences, type CloudAgentChatAttachment } from "./canvas-cloud-agent-attachments";

export const MIN_AGENT_PROMPT_HEIGHT = 60;

export const MAX_AGENT_PROMPT_HEIGHT = 240;

export function clampAgentPromptHeight(height: number) {
    return Math.min(MAX_AGENT_PROMPT_HEIGHT, Math.max(MIN_AGENT_PROMPT_HEIGHT, Math.ceil(height)));
}

/**
 * 场景起步胶囊：把「我大概想做 X」一步翻译成一组技能。
 * 两组来源，都不限剧典技能：
 *  1) 配方组——只读消费 GET /skills/presets（随二进制内置的手工策展配方）
 *  2) 常用组——用户已装（其中可含已收藏）及自建的技能，按常用度排序（含官方种子库与自定义）
 * 选择只作用于本会话；缺失的技能会持久安装到当前用户的技能库。
 * 挂上之后具体用哪张卡由 Agent 在任务里检索判断，胶囊只负责"把对的技能送到手边"。
 */
export type AgentSceneBucket = {
    key: string;
    label: string;
    presets: SkillPreset[];
    skills: Skill[];
};

/** 场景分类：与 presets.json 的 scene 字段、技能的 tag 字段共用同一套 key。 */
export const AGENT_SCENE_DEFS: Array<{ key: string; label: string; icon: typeof Sparkles }> = [
    { key: "frequent", label: "我的常用", icon: Bookmark },
    { key: "drama", label: "短剧故事", icon: Clapperboard },
    { key: "ecommerce", label: "广告电商", icon: ShoppingBag },
    { key: "creative", label: "视觉创意", icon: Palette },
    { key: "social", label: "传播社媒", icon: Share2 },
    { key: "others", label: "其他", icon: Shapes },
];

export function AgentSceneCapsules({
    buckets,
    installedIds,
    theme,
    disabled = false,
    onPick,
    onPickSkill,
}: {
    buckets: AgentSceneBucket[];
    installedIds: Set<string>;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    disabled?: boolean;
    onPick: (preset: SkillPreset) => void;
    onPickSkill: (skill: Skill) => void;
}) {
    // 始终只占一排：默认显示场景分类，点某个场景后在同一排内就地切换内容。
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const capsuleClass = "agent-scene-capsule shrink-0";
    const stop = {
        onMouseDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
        onPointerDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
    };
    const visible = buckets.filter((bucket) => bucket.presets.length + bucket.skills.length > 0);
    const active = activeKey ? visible.find((bucket) => bucket.key === activeKey) || null : null;
    if (!visible.length) return null;
    return (
        <div className="agent-scene-capsules mx-3 mb-2 min-w-0" style={{ color: theme.node.text }}>
            <div className="agent-scene-capsules-heading">
                <Sparkles aria-hidden="true" />
                <span>{active ? active.label : "技能组合推荐"}</span>
            </div>
            <div className="agent-scene-capsules-scroll thin-scrollbar flex gap-2 overflow-x-auto px-1 py-2">
                {active ? (
                    <>
                        <button
                            type="button"
                            disabled={disabled}
                            title="返回全部场景"
                            className={capsuleClass}
                            data-scene="back"
                            {...stop}
                            onClick={(event) => {
                                event.stopPropagation();
                                setActiveKey(null);
                            }}
                        >
                            <ArrowLeft aria-hidden="true" />
                            <span>全部场景</span>
                        </button>
                        {active.presets.map((preset) => {
                            const missing = preset.skillIds.filter((id) => !installedIds.has(id)).length;
                            return (
                                <button
                                    key={preset.presetId}
                                    type="button"
                                    disabled={disabled}
                                    title={preset.rationale}
                                    className={capsuleClass}
                                    data-scene={active.key}
                                    {...stop}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onPick(preset);
                                    }}
                                >
                                    <Layers3 aria-hidden="true" />
                                    <span className="agent-scene-capsule-label">{preset.name}</span>
                                    <span className="agent-scene-capsule-meta">{missing > 0 ? `${preset.skillIds.length} 技能 · ${missing} 待装` : `${preset.skillIds.length} 技能`}</span>
                                </button>
                            );
                        })}
                        {active.skills.map((skill) => {
                            const owned = skill.isOwner ? "自建" : skill.isLike ? "已收藏" : installedIds.has(skill.skillId) ? "已装" : "待装";
                            return (
                                <button
                                    key={skill.skillId}
                                    type="button"
                                    disabled={disabled}
                                    title={skill.description}
                                    className={capsuleClass}
                                    data-scene={active.key}
                                    {...stop}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onPickSkill(skill);
                                    }}
                                >
                                    <Sparkles aria-hidden="true" />
                                    <span className="agent-scene-capsule-label">{skill.skillName}</span>
                                    <span className="agent-scene-capsule-meta">{owned}</span>
                                </button>
                            );
                        })}
                    </>
                ) : (
                    visible.map((bucket) => {
                        const count = bucket.presets.length + bucket.skills.length;
                        const Icon = AGENT_SCENE_DEFS.find((definition) => definition.key === bucket.key)?.icon || Shapes;
                        return (
                            <button
                                key={bucket.key}
                                type="button"
                                disabled={disabled}
                                title={`查看「${bucket.label}」下的技能组合`}
                                className={capsuleClass}
                                data-scene={bucket.key}
                                {...stop}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveKey(bucket.key);
                                }}
                            >
                                <Icon aria-hidden="true" />
                                <span className="agent-scene-capsule-label">{bucket.label}</span>
                                <span className="agent-scene-capsule-meta">{count} 项</span>
                            </button>
                        );
                    })
                )}
            </div>
            <p className="agent-scene-capsules-note">仅本会话生效 · 缺失技能将加入技能库 · Agent 按任务调用</p>
        </div>
    );
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    running,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onAddFiles,
    onRemoveAttachment,
    left,
    submitAccessory,
    onStop,
    stopping,
    references = [],
    slashSkills,
    includeAssetLibrary,
}: {
    prompt: string;
    attachments?: CloudAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    running?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void | Promise<void>;
    stopping?: boolean;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    left?: ReactNode;
    /** 发送按钮左侧的附属控件，例如上下文用量环。 */
    submitAccessory?: ReactNode;
    /** 供「@」插入的画布节点/素材/技能引用候选（可选，默认空，缺省时退化为普通输入框） */
    references?: CanvasResourceReference[];
    /** 供「/」弹出的技能候选（可选） */
    slashSkills?: Skill[];
    /** 是否在「@」候选里包含素材库资源 */
    includeAssetLibrary?: boolean;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const [previewAttachment, setPreviewAttachment] = useState<CloudAgentChatAttachment | null>(null);
    const [promptHeight, setPromptHeight] = useState(MIN_AGENT_PROMPT_HEIGHT);
    const promptResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const manualPromptHeightRef = useRef<number | null>(null);
    const availableSlashSkills = slashSkills ?? [];
    const slashCandidates = useMemo(() => {
        const query = slash?.query.trim().toLocaleLowerCase() || "";
        if (!query) return availableSlashSkills;
        return availableSlashSkills.filter((skill) => `${skill.skillName} ${skill.description || ""}`.toLocaleLowerCase().includes(query));
    }, [availableSlashSkills, slash?.query]);
    const attachmentReferences = useMemo(() => agentAttachmentReferences(attachments), [attachments]);
    const skillReferences = useMemo(() => buildSkillMentionReferences(availableSlashSkills), [availableSlashSkills]);
    const composerReferences = useMemo(() => [...references, ...skillReferences, ...attachmentReferences].filter((reference, index, all) => all.findIndex((item) => item.id === reference.id) === index), [attachmentReferences, references, skillReferences]);
    const canStop = Boolean(running && onStop);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const reducedMotion = useReducedMotion();
    const activeSlashIndex = Math.min(Math.max(slashIndex, 0), Math.max(slashCandidates.length - 1, 0));

    const handlePromptContentSizeChange = useCallback((naturalHeight: number) => {
        const nextHeight = clampAgentPromptHeight(naturalHeight);
        // 用户开始拖动后，面板高度由用户掌控；超出部分交给内部滚动区，
        // 避免输入新内容时又把手动缩小的面板强行撑开。
        setPromptHeight((currentHeight) => (manualPromptHeightRef.current === null ? nextHeight : currentHeight));
    }, []);

    useEffect(() => {
        if (prompt.trim()) return;
        manualPromptHeightRef.current = null;
        setPromptHeight(MIN_AGENT_PROMPT_HEIGHT);
    }, [prompt]);

    const startPromptResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        event.preventDefault();
        manualPromptHeightRef.current = promptHeight;
        promptResizeRef.current = { startY: event.clientY, startHeight: promptHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const resizePrompt = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const resize = promptResizeRef.current;
        if (!resize) return;
        setPromptHeight(clampAgentPromptHeight(resize.startHeight + resize.startY - event.clientY));
    };

    const finishPromptResize = (event?: ReactPointerEvent<HTMLButtonElement>) => {
        promptResizeRef.current = null;
        if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const resizePromptByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        manualPromptHeightRef.current = promptHeight;
        setPromptHeight(clampAgentPromptHeight(promptHeight + (event.key === "ArrowUp" ? 20 : -20)));
    };

    // 在输入值末尾检测「/ 或 、+ 关键词」打开技能候选：中文输入法下 "/" 会打成 "、"，两者等价，且都必须紧跟行首或空白，避免中文顿号误触发。选中后写入稳定 token，编辑器再把它渲染为技能 chip。
    const handlePromptChange = (value: string) => {
        onPromptChange(value);
        const match = /(^|\s)[/、]([^\s/、]*)$/.exec(value);
        if (match && availableSlashSkills.length) {
            const next = { start: match.index + match[1].length, query: match[2] };
            setSlash((current) => (current && current.start === next.start && current.query === next.query ? current : next));
            setSlashIndex(0);
        } else if (slash) {
            setSlash(null);
        }
    };

    const applySlashSkill = (skill: Skill) => {
        const token = `@[skill:${skill.skillId}] `;
        // 触发符 "/" 与 "、" 都是单字符，替换长度固定为 1。
        const next = slash ? `${prompt.slice(0, slash.start)}${token}${prompt.slice(slash.start + 1 + slash.query.length)}` : prompt ? `${prompt.replace(/\s+$/u, "")} ${token}` : token;
        setSlash(null);
        setSlashIndex(0);
        onPromptChange(next);
    };

    // slash 菜单的键盘控制在 capture 阶段拦截（contentEditable/textarea 内部先消费 Enter，外层冒泡拿不到）
    const handleSlashKeyCapture = (event: ReactKeyboardEvent) => {
        if (!slash || !slashCandidates.length) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.min(index + 1, slashCandidates.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            applySlashSkill(slashCandidates[activeSlashIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSlash(null);
        }
    };

    // 保留粘贴图片成附件（contentEditable 模式内部会把粘贴转纯文本，capture 阶段先拦截图片）
    const handlePasteCapture = (event: ReactClipboardEvent) => {
        if (!onAddFiles) return;
        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        event.preventDefault();
        event.stopPropagation();
        void onAddFiles(images);
    };

    const insertAttachmentMention = (item: CloudAgentChatAttachment) => {
        const token = `@[attachment:${item.id}] `;
        if (prompt.includes(`@[attachment:${item.id}]`)) return;
        onPromptChange(prompt ? `${prompt.replace(/\s+$/u, "")} ${token}` : token);
    };

    return (
        <div className="agent-composer-wrap min-w-0 shrink-0" onWheelCapture={(event) => event.stopPropagation()}>
            <div
                className="agent-composer-surface group/composer relative transition-[background-color,box-shadow] duration-200"
                style={{
                    color: theme.accent.primary,
                }}
            >
                {sending && !reducedMotion ? <WorkingGlow active color={theme.accent.primary} radius={22} /> : null}
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item, index) => (
                            <div key={item.id} className="group relative w-20 shrink-0">
                                <button
                                    type="button"
                                    className="relative block size-20 overflow-hidden rounded-lg"
                                    title="点击放大预览"
                                    aria-label={`预览 ${item.name || `图片${index + 1}`}`}
                                    onClick={() => setPreviewAttachment(item)}
                                    onDoubleClick={() => setPreviewAttachment(item)}
                                >
                                    <img src={item.url} alt={item.name} className="size-full object-cover" />
                                </button>
                                <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
                                    <button type="button" className="flex min-w-0 items-center gap-0.5 truncate text-[var(--fs-tiny)] opacity-80 hover:opacity-100" title={`插入 @图片${index + 1}`} onClick={() => insertAttachmentMention(item)}>
                                        <AtSign className="size-2.5 shrink-0" />
                                        <span className="truncate">图片{index + 1}</span>
                                    </button>
                                    {onRemoveAttachment ? (
                                        <button
                                            type="button"
                                            className="grid size-4 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"
                                            style={{ background: theme.toolbar.panel, color: theme.node.text }}
                                            onClick={() => onRemoveAttachment(item.id)}
                                            aria-label="移除图片"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="relative" onKeyDownCapture={handleSlashKeyCapture} onPasteCapture={handlePasteCapture}>
                    <button
                        type="button"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="调整提示词面板高度"
                        aria-valuemin={MIN_AGENT_PROMPT_HEIGHT}
                        aria-valuemax={MAX_AGENT_PROMPT_HEIGHT}
                        aria-valuenow={promptHeight}
                        className="agent-composer-resize-handle"
                        style={{ color: theme.node.muted }}
                        onPointerDown={startPromptResize}
                        onPointerMove={resizePrompt}
                        onPointerUp={finishPromptResize}
                        onPointerCancel={finishPromptResize}
                        onKeyDown={resizePromptByKeyboard}
                    >
                        <span />
                    </button>
                    <div className="agent-composer-prompt-scroll" style={{ height: promptHeight }}>
                        <CanvasResourceMentionTextarea
                            value={prompt}
                            references={composerReferences}
                            includeAssetLibrary={includeAssetLibrary}
                            sendOnEnter={canSubmit ? "both" : false}
                            disabled={disabled}
                            onChange={handlePromptChange}
                            onSubmit={() => {
                                if (canSubmit) onSubmit();
                            }}
                            onContentSizeChange={handlePromptContentSizeChange}
                            className="w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                            containerClassName="min-h-[60px] h-full"
                            style={{ color: theme.node.text }}
                            placeholder={placeholder}
                            aria-label="Agent 输入"
                        />
                    </div>
                    {slash && slashCandidates.length ? (
                        <div
                            data-agent-slash-menu
                            className="absolute bottom-full left-0 z-[var(--z-toolbar)] mb-2 w-full max-w-xs overflow-hidden rounded-2xl p-1.5 shadow-2xl"
                            style={{ background: theme.toolbar.panel, boxShadow: `0 18px 44px ${theme.spatial.shadow}` }}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {slashCandidates.map((skill, index) => (
                                <button
                                    key={skill.skillId}
                                    type="button"
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                                    style={{ background: index === activeSlashIndex ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                    onMouseEnter={() => setSlashIndex(index)}
                                    onClick={() => applySlashSkill(skill)}
                                >
                                    <Sparkles className="size-3.5 shrink-0 opacity-70" />
                                    <span className="min-w-0 truncate font-medium">{skill.skillName}</span>
                                    {skill.description ? <span className="min-w-0 flex-1 truncate opacity-50">{skill.description}</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="agent-composer-toolbar mt-2">
                    <div className="agent-composer-controls flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    hidden
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(event) => {
                                        void onAddFiles(event.target.files);
                                        event.target.value = "";
                                    }}
                                />
                                <Tooltip title="上传图片">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!h-8 !w-8 !min-w-8 !transition-transform hover:!scale-105 active:!scale-95"
                                        disabled={sending}
                                        style={{ color: theme.node.muted }}
                                        icon={<ImagePlus className="size-4" />}
                                        onClick={() => fileInputRef.current?.click()}
                                    />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <div className="agent-composer-submit flex items-center gap-2">
                        {submitAccessory}
                        {canStop ? (
                            <motion.button
                                type="button"
                                disabled={stopping}
                                aria-label="停止本轮"
                                title="停止当前 Agent 运行"
                                onClick={() => void onStop?.()}
                                whileHover={!reducedMotion && !stopping ? { scale: 1.06, y: -1 } : undefined}
                                whileTap={!reducedMotion && !stopping ? { scale: 0.9, y: 1 } : undefined}
                                animate={stopping && !reducedMotion ? { scale: [1, 0.94, 1] } : { scale: 1 }}
                                transition={{ type: "spring", stiffness: 420, damping: 24 }}
                                className="grid size-7 shrink-0 place-items-center rounded-full p-0 outline-none transition-[background-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                                style={{ background: theme.accent.danger, color: theme.accent.onPrimary }}
                            >
                                {stopping ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-3.5" fill="currentColor" />}
                            </motion.button>
                        ) : null}
                        <motion.button
                            type="button"
                            disabled={!canSubmit}
                            aria-label={sending ? "发送中" : canStop ? "插话" : "发送"}
                            title={canStop ? "插话：Agent 下一次开口时看到它" : "点击发送；Enter 或 ⌘/Ctrl+Enter 发送"}
                            onClick={() => onSubmit()}
                            whileHover={canSubmit && !reducedMotion ? { scale: 1.06, y: -1 } : undefined}
                            whileTap={canSubmit && !reducedMotion ? { scale: 0.9, y: 1 } : undefined}
                            animate={stopping && !reducedMotion ? { scale: [1, 0.94, 1] } : { scale: 1, rotate: 0 }}
                            transition={sending && !reducedMotion ? { duration: 0.42, ease: "easeOut" } : { type: "spring", stiffness: 420, damping: 24 }}
                            data-icon-only
                            className="agent-composer-send grid size-7 shrink-0 place-items-center rounded-full p-0 outline-none transition-[background-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                            style={{
                                background: canSubmit || sending ? theme.accent.primary : theme.spatial.surface,
                                color: canSubmit || sending ? theme.accent.onPrimary : theme.node.muted,
                            }}
                        >
                            <motion.span
                                key={stopping ? "stopping" : sending ? "sending" : "ready"}
                                initial={reducedMotion ? false : { opacity: 0, scale: 0.65, rotate: sending ? -25 : 25 }}
                                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
                                className="grid place-items-center"
                            >
                                {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                            </motion.span>
                        </motion.button>
                    </div>
                </div>
            </div>
            {previewAttachment ? <AgentImagePreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} /> : null}
        </div>
    );
}

export function AgentImagePreview({ attachment, onClose }: { attachment: CloudAgentChatAttachment; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[var(--z-dialog-popover)] grid place-items-center bg-black/80 p-6" role="dialog" aria-label={attachment.name} onClick={onClose}>
            <img src={attachment.url} alt={attachment.name} className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
            <button type="button" className="absolute right-5 top-5 rounded-full bg-black/60 p-2 text-white" onClick={onClose} aria-label="关闭图片预览">
                <X className="size-5" />
            </button>
        </div>
    );
}
