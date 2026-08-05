import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import localforage from "localforage";
import { App, Drawer, Modal, Popover, Spin, Tooltip } from "antd";
import { ArrowUp, Check, ChevronDown, Clock3, Download, FileText, Film, History, Image as ImageIcon, Maximize2, MessageSquareText, Music2, Plus, RefreshCw, SlidersHorizontal, Sparkles, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { ModelPicker } from "@/components/model-picker";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { createClientId } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import { VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { parseBackendGenerationResult, runBackendGenerationTask, runBackendGenerationTaskBatch } from "@/services/api/generation-task";
import { requestImageQuestion } from "@/services/api/image";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { modelDisplayName, modelOptionName, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { buildCreationMentionReferences, creationReferenceMetadata, displayCreationPrompt, expandCreationPrompt, selectedCreationReferences, type CreationReference } from "./creation-references";

type CreationMode = "text" | "image" | "video";
type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
type CreationAttachment = ReferenceImage & { previewUrl: string };
type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string };
type CreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: CreationMode;
    content: string;
    createdAt: string;
    status?: CreationStatus;
    model?: string;
    resultUrls?: string[];
    error?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
};
type CreationConversation = { id: string; title: string; updatedAt: string; messages: CreationMessage[] };

const STORAGE_KEY = "creation-conversations-v1";
const modeLabels: Record<CreationMode, string> = { text: "文本", image: "图片", video: "视频" };
const ratioOptions = [
    { value: "1:1", label: "方形" },
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
];
const qualityOptions = [
    { value: "auto", label: "自动", description: "由模型决定" },
    { value: "low", label: "低", description: "更快生成" },
    { value: "medium", label: "中", description: "均衡模式" },
    { value: "high", label: "高", description: "优先细节" },
];
const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
const countOptions = ["1", "2", "3", "4"];
const conversationTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

function newMessage(role: CreationMessage["role"], content: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id: createClientId(), role, content, createdAt: new Date().toISOString(), ...extra };
}

export default function CreatePage() {
    const { message: toast } = App.useApp();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [conversations, setConversations] = useState<CreationConversation[]>([]);
    const [activeId, setActiveId] = useState("");
    const [hydrated, setHydrated] = useState(false);
    const [mode, setMode] = useState<CreationMode>("video");
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [busy, setBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [activeId, conversations]);
    const historyConversations = useMemo(
        () => conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt)),
        [activeId, conversations],
    );
    const selectedModel = mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const mentionReferences = useMemo(() => buildCreationMentionReferences(addedSkills, attachments, draftReferences), [addedSkills, attachments, draftReferences]);
    const isEmpty = !activeConversation?.messages.length;
    const pendingMediaKey = useMemo(() => pendingCreationMediaKey(conversations), [conversations]);

    useEffect(() => {
        let cancelled = false;
        void localforage.getItem<CreationConversation[]>(STORAGE_KEY).then((stored) => {
            if (cancelled) return;
            const next = stored?.length ? stored : [newConversation()];
            setConversations(next);
            setActiveId(next[0].id);
            setHydrated(true);
        });
        return () => {
            cancelled = true;
            // 页面卸载只停止当前页面的状态更新，后台任务由任务中心继续执行，返回页面后再恢复状态。
        };
    }, []);

    useEffect(() => {
        if (hydrated) void localforage.setItem(STORAGE_KEY, conversations);
    }, [conversations, hydrated]);

    useEffect(() => {
        if (!hydrated || !pendingMediaKey) return;
        let cancelled = false;
        const syncTasks = async () => {
            try {
                const summaries = await listGenerationTasks(100);
                const tasks = await enrichCreationTaskSummaries(summaries);
                if (cancelled) return;
                taskSyncWarningRef.current = false;
                setConversations((current) => reconcileCreationTaskMessages(current, tasks));
            } catch (error) {
                if (cancelled) return;
                console.warn("创作任务状态同步失败", error);
                if (!taskSyncWarningRef.current) {
                    taskSyncWarningRef.current = true;
                    toast.warning("任务状态暂时无法同步，请稍后刷新");
                }
            }
        };
        void syncTasks();
        const timer = window.setInterval(() => void syncTasks(), 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hydrated, pendingMediaKey, toast]);

    useEffect(() => {
        let cancelled = false;
        listAddedSkills().then(({ skills }) => {
            if (!cancelled) setAddedSkills(skills);
        }).catch(() => {
            if (!cancelled) setAddedSkills([]);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!followLatestMessageRef.current) return;
        const frame = window.requestAnimationFrame(() => {
            const container = threadScrollRef.current;
            if (container) container.scrollTop = container.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeConversation?.id, activeConversation?.messages]);

    const updateActive = useCallback((updater: (conversation: CreationConversation) => CreationConversation) => {
        setConversations((current) => current.map((item) => item.id === activeId ? updater(item) : item));
    }, [activeId]);

    const updateAssistant = useCallback((id: string, updater: (item: CreationMessage) => CreationMessage) => {
        updateActive((conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => item.id === id ? updater(item) : item),
        }));
    }, [updateActive]);

    const selectMode = (next: CreationMode) => {
        setMode(next);
        const nextModels = selectableModelsByCapability(config, next);
        const current = next === "text" ? config.textModel : next === "image" ? config.imageModel : config.videoModel;
        if (!nextModels.includes(current) && nextModels[0]) {
            updateConfig(next === "text" ? "textModel" : next === "image" ? "imageModel" : "videoModel", nextModels[0]);
        }
    };

    const addAttachments = (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (!next.length) return;
        void Promise.all(next.slice(0, 6).map(async (file) => {
            const dataUrl = await readFileAsDataUrl(file);
            return { id: createClientId(), name: file.name, type: file.type, dataUrl, previewUrl: dataUrl } satisfies CreationAttachment;
        })).then((items) => setAttachments((current) => [...current, ...items].slice(0, 6))).catch(() => toast.error("参考图读取失败，请重试"));
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) addAttachments(event.target.files);
        event.target.value = "";
    };

    const removeAttachment = (id: string) => {
        const reference = mentionReferences.find((item) => item.attachmentId === id);
        setAttachments((current) => current.filter((item) => item.id !== id));
        if (reference) setPrompt((current) => removeReferenceTokens(current, [reference]));
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || busy || !activeConversation) return;
        if (!selectedModel) {
            toast.warning(`请先在设置中配置${modeLabels[mode]}模型`);
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        const expandedPrompt = expandCreationPrompt(text, references, attachments);
        const referenceMetadata = creationReferenceMetadata(references);
        followLatestMessageRef.current = true;
        const userMessage = newMessage("user", text, { mode, model: selectedModel, attachments, references, settings });
        const assistantMessage = newMessage("assistant", "", { mode, model: selectedModel, status: mode === "text" ? "streaming" : "pending", settings });
        const boundTaskIds = new Set<string>();
        const bindTask = (task: GenerationTask) => {
            if (boundTaskIds.has(task.id)) return;
            boundTaskIds.add(task.id);
            updateAssistant(assistantMessage.id, (item) => ({ ...item, taskIds: Array.from(new Set([...(item.taskIds || []), task.id])) }));
        };
        updateActive((conversation) => ({
            ...conversation,
            title: conversation.messages.length ? conversation.title : text.slice(0, 24),
            updatedAt: new Date().toISOString(),
            messages: [...conversation.messages, userMessage, assistantMessage],
        }));
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;
        const requestConfig = { ...config, model: selectedModel, imageModel: selectedModel, videoModel: selectedModel, textModel: selectedModel, size: ratio, videoSeconds: seconds, quality, vquality: videoQuality, count };
        try {
            if (mode === "text") {
                const history = [...(activeConversation.messages || []), userMessage].map((item) => ({
                    role: item.role,
                    content: item.role === "user"
                        ? buildTextMessageContent(item)
                        : item.content,
                }));
                await requestImageQuestion(requestConfig, history, (text) => updateAssistant(assistantMessage.id, (item) => ({ ...item, content: text })), { signal: controller.signal });
            } else if (mode === "image") {
                const taskCount = Math.max(1, Math.min(15, Math.floor(Number(count) || 1)));
                const settled = await runBackendGenerationTaskBatch({
                    mode: "image",
                    prompt: expandedPrompt,
                    config: { ...requestConfig, count: "1" },
                    referenceImages: attachments,
                    signal: controller.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    count: taskCount,
                });
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const resultUrls = settled.flatMap((entry) => entry.status === "fulfilled" ? (entry.value.images || []).map((image) => image.dataUrl).filter(Boolean) : []);
                const failed = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                if (!resultUrls.length) {
                    const reason = failed[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failed.length) toast.warning(`${resultUrls.length} 张图片已生成，${failed.length} 张生成失败`);
                updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "done", content: failed.length ? `${resultUrls.length} 张图片已生成，${failed.length} 张失败` : "图片已生成", resultUrls }));
            } else {
                const result = await runBackendGenerationTask({
                    mode: "video",
                    prompt: expandedPrompt,
                    config: requestConfig,
                    referenceImages: attachments,
                    signal: controller.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: attachments.length ? "image_to_video" : "text_to_video", ...referenceMetadata },
                    onTaskUpdate: bindTask,
                });
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const videoUrl = result.video.dataUrl;
                updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "done", content: "视频已生成", resultUrls: [videoUrl] }));
            }
            updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "done" }));
        } catch (error) {
            if (controller.signal.aborted) {
                updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "cancelled", content: "已停止" }));
                return;
            }
            const message = generationErrorMessage(error);
            updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "error", error: message, content: "生成失败" }));
        } finally {
            abortRef.current = null;
            setBusy(false);
        }
    };

    const startNewConversation = () => {
        const next = newConversation();
        followLatestMessageRef.current = true;
        setConversations((current) => [next, ...current]);
        setActiveId(next.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const selectConversation = (conversation: CreationConversation) => {
        followLatestMessageRef.current = true;
        setActiveId(conversation.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const restoreMessageDraft = (item: CreationMessage) => {
        const nextMode = item.mode || "text";
        const nextSettings = item.settings;
        setMode(nextMode);
        setPrompt(item.content);
        setAttachments(item.attachments ? [...item.attachments] : []);
        setDraftReferences(item.references ? [...item.references] : []);
        if (item.model) updateConfig(nextMode === "text" ? "textModel" : nextMode === "image" ? "imageModel" : "videoModel", item.model);
        if (!nextSettings) return;
        setRatio(nextSettings.ratio);
        setSeconds(nextSettings.seconds);
        setQuality(nextSettings.quality);
        setVideoQuality(nextSettings.videoQuality);
        setCount(nextSettings.count);
    };

    const retryFailedMessage = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        followLatestMessageRef.current = true;
        restoreMessageDraft(previous);
        const removedIds = new Set([item.id, previous.id]);
        updateActive((conversation) => {
            const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
            const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
            return {
                ...conversation,
                title: firstPrompt ? firstPrompt.slice(0, 24) : "新创作",
                updatedAt: new Date().toISOString(),
                messages,
            };
        });
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        restoreMessageDraft(previous);
    };

    if (!hydrated || !activeConversation) return <div className="grid h-full place-items-center"><Spin /></div>;

    const handleThreadScroll = () => {
        const container = threadScrollRef.current;
        if (!container) return;
        followLatestMessageRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 160;
    };

    const composerProps = {
        mode,
        prompt,
        setPrompt,
        busy,
        attachments,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        fileInputRef,
        onFileChange: handleFileChange,
        onModeChange: selectMode,
        model: selectedModel,
        config,
        onModelChange: (value: string) => updateConfig(mode === "text" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value),
        ratio,
        setRatio,
        seconds,
        setSeconds,
        quality,
        setQuality,
        videoQuality,
        setVideoQuality,
        count,
        setCount,
        onSubmit: submit,
        onStop: () => abortRef.current?.abort(),
    };

    return <>
        <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
            <div className="creation-top-actions">
                {!isEmpty ? <Tooltip title="新建创作"><button type="button" aria-label="新建创作" className="creation-top-action" onClick={startNewConversation}><Plus /></button></Tooltip> : null}
                <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" aria-expanded={historyOpen} className="creation-top-action" onClick={() => setHistoryOpen(true)}><History /></button></Tooltip>
            </div>
            <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-scrollbar flex h-full min-h-0 flex-col overflow-y-scroll overscroll-contain">
                {isEmpty ? <section className="creation-empty-workspace">
                    <CreationIntro mode={mode} />
                    <div className="creation-empty-composer"><CreationComposer {...composerProps} variant="empty" /></div>
                </section> : <>
                    <section className="creation-thread-stage"><div className="creation-results">{activeConversation.messages.map((item, index) => <CreationMessageView key={item.id} item={item} modelName={item.model ? modelDisplayName(config, item.model) : ""} onRetryFailure={() => retryFailedMessage(item, index)} onCreateVariant={() => createVariant(item, index)} />)}</div></section>
                    <section className="creation-thread-composer">
                        <CreationComposer {...composerProps} variant="thread" />
                    </section>
                </>}
            </main>
        </div>
        <CreationHistoryDrawer open={historyOpen} conversations={historyConversations} activeId={activeConversation.id} onClose={() => setHistoryOpen(false)} onSelect={selectConversation} />
    </>;
}

function CreationHistoryDrawer({ open, conversations, activeId, onClose, onSelect }: { open: boolean; conversations: CreationConversation[]; activeId: string; onClose: () => void; onSelect: (conversation: CreationConversation) => void }) {
    return <Drawer open={open} onClose={onClose} placement="right" size="min(360px, 100vw)" closeIcon={<X className="size-4" />} className="creation-history-drawer" rootClassName="creation-history-drawer-root" styles={{ body: { padding: 0 } }} title={<div className="creation-history-title"><span>历史对话</span><small>{conversations.length} 个对话</small></div>}>
        <ol className="creation-history-timeline" aria-label="历史对话，按更新时间倒序排列">
            {conversations.map((conversation) => {
                const latest = conversationPreviewMessage(conversation);
                const active = conversation.id === activeId;
                return <li key={conversation.id} className={active ? "is-active" : ""}>
                    <span className="creation-history-dot" aria-hidden="true" />
                    <button type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation)}>
                        <span className="creation-history-time"><time dateTime={conversation.updatedAt}>{formatConversationTime(conversation.updatedAt)}</time><em>{latest?.mode ? modeLabels[latest.mode] : "创作"}</em></span>
                        <strong className="creation-history-item-heading">{conversation.title.trim() || "新创作"}</strong>
                        <span className="creation-history-snippet">{latest ? displayCreationPrompt(latest.content, latest.references || []).trim() || "还没有开始创作" : "还没有开始创作"}</span>
                    </button>
                </li>;
            })}
        </ol>
    </Drawer>;
}

function CreationMessageView({ item, modelName, onRetryFailure, onCreateVariant }: { item: CreationMessage; modelName: string; onRetryFailure: () => void; onCreateVariant: () => void }) {
    if (item.role === "user") return <CreationUserMessage item={item} />;
    const mode = item.mode || "text";
    const stateLabel = item.status === "pending" ? "生成中" : item.status === "cancelled" ? "已停止" : "";
    return <article className="creation-assistant-message"><div className="creation-message-heading"><span className="creation-message-mark"><Sparkles /></span><span>{modeLabels[mode]}</span>{modelName ? <span className="creation-message-model">{modelName}</span> : null}{stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}</div>{mode === "text" ? <div className="creation-message-content">{item.content ? <ReactMarkdown>{item.content}</ReactMarkdown> : <span>正在生成…</span>}</div> : <MediaResult item={item} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} />}{item.error ? <div className="creation-message-error"><span>{generationErrorMessage(item.error)}</span><button type="button" onClick={onRetryFailure}><RefreshCw />重新生成</button></div> : null}</article>;
}

function CreationUserMessage({ item }: { item: CreationMessage }) {
    const [previewUrl, setPreviewUrl] = useState("");
    return <div className="creation-user-message"><div>{displayCreationPrompt(item.content, item.references || [])}</div>{item.references?.length ? <CreationMessageReferences references={item.references} /> : null}{item.attachments?.length ? <div className="creation-user-message-attachments">{item.attachments.map((attachment) => {
        const url = attachment.previewUrl || attachment.dataUrl || attachment.url || "";
        return <button key={attachment.id} type="button" onClick={() => setPreviewUrl(url)} aria-label={`预览 ${attachment.name}`} disabled={!url}><img src={url} alt={attachment.name} width={44} height={44} loading="lazy" /><span aria-hidden="true"><Maximize2 /></span></button>;
    })}</div> : null}<CreationMediaPreviewModal url={previewUrl} type="image" onClose={() => setPreviewUrl("")} /></div>;
}

function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return <div className="creation-user-message-references" aria-label="本次引用">{references.map((reference) => {
        const Icon = reference.kind === "skill" ? Sparkles : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
        return <span key={reference.id} className="creation-user-message-reference">{reference.previewUrl && (reference.kind === "image" || reference.kind === "video") ? <img src={reference.previewUrl} alt="" /> : <Icon />}<span>{reference.label}</span></span>;
    })}</div>;
}

function MediaResult({ item, onRetryFailure, onCreateVariant }: { item: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const resultUrls = item.resultUrls;
    const openPreview = (url: string, type: "image" | "video") => { setPreviewType(type); setPreviewUrl(url); };
    if (item.status === "pending") return <div className="creation-media-pending"><Spin size="small" />正在生成{item.mode === "video" ? "视频" : "图片"}…</div>;
    if ((item.status === "error" || item.status === "cancelled") && !resultUrls?.length) return null;
    if (!resultUrls?.length) return <div className="creation-media-empty">没有返回可预览结果 <button type="button" onClick={onRetryFailure}>重试</button></div>;
    return <div className="creation-media-result">{item.mode === "video" ? <button type="button" className="creation-video-result" onClick={() => openPreview(resultUrls[0], "video")} aria-label="预览生成视频"><video muted preload="metadata" className="size-full object-cover" src={resultUrls[0]} /><span><Maximize2 />预览视频</span></button> : <div className="creation-image-result-grid">{resultUrls.map((url) => <button key={url} type="button" className="creation-image-result" onClick={() => openPreview(url, "image")} aria-label="预览生成图片"><img src={url} alt="生成结果" /><span><Maximize2 /></span></button>)}</div>}<div className="creation-media-actions"><span>{item.mode === "video" ? "视频结果" : `${resultUrls.length} 张图片`}</span><button type="button" onClick={onCreateVariant}><RefreshCw />生成变体</button><Link to="/canvas">添加到画布</Link>{resultUrls.map((url, index) => <a key={`${url}-download`} href={url} download>{resultUrls.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}</div><CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} /></div>;
}

function CreationMediaPreviewModal({ url, type, onClose }: { url: string; type: "image" | "video"; onClose: () => void }) {
    return <Modal open={Boolean(url)} title={null} footer={null} centered destroyOnHidden width={type === "video" ? "min(1160px, calc(100vw - 32px))" : "min(980px, calc(100vw - 32px))"} onCancel={onClose} className="creation-media-preview-modal" styles={{ body: { padding: 0 } }}>{url ? type === "video" ? <video controls autoPlay className="creation-media-preview-video" src={url} /> : <img className="creation-media-preview-image" src={url} alt="媒体预览" /> : null}</Modal>;
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    attachments: CreationAttachment[];
    references: CreationReference[];
    onRemoveAttachment: (id: string) => void;
    fileInputRef: RefObject<HTMLInputElement | null>;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onModeChange: (mode: CreationMode) => void;
    model: string;
    config: ReturnType<typeof useEffectiveConfig>;
    onModelChange: (value: string) => void;
    ratio: string;
    setRatio: (value: string) => void;
    seconds: string;
    setSeconds: (value: string) => void;
    quality: string;
    setQuality: (value: string) => void;
    videoQuality: string;
    setVideoQuality: (value: string) => void;
    count: string;
    setCount: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
};

function CreationComposer(props: ComposerProps) {
    const canSubmit = Boolean(props.prompt.trim()) && !props.busy;
    const placeholder = props.mode === "text"
        ? "描述你的故事、角色或想继续讨论的创意"
        : props.mode === "image"
            ? "描述画面、人物、场景、构图与风格"
            : "描述镜头内容、运动、光线与节奏";
    const emptyPlaceholder = "输入你的镜头、画面或故事。也可以添加参考图开始创作";
    return <section className={`creation-chat-composer is-${props.variant}`}>
        <div className="creation-chat-writing-surface">
            <input ref={props.fileInputRef} type="file" hidden accept="image/*" multiple onChange={props.onFileChange} />
            <Tooltip title="添加参考图片"><button type="button" className="creation-chat-reference is-paper" onClick={() => props.fileInputRef.current?.click()} disabled={props.busy} aria-label="添加参考图片"><Plus /><span>参考内容</span></button></Tooltip>
            <div className="creation-chat-editor">
                <CanvasResourceMentionTextarea value={props.prompt} references={props.references} mentionMenuWidth={400} sendOnEnter={false} onChange={props.setPrompt} onSubmit={props.onSubmit} containerClassName="creation-chat-mention-container" className="creation-chat-mention-editor creation-scrollbar" style={{ color: "var(--creation-text)" }} placeholder={props.variant === "empty" ? emptyPlaceholder : placeholder} aria-label="创作提示词，可使用 @ 引用当前参考内容或技能" spellCheck disabled={props.busy} />
                {props.attachments.length ? <div className="creation-chat-attachment-strip">{props.attachments.map((item) => <div key={item.id} className="creation-chat-attachment"><img src={item.previewUrl} alt={item.name} /><button type="button" onClick={() => props.onRemoveAttachment(item.id)} aria-label={`移除 ${item.name}`}><X /></button></div>)}</div> : null}
            </div>
        </div>
        <footer className="creation-chat-dock">
            <div className="creation-chat-controls">
                <ModePicker mode={props.mode} onModeChange={props.onModeChange} />
                <ModelPicker config={props.config} value={props.model} onChange={props.onModelChange} capability={props.mode} className="creation-model-picker" placeholder={`选择${modeLabels[props.mode]}模型`} showSelectedPrice={false} variant="creation" />
                {props.mode !== "text" ? <GenerationSettingsMenu {...props} /> : null}
                {props.mode === "video" ? <DurationMenu model={props.model} seconds={props.seconds} onChange={props.setSeconds} /> : null}
            </div>
            {props.busy ? <button type="button" className="creation-chat-submit is-stopping" onClick={props.onStop} aria-label="停止生成"><Square className="size-3.5 fill-current" /></button> : <button type="button" className="creation-chat-submit" disabled={!canSubmit} onClick={props.onSubmit} aria-label="发送"><ArrowUp className="size-4" /></button>}
        </footer>
    </section>;
}

function ModePicker({ mode, onModeChange }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void }) {
    const [open, setOpen] = useState(false);
    const items: { mode: CreationMode; icon: ReactNode; label: string }[] = [
        { mode: "video", icon: <Film />, label: "视频生成" },
        { mode: "image", icon: <ImageIcon />, label: "图片生成" },
        { mode: "text", icon: <MessageSquareText />, label: "文本创作" },
    ];
    const current = items.find((item) => item.mode === mode) || items[0];
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomLeft" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={<div className="creation-mode-picker-menu" role="listbox" aria-label="选择生成类型">{items.map((item) => <button key={item.mode} type="button" role="option" aria-selected={item.mode === mode} className={item.mode === mode ? "is-selected" : ""} onClick={() => { onModeChange(item.mode); setOpen(false); }}><span className="creation-menu-icon">{item.icon}</span><span>{item.label}</span>{item.mode === mode ? <Check /> : null}</button>)}</div>}>
        <button type="button" className="creation-chat-control is-mode" aria-label={`生成类型：${current.label}`}>{current.icon}<span>{current.label}</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function GenerationSettingsMenu(props: ComposerProps) {
    const [open, setOpen] = useState(false);
    const [customRatioOpen, setCustomRatioOpen] = useState(!ratioOptions.some((option) => option.value === props.ratio));
    const qualityLabel = qualityOptions.find((item) => item.value === props.quality)?.label || "自动";
    const summary = props.mode === "video" ? `${props.ratio} · ${videoResolutionLabel(props.videoQuality)}` : `${props.ratio} · ${qualityLabel} · ${props.count}`;
    const panel = <div className="creation-parameter-menu">
        <SettingSection title="画幅" value={props.ratio}><div className="creation-parameter-content"><div className="creation-choice-grid is-ratio">{ratioOptions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.ratio} className={option.value === props.ratio ? "is-selected" : ""} onClick={() => { props.setRatio(option.value); setCustomRatioOpen(false); }}><span className="creation-ratio-preview"><span style={ratioPreviewStyle(option.value)} /></span><span>{option.value}</span></button>)}</div>{customRatioOpen ? <label className="creation-custom-value"><span>宽 : 高</span><input value={props.ratio} onFocus={(event) => event.currentTarget.select()} onChange={(event) => props.setRatio(event.target.value)} placeholder="1920x1080 或 2:1" aria-label="自定义画幅，支持宽x高或比例" /></label> : <button type="button" className="creation-custom-trigger" onClick={() => setCustomRatioOpen(true)}><Plus />输入自定义比例</button>}</div></SettingSection>
        {props.mode === "video" ? <SettingSection title="清晰度" value={videoResolutionLabel(props.videoQuality)}><div className="creation-choice-grid is-resolution">{resolutionOptions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>{option.label}</button>)}</div></SettingSection> : <>
            <SettingSection title="图片质量" value={qualityLabel}><div className="creation-choice-grid is-quality">{qualityOptions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.quality} className={option.value === props.quality ? "is-selected" : ""} onClick={() => props.setQuality(option.value)}><span>{option.label}</span><small>{option.description}</small></button>)}</div></SettingSection>
            <SettingSection title="生成数量" value={`${props.count} 张`}><div className="creation-parameter-content"><div className="creation-choice-grid is-count">{countOptions.map((option) => <button key={option} type="button" aria-pressed={option === props.count} className={option === props.count ? "is-selected" : ""} onClick={() => props.setCount(option)}>{option}</button>)}</div><label className="creation-custom-value"><span>自定义</span><input inputMode="numeric" pattern="[0-9]*" value={props.count} onChange={(event) => props.setCount(event.target.value)} aria-label="生成数量，范围 1 到 15" /><em>张</em></label></div></SettingSection>
        </>}
    </div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={panel}>
        <button type="button" className="creation-chat-control" aria-label={`生成设置：${summary}`}><SlidersHorizontal /><span>{summary}</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function SettingSection({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
    return <section className="creation-parameter-section"><header><h3>{title}</h3>{value ? <span>{value}</span> : null}</header>{children}</section>;
}

function DurationMenu({ model, seconds, onChange }: { model: string; seconds: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const value = Math.max(1, Math.floor(Number(seconds) || 6));
    const presets = durationPresets(model);
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={<div className="creation-duration-menu"><div className="creation-duration-heading"><span>时长</span><strong>{value} 秒</strong></div><div className="creation-duration-choices">{presets.map((item) => <button key={item} type="button" className={item === value ? "is-selected" : ""} onClick={() => onChange(String(item))}>{item}s</button>)}</div><label className="creation-custom-value is-duration"><span>自定义时长</span><span className="creation-duration-custom-field"><input type="number" min="1" step="1" inputMode="numeric" value={seconds} onFocus={(event) => event.currentTarget.select()} onBlur={() => onChange(String(value))} onChange={(event) => onChange(event.target.value)} aria-label="自定义视频时长，单位秒" /><em>秒</em></span></label></div>}>
        <button type="button" className="creation-chat-control is-duration" aria-label={`视频时长：${value}秒`}><Clock3 /><span>{value}s</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function CreationIntro({ mode }: { mode: CreationMode }) {
    const copy = mode === "video" ? ["让", "想象", "，先在镜头里发生", "影策 · AI 叙事创作"] : mode === "image" ? ["让", "画面", "，从一个想法开始", "影策 · 视觉创作"] : ["把", "故事", "，写在第一句话里", "影策 · 叙事创作"];
    return <header className="creation-chat-intro" aria-live="polite"><span className="creation-intro-signal" aria-hidden="true" /><h1>{copy[0]}<span>{copy[1]}</span>{copy[2]}</h1><p>{copy[3]}</p></header>;
}

function durationPresets(model: string) {
    const name = modelOptionName(model).toLowerCase();
    if (name.includes("veo")) return [4, 6, 8];
    if (name.includes("seedance")) return [4, 5, 8, 10, 15];
    return [5, 10, 15, 20, 30];
}

function videoResolutionLabel(value: string | number) {
    return Number(String(value).replace(/p$/i, "")) === 2160 ? "4K" : `${String(value).replace(/p$/i, "")}P`;
}

function conversationPreviewMessage(conversation: CreationConversation) {
    let fallback: CreationMessage | undefined;
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        const message = conversation.messages[index];
        if (!message.content.trim()) continue;
        fallback ||= message;
        if (message.role === "user") return message;
    }
    return fallback;
}

function buildTextMessageContent(item: CreationMessage) {
    const content = expandCreationPrompt(item.content, item.references || [], item.attachments || []);
    const images = item.attachments || [];
    if (!images.length) return content;
    return [{ type: "text" as const, text: content }, ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl || image.url || "" } }))];
}

function removeReferenceTokens(value: string, references: CreationReference[]) {
    return references.reduce((current, reference) => current.split(canvasResourceMentionToken(reference)).join(""), value);
}

function pendingCreationMediaKey(conversations: CreationConversation[]) {
    return conversations.flatMap((conversation) => conversation.messages.flatMap((message) => message.role === "assistant" && message.status === "pending" && message.mode !== "text" ? [`${conversation.id}:${message.id}:${(message.taskIds || []).join(",")}`] : [])).join("|");
}

async function enrichCreationTaskSummaries(tasks: GenerationTask[]) {
    return Promise.all(tasks.map(async (task) => {
        if (!task.clientContext || (task.status !== "failed" && (task.status !== "succeeded" || task.previewUrl))) return task;
        const detail = await queryGenerationTask(task.id).catch(() => null);
        return detail ? { ...task, ...detail, clientContext: task.clientContext } : task;
    }));
}

function reconcileCreationTaskMessages(conversations: CreationConversation[], tasks: GenerationTask[]) {
    let changed = false;
    const next = conversations.map((conversation) => {
        let conversationChanged = false;
        let completedAt = conversation.updatedAt;
        const messages = conversation.messages.map((message) => {
            if (message.role !== "assistant" || message.status !== "pending" || message.mode === "text") return message;
            const taskIds = new Set(message.taskIds || []);
            const matches = tasks
                .filter((task) => taskIds.has(task.id) || (task.clientContext?.conversationId === conversation.id && task.clientContext.messageId === message.id))
                .sort((left, right) => (left.clientContext?.batchIndex || 0) - (right.clientContext?.batchIndex || 0));
            const expectedTaskCount = Math.max(0, ...matches.map((task) => task.clientContext?.batchCount || 0));
            if (!matches.length || (expectedTaskCount > 0 && matches.length < expectedTaskCount) || matches.some((task) => task.status === "queued" || task.status === "running")) return message;

            const resultUrls = Array.from(new Set(matches.filter((task) => task.status === "succeeded").flatMap(creationTaskResultUrls)));
            const succeededCount = matches.filter((task) => task.status === "succeeded").length;
            const failedCount = matches.length - succeededCount;
            const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
            completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
            conversationChanged = true;
            changed = true;

            if (resultUrls.length) {
                const content = message.mode === "video" ? "视频已生成" : failedCount ? `${resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成";
                return { ...message, status: "done" as const, content, resultUrls, error: undefined, taskIds: nextTaskIds };
            }
            if (matches.every((task) => task.status === "cancelled")) return { ...message, status: "cancelled" as const, content: "已停止", error: undefined, taskIds: nextTaskIds };
            const failed = matches.find((task) => task.status === "failed");
            return { ...message, status: "error" as const, content: "生成失败", error: generationErrorMessage(failed?.error || "任务已结束，但生成结果暂时无法读取"), taskIds: nextTaskIds };
        });
        return conversationChanged ? { ...conversation, messages, updatedAt: completedAt } : conversation;
    });
    return changed ? next : conversations;
}

function creationTaskResultUrls(task: GenerationTask) {
    if (task.previewUrl) return [task.previewUrl];
    if (!task.resultJson) return [];
    try {
        const result = parseBackendGenerationResult(task);
        return [...(result.images || []).map((image) => image.dataUrl), result.video?.dataUrl].filter((url): url is string => Boolean(url));
    } catch {
        return [];
    }
}

function conversationTimestamp(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatConversationTime(value: string) {
    const timestamp = conversationTimestamp(value);
    if (!timestamp) return "时间未知";
    return conversationTimeFormatter.format(timestamp);
}

function ratioPreviewStyle(value: string) {
    const [width, height] = value.replace("x", ":").split(":").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 14, height: 14 };
    const scale = Math.min(28 / width, 20 / height);
    return { width: Math.max(8, width * scale), height: Math.max(8, height * scale) };
}

function readFileAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error || new Error("文件读取失败")); reader.readAsDataURL(file); }); }
