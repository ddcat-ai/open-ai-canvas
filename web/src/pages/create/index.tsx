import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, type RefObject } from "react";
import localforage from "localforage";
import { App, Drawer, Modal, Popover, Spin, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Check, ChevronDown, Clapperboard, Clock3, Download, FileText, Film, FolderOpen, History, Image as ImageIcon, LoaderCircle, Maximize2, MessageSquareText, Music2, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Square, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { ModelPicker } from "@/components/model-picker";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { createClientId } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import { VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { parseBackendGenerationResult, runBackendGenerationTask, runBackendGenerationTaskBatch, type BackendGenerationResult } from "@/services/api/generation-task";
import { requestImageQuestion } from "@/services/api/image";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { storeGeneratedVideo } from "@/services/api/video";
import { uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { modelDisplayName, modelOptionName, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useAssetStore, type Asset, type NewAsset } from "@/stores/use-asset-store";
import { buildCreationMentionReferences, creationReferenceMetadata, displayCreationPrompt, expandCreationPrompt, selectedCreationReferences, type CreationReference } from "./creation-references";
import { creationAssetKey, creationAttachmentFromAsset, creationAttachmentFromImage, creationAttachmentFromVideo, creationAttachmentFromVideoAsset, creationImageAsset, creationVideoAsset, isSameCreationAsset, type CreationAssetIdentity, type CreationAttachment } from "./creation-assets";

type CreationMode = "text" | "image" | "video";
type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
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
const shotScriptLabels: Record<CreationMode, string> = { text: "创作思路", image: "画面指令", video: "镜头脚本" };
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
    // grok2api / xAI Imagine：quality 映射 resolution
    { value: "1k", label: "1K", description: "标准清晰度" },
    { value: "2k", label: "2K", description: "更高清晰度" },
];
const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
const countOptions = ["1", "2", "3", "4"];
const conversationTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

function newMessage(role: CreationMessage["role"], content: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id: createClientId(), role, content, createdAt: new Date().toISOString(), ...extra };
}

type CreationShot = { user?: CreationMessage; result?: CreationMessage };

type CreationImageResult = NonNullable<BackendGenerationResult["images"]>[number];

function shotsFromMessages(messages: CreationMessage[]): CreationShot[] {
    const shots: CreationShot[] = [];
    for (const message of messages) {
        if (message.role === "user") {
            shots.push({ user: message });
        } else if (shots.length) {
            shots[shots.length - 1].result = message;
        } else {
            shots.push({ result: message });
        }
    }
    return shots;
}

async function persistCreationImageResult(image: CreationImageResult): Promise<UploadedImage> {
    if (!image.storageKey) return uploadImage(image.dataUrl);
    const url = await resolveImageUrl(image.storageKey, image.dataUrl);
    if (!url) throw new Error("图片结果资源不可用");
    return {
        url,
        storageKey: image.storageKey,
        width: image.width || 1024,
        height: image.height || 1024,
        bytes: image.bytes || 0,
        mimeType: image.mimeType || "image/png",
    };
}

function addCreationAssetOnce(asset: NewAsset, identity: CreationAssetIdentity) {
    const store = useAssetStore.getState();
    const key = creationAssetKey(identity);
    if (key && store.assets.some((existing) => isSameCreationAsset(existing, identity))) return false;
    store.addAsset(key ? { ...asset, metadata: { ...asset.metadata, creationAssetKey: key } } : asset);
    return true;
}

export default function CreatePage() {
    const { message: toast } = App.useApp();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
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
    const [selectedShotIndex, setSelectedShotIndex] = useState(-1);
    const [composingNextShot, setComposingNextShot] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const taskSyncInFlightRef = useRef(false);

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [activeId, conversations]);
    const historyConversations = useMemo(
        () => conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt)),
        [activeId, conversations],
    );
    const preferredModel = mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(() => ({
        capability: mode,
        input: {
            textCount: hasPrompt ? 1 : 0,
            imageCount: attachments.filter(isImageAttachment).length,
            videoCount: attachments.filter(isVideoAttachment).length,
            audioCount: 0,
            characterCount: 0,
        },
        videoSeconds: seconds,
    }), [attachments, hasPrompt, mode, seconds]);
    const selectedModel = resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    const mentionReferences = useMemo(() => buildCreationMentionReferences(addedSkills, attachments, draftReferences), [addedSkills, attachments, draftReferences]);
    const isEmpty = !activeConversation?.messages.length;
    const pendingMediaKey = useMemo(() => pendingCreationMediaKey(conversations), [conversations]);
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(conversations), [conversations]);
    const shots = useMemo(() => shotsFromMessages(activeConversation?.messages || []), [activeConversation]);
    const visibleShotIndex = shots.length ? selectedShotIndex >= 0 && selectedShotIndex < shots.length ? selectedShotIndex : shots.length - 1 : -1;

    useEffect(() => {
        if (mode !== "image") return;
        const normalized = normalizeImageValue(imageProfile, { size: ratio, quality, count });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setCount(normalized.count);
        if (attachments.length > imageProfile.references.maxImages) setAttachments((current) => current.slice(0, imageProfile.references.maxImages));
    }, [mode, selectedModel, imageProfile]);

    useEffect(() => {
        if (mode !== "video") return;
        const normalized = normalizeVideoValue(videoProfile, { seconds, ratio, resolution: `${videoQuality}p` });
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
    }, [mode, selectedModel, videoProfile]);

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
        if (!hydrated || !pendingMediaKey || !pendingTaskIds.length) return;
        let cancelled = false;
        const syncTasks = async () => {
            if (taskSyncInFlightRef.current) return;
            taskSyncInFlightRef.current = true;
            try {
                const summaries = await listGenerationTasks(100);
                const tasks = await enrichCreationTaskSummaries(summaries);
                const pendingTaskIdSet = new Set(pendingTaskIds);
                const persistedTasks = await persistCreationTaskResults(tasks.filter((task) => pendingTaskIdSet.has(task.id)));
                if (cancelled) return;
                taskSyncWarningRef.current = false;
                setConversations((current) => reconcileCreationTaskMessages(current, persistedTasks));
            } catch (error) {
                if (cancelled) return;
                console.warn("创作任务状态同步失败", error);
                if (!taskSyncWarningRef.current) {
                    taskSyncWarningRef.current = true;
                    toast.warning("任务状态暂时无法同步，请稍后刷新");
                }
            } finally {
                taskSyncInFlightRef.current = false;
            }
        };
        void syncTasks();
        const timer = window.setInterval(() => void syncTasks(), 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hydrated, pendingMediaKey, pendingTaskIds, toast]);

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

    const maxReferences = mode === "video" ? videoProfile.operations.includes("image_to_video") ? videoProfile.references.maxImages : 0 : mode === "image" ? imageProfile.references.maxImages : 6;
    const uploadCreationAsset = async (file: File) => {
        if (file.type.startsWith("video/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationVideoAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromVideo(file, uploaded),
            };
        }
        const uploaded = await uploadImage(file);
        return {
            asset: creationImageAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
            attachment: creationAttachmentFromImage(file, uploaded),
        };
    };
    const addAttachments = (files: FileList | File[]) => {
        if ((mode === "image" || mode === "video") && maxReferences === 0) {
            toast.warning(mode === "image" ? "当前图片模型不支持参考图" : "当前模型不支持图生视频");
            return;
        }
        const next = Array.from(files)
            .filter((file) => file.type.startsWith("image/") || (mode === "video" && file.type.startsWith("video/")))
            .slice(0, Math.max(0, maxReferences - attachments.length));
        if (!next.length) return;
        void Promise.allSettled(next.map(async (file) => {
            const { asset, attachment } = await uploadCreationAsset(file);
            addAsset(asset);
            return attachment;
        })).then((settled) => {
            const items = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
            const failed = settled.filter((entry) => entry.status === "rejected");
            if (items.length) setAttachments((current) => [...current, ...items].slice(0, maxReferences));
            if (failed.length) toast.error(`${failed.length} 个参考素材上传失败，请重试`);
        });
    };

    const uploadLibraryAssets = async (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => file.type.startsWith("image/") || (mode === "video" && file.type.startsWith("video/")));
        if (!next.length) return [];
        const settled = await Promise.allSettled(next.map(async (file) => {
            const { asset } = await uploadCreationAsset(file);
            return addAsset(asset);
        }));
        const assetIds = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(`${assetIds.length} 个素材已上传到素材库并自动选中`);
        if (failed.length) toast.error(`${failed.length} 个素材上传失败，请重试`);
        return assetIds;
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) addAttachments(event.target.files);
        event.target.value = "";
    };

    const handleLibrarySelect = (selected: Asset[]) => {
        const next = selected.flatMap((asset): CreationAttachment[] => {
            if (asset.kind === "image") return [creationAttachmentFromAsset(asset)];
            if (asset.kind === "video" && mode === "video") return [creationAttachmentFromVideoAsset(asset)];
            return [];
        });
        if (!next.length) return;
        setAttachments((current) => [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next].slice(0, maxReferences));
        setLibraryOpen(false);
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
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds))) {
            toast.error("当前模型不支持所选视频时长，请重新选择");
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const referenceImages = attachments.filter(isImageAttachment);
        const referenceVideos = attachments.filter(isVideoAttachment);
        const expandedPrompt = expandCreationPrompt(text, references, attachments);
        const referenceMetadata = creationReferenceMetadata(references);
        followLatestMessageRef.current = true;
        const userMessage = newMessage("user", text, { mode, model: selectedModel, attachments, references, settings });
        const assistantMessage = newMessage("assistant", "", { mode, model: selectedModel, status: mode === "text" ? "streaming" : "pending", settings });
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const bindTask = (task: GenerationTask) => {
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
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
        setSelectedShotIndex(-1);
        setComposingNextShot(false);
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
                const taskCount = Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runBackendGenerationTaskBatch({
                    mode: "image",
                    prompt: expandedPrompt,
                    config: { ...requestConfig, count: "1" },
                    referenceImages,
                    signal: controller.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    count: taskCount,
                });
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedImages = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return (entry.value.images || []).map((image, resultIndex) => ({
                        image,
                        taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                        resultIndex,
                    }));
                });
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const storedImages = await Promise.allSettled(generatedImages.map(async ({ image, taskId, resultIndex }) => {
                    const uploaded = await persistCreationImageResult(image);
                    addCreationAssetOnce(creationImageAsset({ title: expandedPrompt.slice(0, 24), uploaded, metadata: { source: "create-generation", conversationId: activeConversation.id, messageId: assistantMessage.id, taskId, taskIds: boundTaskIdList, resultIndex, prompt: expandedPrompt } }), { taskId, messageId: assistantMessage.id, resultIndex });
                    return uploaded.url;
                }));
                const resultUrls = storedImages.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    const reason = taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failedCount) toast.warning(`${resultUrls.length} 张图片已生成，${failedCount} 张生成失败`);
                updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "done", content: failedCount ? `${resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成", resultUrls }));
            } else {
                const result = await runBackendGenerationTask({
                    mode: "video",
                    prompt: expandedPrompt,
                    config: requestConfig,
                    referenceImages,
                    referenceVideos,
                    signal: controller.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: attachments.length ? "image_to_video" : "text_to_video", ...referenceMetadata },
                    onTaskUpdate: bindTask,
                });
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const storedVideo = await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
                if (!storedVideo.url) throw new Error("视频结果资源不可用");
                const taskId = Array.from(boundTaskIds)[0];
                addCreationAssetOnce(creationVideoAsset({ title: expandedPrompt.slice(0, 24), uploaded: storedVideo, metadata: { source: "create-generation", conversationId: activeConversation.id, messageId: assistantMessage.id, taskId, taskIds: Array.from(boundTaskIds), resultIndex: 0, prompt: expandedPrompt } }), { taskId, messageId: assistantMessage.id, resultIndex: 0 });
                updateAssistant(assistantMessage.id, (item) => ({ ...item, status: "done", content: "视频已生成", resultUrls: [storedVideo.url] }));
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
        setSelectedShotIndex(-1);
        setComposingNextShot(false);
        setHistoryOpen(false);
    };

    const selectConversation = (conversation: CreationConversation) => {
        followLatestMessageRef.current = true;
        setActiveId(conversation.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setSelectedShotIndex(-1);
        setComposingNextShot(false);
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
        setSelectedShotIndex(-1);
        setComposingNextShot(false);
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

    const nextShotNumber = shots.length + 1;

    const beginComposeNextShot = () => {
        setComposingNextShot(true);
        setSelectedShotIndex(-1);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    const cancelComposeNextShot = () => setComposingNextShot(false);

    const composerProps = {
        mode,
        prompt,
        setPrompt,
        busy,
        attachments,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        onOpenLibrary: () => setLibraryOpen(true),
        fileInputRef,
        onFileChange: handleFileChange,
        onModeChange: selectMode,
        model: selectedModel,
        modelRequirements,
        imageProfile,
        videoProfile,
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
        composerFocusRef,
        placeholderOverride: composingNextShot ? `SC.${String(nextShotNumber).padStart(2, "0")} · 写下这一镜的镜头、画面或故事` : undefined,
        onSubmit: submit,
        onStop: () => abortRef.current?.abort(),
    };

    const visibleShot = shots[visibleShotIndex];
    const visibleShotResultIndex = visibleShot?.result ? activeConversation.messages.indexOf(visibleShot.result) : -1;

    return <>
        <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
            {isEmpty ? <>
                <div className="creation-top-actions">
                    <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" aria-expanded={historyOpen} className="creation-top-action" onClick={() => setHistoryOpen(true)}><History /></button></Tooltip>
                </div>
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-empty-workspace creation-scrollbar">
                <CreationEmptyBanner />
                <div className="creation-chat-intro">
                    <span className="creation-intro-signal" aria-hidden="true" />
                    <p>影策 · AI 影视创作工作台</p>
                    <h1>把脑海里的画面，<span className="creation-intro-emphasis"><span className="is-pink">交给影策</span><span className="is-blue">拍出来</span></span></h1>
                </div>
                <div className="creation-empty-composer">
                    <CreationComposer {...composerProps} variant="empty" />
                </div>
                <CreationEmptySuggest
                    onStartPrompt={(nextMode, prompt) => { selectMode(nextMode); setPrompt(prompt); window.requestAnimationFrame(() => composerFocusRef.current?.focus()); }}
                    onOpenLibrary={() => { selectMode("image"); setLibraryOpen(true); }}
                />
            </main>
            </> : <div className="storyboard-workbench">
                <StoryboardToolbar
                    shots={shots}
                    activeIndex={visibleShotIndex}
                    composing={composingNextShot}
                    onSelect={(index) => { setSelectedShotIndex(index); setComposingNextShot(false); }}
                    onBeginCompose={beginComposeNextShot}
                    onCancelCompose={cancelComposeNextShot}
                    onNewConversation={startNewConversation}
                    onOpenHistory={() => setHistoryOpen(true)}
                />
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="storyboard-workbench-stage creation-scrollbar">
                    <div className="storyboard-workbench-stage-inner">
                        {composingNextShot ? <StoryboardNextShotCard shotNumber={nextShotNumber} onCancel={cancelComposeNextShot} /> : visibleShot ? <StoryboardShotCard
                            shot={visibleShot}
                            shotNumber={visibleShotIndex + 1}
                            modelName={visibleShot.result?.model ? modelDisplayName(config, visibleShot.result.model) : ""}
                            busy={busy}
                            onRetryFailure={() => { if (visibleShotResultIndex >= 0 && visibleShot.result) retryFailedMessage(visibleShot.result, visibleShotResultIndex); }}
                            onCreateVariant={() => { if (visibleShotResultIndex >= 0 && visibleShot.result) createVariant(visibleShot.result, visibleShotResultIndex); }}
                        /> : null}
                    </div>
                </main>
                <section className="storyboard-workbench-composer">
                    <CreationComposer {...composerProps} variant="thread" />
                </section>
            </div>}
        </div>
        <CreationHistoryDrawer open={historyOpen} conversations={historyConversations} activeId={activeConversation.id} onClose={() => setHistoryOpen(false)} onSelect={selectConversation} />
        <CreationAssetLibraryModal open={libraryOpen} assets={assets} mode={mode} selectedIds={new Set(attachments.filter((item) => item.id.startsWith("asset:")).map((item) => item.id.slice(6)))} onClose={() => setLibraryOpen(false)} onConfirm={handleLibrarySelect} onUpload={uploadLibraryAssets} />
    </>;
}

const creationAssetCategoryLabels: Record<string, string> = { all: "全部素材", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };

function CreationAssetLibraryModal({ open, assets, mode, selectedIds, onClose, onConfirm, onUpload }: { open: boolean; assets: Asset[]; mode: CreationMode; selectedIds: Set<string>; onClose: () => void; onConfirm: (assets: Asset[]) => void; onUpload: (files: FileList | File[]) => Promise<string[]> }) {
    const [category, setCategory] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const mediaAssets = useMemo(() => assets.filter((asset): asset is Extract<Asset, { kind: "image" | "video" }> => asset.kind === "image" || asset.kind === "video"), [assets]);
    const categories = useMemo(() => ["all", ...Array.from(new Set(mediaAssets.map((asset) => asset.category || "other")))], [mediaAssets]);
    const visibleAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return mediaAssets.filter((asset) => (category === "all" || (asset.category || "other") === category) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [category, keyword, mediaAssets]);

    useEffect(() => {
        if (!open) return;
        setCategory("all");
        setKeyword("");
        setSelected(new Set(selectedIds));
    }, [open]);

    const toggle = (asset: Asset) => {
        if (mode !== "video" && asset.kind === "video") return;
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
            return next;
        });
    };
    const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files || uploading) return;
        const fileCount = event.target.files.length;
        if (!fileCount) return;
        setUploadingCount(fileCount);
        setUploading(true);
        try {
            const assetIds = await onUpload(event.target.files);
            if (assetIds.length) setSelected((current) => new Set([...current, ...assetIds]));
        } finally {
            event.target.value = "";
            setUploading(false);
            setUploadingCount(0);
        }
    };
    const selectedAssets = mediaAssets.filter((asset) => selected.has(asset.id) && (mode === "video" || asset.kind === "image"));
    const count = category === "all" ? mediaAssets.length : mediaAssets.filter((asset) => (asset.category || "other") === category).length;

    return <Modal open={open} footer={null} title={null} destroyOnHidden closable={!uploading} maskClosable={!uploading} keyboard={!uploading} onCancel={() => { if (!uploading) onClose(); }} width="min(980px, calc(100vw - 24px))" className="creation-asset-library-modal" styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
        <div className="creation-library-shell">
            <div className="creation-library-toolbar"><div className="creation-library-toolbar-title"><span>参考内容</span><strong>素材库</strong></div><div className="creation-library-search"><Search /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材名称或标签" aria-label="搜索素材" /></div><span className="creation-library-toolbar-count">已选 {selectedAssets.length} · {count} 个素材</span></div>
            <div className="creation-library-body">
                <nav className="creation-library-categories" aria-label="素材分类">{categories.map((item) => <button key={item} type="button" className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}><span>{creationAssetCategoryLabels[item] || "其他"}</span><em>{item === "all" ? mediaAssets.length : mediaAssets.filter((asset) => (asset.category || "other") === item).length}</em></button>)}</nav>
                <div className="creation-library-grid-wrap"><div className="creation-library-grid">{visibleAssets.length ? visibleAssets.map((asset) => <CreationLibraryCard key={asset.id} asset={asset} selected={selected.has(asset.id)} disabled={mode !== "video" && asset.kind === "video"} onToggle={() => toggle(asset)} />) : <div className="creation-library-empty"><FolderOpen /><strong>这个分类还没有素材</strong><span>换个分类，或从底部上传一份新素材。</span></div>}</div></div>
            </div>
            <footer className="creation-library-footer"><input ref={uploadInputRef} type="file" hidden accept={mode === "video" ? "image/*,video/*" : "image/*"} multiple onChange={handleUpload} /><button type="button" className="creation-library-upload" onClick={() => uploadInputRef.current?.click()} disabled={uploading} aria-busy={uploading} aria-live="polite">{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}<span><strong>{uploading ? `正在上传 ${uploadingCount} 个素材` : "上传新素材"}</strong><small>{uploading ? "正在保存到素材库，完成后会自动选中" : `支持图片${mode === "video" ? "和视频" : ""}，上传后保存到素材库`}</small></span></button><div className="creation-library-actions"><button type="button" onClick={onClose} disabled={uploading}>取消</button><button type="button" className="is-primary" disabled={uploading || !selectedAssets.length} onClick={() => onConfirm(selectedAssets)}><Check />使用已选素材{selectedAssets.length ? `（${selectedAssets.length}）` : ""}</button></div></footer>
        </div>
    </Modal>;
}

function CreationLibraryCard({ asset, selected, disabled, onToggle }: { asset: Extract<Asset, { kind: "image" | "video" }>; selected: boolean; disabled: boolean; onToggle: () => void }) {
    const isVideo = asset.kind === "video";
    return <button type="button" className={`creation-library-card${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`} onClick={onToggle} disabled={disabled} aria-pressed={selected}>
        <div className="creation-library-card-media"><AssetMediaPreview asset={asset} alt={asset.title} fallback={<div className="creation-library-card-fallback">{isVideo ? <Film /> : <ImageIcon />}</div>} /><span className="creation-library-card-check"><Check /></span><span className="creation-library-card-kind">{isVideo ? "视频" : "图片"}</span>{disabled ? <span className="creation-library-card-lock">视频仅支持视频创作</span> : null}</div>
        <div className="creation-library-card-title">{asset.title || "未命名素材"}</div>
    </button>;
}

function CreationHistoryDrawer({ open, conversations, activeId, onClose, onSelect }: { open: boolean; conversations: CreationConversation[]; activeId: string; onClose: () => void; onSelect: (conversation: CreationConversation) => void }) {
    const [keyword, setKeyword] = useState("");

    useEffect(() => {
        if (open) setKeyword("");
    }, [open]);

    const visibleConversations = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return conversations;
        return conversations.filter((conversation) => {
            const latest = conversationPreviewMessage(conversation);
            const searchable = [
                conversation.title,
                ...conversation.messages.flatMap((message) => [message.content, displayCreationPrompt(message.content, message.references || [])]),
                latest?.mode ? modeLabels[latest.mode] : "创作",
                formatConversationTime(conversation.updatedAt),
            ].filter(Boolean).join(" ").toLowerCase();
            return searchable.includes(query);
        });
    }, [conversations, keyword]);

    return <Drawer open={open} onClose={onClose} placement="right" size="min(440px, 100vw)" closeIcon={<X className="size-4" />} className="creation-history-drawer" rootClassName="creation-history-drawer-root" styles={{ body: { padding: 0 } }} title={<div className="creation-history-title"><span>历史对话</span><small>{conversations.length} 个对话</small></div>}>
        <div className="creation-history-content">
            <label className="creation-history-search">
                <Search aria-hidden="true" />
                <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索对话标题或内容" aria-label="搜索历史对话" />
            </label>
            {visibleConversations.length ? <ul className="creation-history-list" aria-label="历史对话，按更新时间倒序排列">
                {visibleConversations.map((conversation) => {
                    const latest = conversationPreviewMessage(conversation);
                    const active = conversation.id === activeId;
                    return <li key={conversation.id} className={active ? "is-active" : undefined}>
                        <button type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation)}>
                            <span className="creation-history-time"><time dateTime={conversation.updatedAt}>{formatConversationTime(conversation.updatedAt)}</time><em>{latest?.mode ? modeLabels[latest.mode] : "创作"}</em></span>
                            <strong className="creation-history-item-heading">{conversation.title.trim() || "新创作"}</strong>
                            <span className="creation-history-snippet">{latest ? displayCreationPrompt(latest.content, latest.references || []).trim() || "还没有开始创作" : "还没有开始创作"}</span>
                        </button>
                    </li>;
                })}
            </ul> : <div className="creation-history-empty">{keyword.trim() ? "没有找到匹配的对话" : "暂无历史对话"}</div>}
        </div>
    </Drawer>;
}

function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return <div className="creation-user-message-references" aria-label="本次引用">{references.map((reference) => {
        const Icon = reference.kind === "skill" ? Sparkles : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
        return <span key={reference.id} className="creation-user-message-reference">{reference.previewUrl && (reference.kind === "image" || reference.kind === "video") ? <img src={reference.previewUrl} alt="" /> : <Icon />}<span>{reference.label}</span></span>;
    })}</div>;
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
    onOpenLibrary: () => void;
    fileInputRef: RefObject<HTMLInputElement | null>;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onModeChange: (mode: CreationMode) => void;
    model: string;
    modelRequirements: ModelRequirements;
    videoProfile: VideoCapabilityConfig;
    imageProfile: ImageCapabilityConfig;
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
    composerFocusRef: RefObject<HTMLTextAreaElement | null>;
    placeholderOverride?: string;
    onSubmit: () => void;
    onStop: () => void;
};

function CreationComposer(props: ComposerProps) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const canSubmit = Boolean(props.prompt.trim()) && !props.busy;
    const placeholder = props.mode === "text"
        ? "描述你的故事、角色或想继续讨论的创意"
        : props.mode === "image"
            ? "描述画面、人物、场景、构图与风格"
            : "描述镜头内容、运动、光线与节奏";
    const emptyPlaceholder = "输入你的镜头、画面或故事。也可以添加参考图开始创作";
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "image" ? imageReferencesSupported : props.mode !== "video" || props.videoProfile.operations.includes("image_to_video");
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || props.imageProfile.maxOutputs > 1;
    return <section className={`creation-chat-composer is-${props.variant}`}>
        <div className="creation-chat-writing-surface">
            <input ref={props.fileInputRef} type="file" hidden accept={props.mode === "video" ? "image/*,video/*" : "image/*"} multiple onChange={props.onFileChange} />
            <Tooltip title={!referencesSupported ? "当前模型不支持参考媒体" : "从素材库选择参考内容"}><button type="button" className="creation-chat-reference is-paper" onClick={props.onOpenLibrary} disabled={props.busy || !referencesSupported} aria-label="打开素材库选择参考内容"><Plus /><span>参考内容</span></button></Tooltip>
            <div className="creation-chat-editor">
                <CanvasResourceMentionTextarea ref={props.composerFocusRef} value={props.prompt} references={props.references} mentionMenuWidth={400} sendOnEnter={false} onChange={props.setPrompt} onSubmit={props.onSubmit} containerClassName="creation-chat-mention-container" className="creation-chat-mention-editor creation-scrollbar" style={{ color: "var(--creation-text)" }} placeholder={props.placeholderOverride || (props.variant === "empty" ? emptyPlaceholder : placeholder)} aria-label="创作提示词，可使用 @ 引用当前参考内容或技能" spellCheck disabled={props.busy} />
                {props.attachments.length ? <div className="creation-chat-attachment-strip">{props.attachments.map((item) => {
                    const isVideo = isVideoAttachment(item);
                    const url = isVideo ? item.url : item.previewUrl;
                    return <div key={item.id} className="creation-chat-attachment"><button type="button" className="creation-chat-attachment-preview" onClick={() => { setPreviewType(isVideo ? "video" : "image"); setPreviewUrl(url); }} aria-label={`放大预览 ${item.name}`} disabled={!url}>{isVideo ? <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} /> : <img src={item.previewUrl} alt={item.name} />}<span aria-hidden="true"><Maximize2 /></span></button><button type="button" className="creation-chat-attachment-remove" onClick={() => props.onRemoveAttachment(item.id)} aria-label={`移除 ${item.name}`}><X /></button></div>;
                })}</div> : null}
            </div>
        </div>
        <footer className="creation-chat-dock">
            <div className="creation-chat-controls">
                <VoiceRecordingButton
                    disabled={props.busy}
                    onTranscribed={(text) => props.setPrompt(props.prompt.trim() ? `${props.prompt} ${text}` : text)}
                />
                <ModePicker mode={props.mode} onModeChange={props.onModeChange} />
                <Tooltip title={!referencesSupported ? "当前模型不支持参考媒体" : "从素材库选择参考内容"}><button type="button" className="creation-chat-control" onClick={props.onOpenLibrary} disabled={props.busy || !referencesSupported} aria-label="打开素材库选择参考内容"><FolderOpen /><span>素材库</span></button></Tooltip>
                <ModelPicker config={props.config} value={props.model} onChange={props.onModelChange} capability={props.mode} requirements={props.modelRequirements} className="creation-model-picker" placeholder={`选择${modeLabels[props.mode]}模型`} showSelectedPrice={false} variant="creation" />
                {props.mode === "video" || (props.mode === "image" && imageSettingsSupported) ? <GenerationSettingsMenu {...props} /> : null}
                {props.mode === "video" ? <DurationMenu profile={props.videoProfile} seconds={props.seconds} onChange={props.setSeconds} /> : null}
            </div>
            {props.busy ? <button type="button" className="creation-chat-submit is-stopping" onClick={props.onStop} aria-label="停止生成"><Square className="size-3.5 fill-current" /></button> : <button type="button" className="creation-chat-submit" disabled={!canSubmit} onClick={props.onSubmit} aria-label="发送"><ArrowUp className="size-4" /></button>}
        </footer>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
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
    const activeQualityOptions = props.imageProfile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: value.toUpperCase(), description: "模型支持的质量/分辨率" });
    const qualityLabel = activeQualityOptions.find((item) => item.value === props.quality)?.label || qualityOptions.find((item) => item.value === props.quality)?.label || props.quality || "自动";
    const ratios = props.mode === "video" ? props.videoProfile.ratios : props.imageProfile.size.values.length ? props.imageProfile.size.values : ratioOptions.map((item) => item.value);
    const resolutions = props.mode === "video" ? props.videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: videoResolutionLabel(value) })) : resolutionOptions;
    const imageSummary = [
        ...(props.imageProfile.size.parameter !== "none" ? [props.ratio] : []),
        ...(props.imageProfile.quality.supported ? [qualityLabel] : []),
        ...(props.imageProfile.maxOutputs > 1 ? [props.count] : []),
    ].join(" · ");
    const summary = props.mode === "video" ? `${props.ratio} · ${videoResolutionLabel(props.videoQuality)}` : imageSummary;
    const panel = <div className="creation-parameter-menu">
        {props.mode === "video" || props.imageProfile.size.parameter !== "none" ? <SettingSection title="画幅" value={props.ratio}><div className="creation-parameter-content"><div className="creation-choice-grid is-ratio">{ratios.map((value) => <button key={value} type="button" aria-pressed={value === props.ratio} className={value === props.ratio ? "is-selected" : ""} onClick={() => { props.setRatio(value); setCustomRatioOpen(false); }}><span className="creation-ratio-preview"><span style={ratioPreviewStyle(value)} /></span><span>{value}</span></button>)}</div>{props.mode !== "video" && props.imageProfile.size.allowCustom && (customRatioOpen ? <label className="creation-custom-value"><span>宽 : 高</span><input value={props.ratio} onFocus={(event) => event.currentTarget.select()} onChange={(event) => props.setRatio(event.target.value)} placeholder="1920x1080 或 2:1" aria-label="自定义画幅，支持宽x高或比例" /></label> : <button type="button" className="creation-custom-trigger" onClick={() => setCustomRatioOpen(true)}><Plus />输入自定义比例</button>)}</div></SettingSection> : null}
        {props.mode === "video" ? <SettingSection title="清晰度" value={videoResolutionLabel(props.videoQuality)}><div className="creation-choice-grid is-resolution">{resolutions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>{option.label}</button>)}</div></SettingSection> : <>
            {props.imageProfile.quality.supported ? <SettingSection title={activeQualityOptions.some((item) => item.value === "1k" || item.value === "2k") ? "分辨率" : "图片质量"} value={qualityLabel}><div className="creation-choice-grid is-quality">{activeQualityOptions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.quality} className={option.value === props.quality ? "is-selected" : ""} onClick={() => props.setQuality(option.value)}><span>{option.label}</span><small>{option.description}</small></button>)}</div></SettingSection> : null}
            {props.imageProfile.maxOutputs > 1 ? <SettingSection title="生成数量" value={`${props.count} 张`}><div className="creation-parameter-content"><div className="creation-choice-grid is-count">{countOptions.filter((option) => Number(option) <= props.imageProfile.maxOutputs).map((option) => <button key={option} type="button" aria-pressed={option === props.count} className={option === props.count ? "is-selected" : ""} onClick={() => props.setCount(option)}>{option}</button>)}</div><label className="creation-custom-value"><span>自定义</span><input inputMode="numeric" pattern="[0-9]*" value={props.count} onChange={(event) => props.setCount(String(Math.max(1, Math.min(props.imageProfile.maxOutputs, Number(event.target.value) || 1))))} aria-label={`生成数量，范围 1 到 ${props.imageProfile.maxOutputs}`} /><em>张</em></label></div></SettingSection> : null}
        </>}
    </div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={panel}>
        <button type="button" className="creation-chat-control" aria-label={`生成设置：${summary}`}><SlidersHorizontal /><span>{summary}</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

function SettingSection({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
    return <section className="creation-parameter-section"><header><h3>{title}</h3>{value ? <span>{value}</span> : null}</header>{children}</section>;
}

function DurationMenu({ profile, seconds, onChange }: { profile: VideoCapabilityConfig; seconds: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const value = Number(normalizeVideoValue(profile, { seconds }).seconds);
    const presets = profile.duration.selection === "enum" ? videoDurationOptions(profile) : [];
    const fallbackPreset = presets.length ? presets : [profile.duration.default];
    const min = profile.duration.selection === "range" ? profile.duration.min || 1 : Math.min(...fallbackPreset);
    const max = profile.duration.selection === "range" ? Math.max(min, profile.duration.max || min) : Math.max(...fallbackPreset);
    const step = Math.max(1, profile.duration.step || 1);
    const durationControl = profile.duration.selection === "range" ? <>
        <input className="h-8 w-full" style={{ accentColor: "var(--creation-text)" }} type="range" min={min} max={max} step={step} value={value} aria-label="视频时长（秒）" onChange={(event) => onChange(event.target.value)} />
        <div className="flex justify-between px-0.5 text-[var(--fs-tiny)] text-[var(--creation-muted)]"><span>{min}s</span><span>{max}s</span></div>
        <label className="creation-custom-value is-duration"><span>自定义时长</span><span className="creation-duration-custom-field"><input type="number" min={min} max={max} step={step} inputMode="numeric" value={seconds} onFocus={(event) => event.currentTarget.select()} onBlur={() => onChange(String(value))} onChange={(event) => onChange(event.target.value)} aria-label="自定义视频时长，单位秒" /><em>秒</em></span></label>
    </> : <div className="creation-duration-choices">{presets.map((item) => <button key={item} type="button" className={item === value ? "is-selected" : ""} onClick={() => onChange(String(item))}>{item}s</button>)}</div>;
    return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom" arrow={false} classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }} content={<div className="creation-duration-menu"><div className="creation-duration-heading"><span>时长</span><strong>{value} 秒</strong></div>{durationControl}</div>}>
        <button type="button" className="creation-chat-control is-duration" aria-label={`视频时长：${value}秒`}><Clock3 /><span>{value}s</span><ChevronDown className={open ? "is-open" : ""} /></button>
    </Popover>;
}

const creationEmptyBannerFrames = [
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "SC.01 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "SC.02 · 暗巷追逐" },
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "SC.03 · 天台重逢" },
];

function CreationEmptyBanner() {
    return <div className="creation-empty-art" aria-hidden="true">
        {creationEmptyBannerFrames.map((frame, index) => <figure key={frame.caption} className={`creation-empty-art-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
            <img src={frame.src} alt="" />
            <span>{frame.caption}</span>
        </figure>)}
        <span className="creation-empty-art-caption"><span>影策</span>把每一帧，交给镜头导演</span>
    </div>;
}

const creationEmptySuggestions: Array<{ mode: CreationMode; icon: typeof Clapperboard; title: string; hint: string; prompt: string; openLibrary?: boolean }> = [
    { mode: "video", icon: Clapperboard, title: "生成第一个镜头", hint: "描述画面、镜头运动与光线", prompt: "雨夜天台，镜头缓缓推近霓虹灯牌下的主角，她回眸看向镜头，强对比电影感布光" },
    { mode: "image", icon: ImageIcon, title: "从参考图开始", hint: "上传风格图，生成同风格画面", prompt: "", openLibrary: true },
    { mode: "text", icon: FileText, title: "续写故事", hint: "和 AI 讨论剧情、角色与对白", prompt: "帮我续写一个短剧故事，先聊聊剧情走向：" },
    { mode: "video", icon: Sparkles, title: "引用技能增强", hint: "@技能 调用分镜、配音等专业能力", prompt: "调用分镜技能，帮我规划这个镜头的拍摄方案：" },
];

function CreationEmptySuggest({ onStartPrompt, onOpenLibrary }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; onOpenLibrary: () => void }) {
    return <div className="creation-empty-suggest">
        {creationEmptySuggestions.map((item) => {
            const Icon = item.icon;
            return <button key={item.title} type="button" className="suggest-card" onClick={() => { if (item.openLibrary) onOpenLibrary(); else onStartPrompt(item.mode, item.prompt); }}>
                <span className={`suggest-icon is-${item.mode}`}><Icon size={15} strokeWidth={2} /></span>
                <span className="suggest-copy"><strong>{item.title}</strong><span>{item.hint}</span></span>
            </button>;
        })}
    </div>;
}

type CreationThinking = { title: string; hint: string; steps: string[] };

function thinkingFor(mode: CreationMode): CreationThinking {
    if (mode === "image") return { title: "正在为你画这一镜", hint: "影策正在理解你的构图意图，并把画面交给模型出图。", steps: ["理解构图", "定调画风", "生成画面"] };
    if (mode === "text") return { title: "正在为你写这段", hint: "影策正在梳理你的创作脉络，组织语言与结构。", steps: ["梳理脉络", "组织语言", "输出段落"] };
    return { title: "正在为你拍这一镜", hint: "影策正在拆解你的镜头脚本，设计运镜与光线，并交给模型渲染成片。", steps: ["拆解镜头", "设计运镜", "定调布光", "渲染成片"] };
}

function directorNoteFor(mode: CreationMode, settings: CreationSettings): string {
    if (mode === "video") return `已按 ${settings.seconds}s · ${videoResolutionLabel(settings.videoQuality)} · ${settings.ratio} 渲染这一镜，等待你的下一句指令。`;
    if (mode === "image") return `已按 ${settings.ratio} 出图 ${settings.count} 张，等待你的下一句指令。`;
    return "";
}

function StoryboardToolbar({ shots, activeIndex, composing, onSelect, onBeginCompose, onCancelCompose, onNewConversation, onOpenHistory }: { shots: CreationShot[]; activeIndex: number; composing: boolean; onSelect: (index: number) => void; onBeginCompose: () => void; onCancelCompose: () => void; onNewConversation: () => void; onOpenHistory: () => void }) {
    const [railOpen, setRailOpen] = useState(false);
    const nextShotNumber = shots.length + 1;
    const closeRail = () => setRailOpen(false);
    const statusOf = (shot: CreationShot) => shot.result?.status || "queued";
    const shotTitle = (shot: CreationShot) => shot.user ? displayCreationPrompt(shot.user.content, shot.user.references || []).trim() || "未命名镜头" : "镜头";
    return <header className="storyboard-workbench-bar" aria-label="镜头工具条">
        <div className="storyboard-workbench-rail">
            <Tooltip title="镜头时间线"><button type="button" className={`storyboard-workbench-rail-button${railOpen ? " is-open" : ""}${composing ? " is-draft" : ""}`} aria-expanded={railOpen} aria-label="镜头时间线" onClick={() => setRailOpen((value) => !value)}><Film /><span className="storyboard-workbench-rail-badge">{composing ? nextShotNumber : shots.length}</span></button></Tooltip>
            {railOpen ? <div className="storyboard-workbench-rail-pop" role="listbox" aria-label="镜头列表">
                <div className="storyboard-workbench-rail-pop-head"><span className="storyboard-workbench-rail-pop-title"><Clapperboard />镜头时间线<small>{composing ? `下一镜 SC.${String(nextShotNumber).padStart(2, "0")}` : `${shots.length} 个镜头`}</small></span><button type="button" className="storyboard-workbench-rail-pop-close" aria-label="关闭镜头列表" onClick={closeRail}><X /></button></div>
                <ul className="creation-scrollbar">
                    {shots.map((shot, index) => {
                        const status = statusOf(shot);
                        const title = shotTitle(shot);
                        const thumbUrl = shot.result?.resultUrls?.[0];
                        const thumbIsVideo = shot.result?.mode === "video";
                        return <li key={shot.user?.id || shot.result?.id || index}>
                            <button type="button" className={`storyboard-workbench-rail-row${index === activeIndex && !composing ? " is-active" : ""}`} onClick={() => { onSelect(index); closeRail(); }}>
                                <span className="storyboard-workbench-rail-thumb">{thumbUrl ? (thumbIsVideo ? <video muted preload="metadata" src={thumbUrl} /> : <img src={thumbUrl} alt="" />) : <span className="storyboard-workbench-rail-thumb-ph"><Clapperboard /><em>SC.{String(index + 1).padStart(2, "0")}</em></span>}</span>
                                <span className="storyboard-workbench-rail-info">
                                    <span className="storyboard-workbench-rail-head"><span className="storyboard-workbench-rail-row-shot">SC.{String(index + 1).padStart(2, "0")}</span><span className={`storyboard-workbench-rail-row-state is-${status}`}>{status === "pending" ? "生成中" : status === "error" ? "失败" : status === "done" ? "完成" : "待生成"}</span>{shot.result?.createdAt ? <time dateTime={shot.result.createdAt}>{formatMessageTime(shot.result.createdAt)}</time> : null}</span>
                                    <span className="storyboard-workbench-rail-row-title">{title}</span>
                                </span>
                            </button>
                        </li>;
                    })}
                    {composing ? <li><button type="button" className="storyboard-workbench-rail-row is-draft" onClick={() => { onCancelCompose(); closeRail(); }}><span className="storyboard-workbench-rail-thumb"><span className="storyboard-workbench-rail-thumb-ph"><Clapperboard /><em>SC.{String(nextShotNumber).padStart(2, "0")}</em></span></span><span className="storyboard-workbench-rail-info"><span className="storyboard-workbench-rail-head"><span className="storyboard-workbench-rail-row-shot">SC.{String(nextShotNumber).padStart(2, "0")}</span><span className="storyboard-workbench-rail-row-state">待撰写</span></span><span className="storyboard-workbench-rail-row-title">等待你的脚本</span></span></button></li> : null}
                </ul>
                <button type="button" className="storyboard-workbench-rail-pop-add" onClick={() => { closeRail(); onBeginCompose(); }}><Plus />新增镜头</button>
            </div> : null}
        </div>
        <div className="storyboard-workbench-bar-actions">
            <Tooltip title={composing ? "收起下一镜" : "新增镜头"}><button type="button" aria-label={composing ? "收起下一镜" : "新增镜头"} className="storyboard-workbench-bar-action" onClick={composing ? onCancelCompose : onBeginCompose}>{composing ? <X /> : <Clapperboard />}</button></Tooltip>
            <Tooltip title="新建创作"><button type="button" aria-label="新建创作" className="storyboard-workbench-bar-action" onClick={onNewConversation}><Plus /></button></Tooltip>
            <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" className="storyboard-workbench-bar-action" onClick={onOpenHistory}><History /></button></Tooltip>
        </div>
    </header>;
}

function StoryboardShotCard({ shot, shotNumber, modelName, busy, onRetryFailure, onCreateVariant }: { shot: CreationShot; shotNumber: number; modelName: string; busy: boolean; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const user = shot.user;
    const result = shot.result;
    const status = result?.status || "queued";
    const mode = result?.mode || user?.mode || "video";
    const briefVisible = Boolean(user?.content.trim() || user?.references?.length || user?.attachments?.length);
    return <article className={`storyboard-workbench-card is-${status}`}>
        <header className="storyboard-workbench-card-head">
            <div className="storyboard-workbench-card-heading">
                <span className="storyboard-workbench-card-shot"><span className="storyboard-workbench-card-shot-index">SC.{String(shotNumber).padStart(2, "0")}</span>镜头 {shotNumber}</span>
                <span className="storyboard-workbench-card-mode">{mode === "video" ? <Film /> : mode === "image" ? <ImageIcon /> : <MessageSquareText />}{modeLabels[mode]}</span>
                {modelName ? <span className="storyboard-workbench-card-model">{modelName}</span> : null}
                {status === "pending" ? <span className="storyboard-workbench-card-state is-pending"><LoaderCircle className="animate-spin" />生成中</span> : status === "error" ? <span className="storyboard-workbench-card-state is-error">生成失败</span> : status === "done" ? <span className="storyboard-workbench-card-state is-done"><Check />已完成</span> : <span className="storyboard-workbench-card-state">待生成</span>}
            </div>
            <div className="storyboard-workbench-card-actions">
                {status === "error" ? <button type="button" onClick={onRetryFailure} disabled={busy}><RefreshCw />重新生成</button> : null}
                {status === "done" && result?.resultUrls?.length ? <button type="button" onClick={onCreateVariant} disabled={busy}><RefreshCw />生成变体</button> : null}
                {status === "done" && result?.resultUrls?.length ? <Link to="/canvas">添加到画布</Link> : null}
                {result?.resultUrls?.map((url, index) => <a key={`${url}-download`} href={url} download>{result.resultUrls!.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}
            </div>
        </header>
        <div className="storyboard-workbench-card-body">
            <div className="storyboard-workbench-thread" aria-label={`镜头 ${shotNumber} 的对话过程`}>
                {briefVisible && user ? <div className="storyboard-workbench-turn is-user">
                    <div className="storyboard-workbench-turn-copy">
                        <div className="storyboard-workbench-turn-meta"><span className="storyboard-workbench-turn-role">{shotScriptLabels[mode]}</span>{user.createdAt ? <time className="storyboard-workbench-turn-time" dateTime={user.createdAt}>{formatMessageTime(user.createdAt)}</time> : null}</div>
                        <div className="storyboard-workbench-turn-bubble">
                            <p className="storyboard-workbench-turn-text">{displayCreationPrompt(user.content, user.references || [])}</p>
                            {user.references?.length ? <CreationMessageReferences references={user.references} /> : null}
                            {user.attachments?.length ? <StoryboardBriefAttachments attachments={user.attachments} /> : null}
                        </div>
                    </div>
                </div> : null}
                {briefVisible && user ? <div className="storyboard-workbench-handoff" aria-hidden="true"><span className="storyboard-workbench-handoff-rail" /><span className="storyboard-workbench-handoff-badge"><ArrowDown />交给影策 AI</span><span className="storyboard-workbench-handoff-rail" /></div> : null}
                <div className="storyboard-workbench-turn is-ai">
                    <span className="storyboard-workbench-ai-avatar"><Clapperboard /></span>
                    <div className="storyboard-workbench-turn-copy">
                        <div className="storyboard-workbench-turn-meta"><span className="storyboard-workbench-turn-role is-ai"><Sparkles />影策 AI</span>{modelName ? <span className="storyboard-workbench-turn-model">{modelName}</span> : null}{result?.createdAt ? <time className="storyboard-workbench-turn-time" dateTime={result.createdAt}>{formatMessageTime(result.createdAt)}</time> : null}</div>
                        <div className="storyboard-workbench-turn-bubble">
                            <StoryboardShotResult result={result} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </article>;
}

function StoryboardNextShotCard({ shotNumber, onCancel }: { shotNumber: number; onCancel: () => void }) {
    return <article className="storyboard-workbench-card is-next">
        <header className="storyboard-workbench-card-head">
            <div className="storyboard-workbench-card-heading">
                <span className="storyboard-workbench-card-shot"><span className="storyboard-workbench-card-shot-index">SC.{String(shotNumber).padStart(2, "0")}</span>下一镜 {shotNumber}</span>
                <span className="storyboard-workbench-card-state is-draft"><Clapperboard />待撰写</span>
            </div>
            <div className="storyboard-workbench-card-actions">
                <button type="button" onClick={onCancel}><X />取消撰写</button>
            </div>
        </header>
        <div className="storyboard-workbench-card-body">
            <div className="storyboard-workbench-next-panel">
                <span className="storyboard-workbench-next-panel-icon"><Clapperboard /></span>
                <div className="storyboard-workbench-next-panel-copy">
                    <strong>SC.{String(shotNumber).padStart(2, "0")} 等待你的脚本</strong>
                    <span>在下方写下这一镜的镜头、画面或故事。影策会拆解脚本、设计运镜并渲染成片，这一镜会作为 SC.{String(shotNumber).padStart(2, "0")} 自动加入镜头轨道。</span>
                </div>
            </div>
        </div>
    </article>;
}

function StoryboardBriefAttachments({ attachments }: { attachments: CreationAttachment[] }) {    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    return <><div className="creation-user-message-attachments storyboard-workbench-brief-attachments">{attachments.map((attachment) => {
        const isVideo = isVideoAttachment(attachment);
        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
        return <button key={attachment.id} type="button" onClick={() => { setPreviewType(isVideo ? "video" : "image"); setPreviewUrl(isVideo ? attachment.url : url); }} aria-label={`预览 ${attachment.name}`} disabled={!url}>{isVideo ? <video src={attachment.url} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" /> : <img src={url} alt={attachment.name} width={44} height={44} loading="lazy" />}<span aria-hidden="true"><Maximize2 /></span></button>;
    })}</div><CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} /></>;
}

function StoryboardShotResult({ result, onRetryFailure, onCreateVariant }: { result?: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const openPreview = (url: string, type: "image" | "video") => { setPreviewType(type); setPreviewUrl(url); };
    if (!result) return <div className="storyboard-workbench-empty"><Film />这一镜还没开始——在下方写出你的脚本，我来接手。</div>;
    const mode = result.mode || "video";
    const status = result.status || "queued";
    const resultUrls = result.resultUrls || [];
    if (status === "pending" || status === "queued") {
        const thinking = thinkingFor(mode);
        return <div className="storyboard-workbench-pending"><div className="storyboard-workbench-thinking">
            <span className="storyboard-workbench-thinking-copy"><strong>{thinking.title}</strong><span>{thinking.hint}</span></span>
            <span className="storyboard-workbench-pipeline" aria-hidden="true">{thinking.steps.map((step, index) => <em key={step} style={{ "--step": index } as CSSProperties}><i>{String(index + 1).padStart(2, "0")}</i>{step}</em>)}</span>
        </div></div>;
    }
    if (status === "error") return <div className="storyboard-workbench-error"><span>{generationErrorMessage(result.error || "")}</span><button type="button" onClick={onRetryFailure}><RefreshCw />重新生成</button></div>;
    if (mode === "text") return <div className="creation-message-content storyboard-workbench-text">{result.content ? <ReactMarkdown>{result.content}</ReactMarkdown> : <span>正在生成…</span>}</div>;
    if (!resultUrls.length) return <div className="storyboard-workbench-empty"><Film />没有返回可预览结果 <button type="button" onClick={onRetryFailure}>重试</button></div>;
    const note = result.settings ? directorNoteFor(mode, result.settings) : "";
    return <>
        {mode === "video" ? <button type="button" className="creation-video-result" onClick={() => openPreview(resultUrls[0], "video")} aria-label="预览生成视频"><video muted preload="metadata" className="size-full object-cover" src={resultUrls[0]} /><span><Maximize2 />预览视频</span></button> : <div className="creation-image-result-grid">{resultUrls.map((url) => <button key={url} type="button" className="creation-image-result" onClick={() => openPreview(url, "image")} aria-label="预览生成图片"><img src={url} alt="生成结果" /><span><Maximize2 /></span></button>)}</div>}
        {note ? <p className="storyboard-workbench-director-note"><span>导演手记</span>{note}</p> : null}
        <div className="storyboard-workbench-media-meta"><span>{mode === "video" ? "视频结果" : `${resultUrls.length} 张图片`}</span><button type="button" onClick={onCreateVariant}><RefreshCw />生成变体</button><Link to="/canvas">添加到画布</Link>{resultUrls.map((url, index) => <a key={`${url}-download`} href={url} download>{resultUrls.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}</div>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
    </>;
}

function videoResolutionLabel(value: string | number) {
    return Number(String(value).replace(/p$/i, "")) === 2160 ? "4K" : `${String(value).replace(/p$/i, "")}P`;
}

function formatMessageTime(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? conversationTimeFormatter.format(timestamp) : "";
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
    const images = (item.attachments || []).filter(isImageAttachment);
    if (!images.length) return content;
    return [{ type: "text" as const, text: content }, ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl || image.url || "" } }))];
}

function isVideoAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { url: string } {
    return attachment.type.startsWith("video/");
}

function isImageAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { dataUrl: string } {
    return !isVideoAttachment(attachment);
}

function removeReferenceTokens(value: string, references: CreationReference[]) {
    return references.reduce((current, reference) => current.split(canvasResourceMentionToken(reference)).join(""), value);
}

function pendingCreationMediaKey(conversations: CreationConversation[]) {
    return conversations.flatMap((conversation) => conversation.messages.flatMap((message) => message.role === "assistant" && message.status === "pending" && message.mode !== "text" ? [`${conversation.id}:${message.id}:${(message.taskIds || []).join(",")}`] : [])).join("|");
}

function pendingCreationTaskIds(conversations: CreationConversation[]) {
    const taskIds = conversations.flatMap((conversation) => conversation.messages.flatMap((message) => {
        if (message.role !== "assistant" || message.status !== "pending" || message.mode === "text") return [];
        return message.taskIds || [];
    }));
    return Array.from(new Set(taskIds));
}

async function enrichCreationTaskSummaries(tasks: GenerationTask[]) {
    return Promise.all(tasks.map(async (task) => {
        if (!task.clientContext || (task.status !== "failed" && (task.status !== "succeeded" || task.previewUrl))) return task;
        const detail = await queryGenerationTask(task.id).catch(() => null);
        return detail ? { ...task, ...detail, clientContext: task.clientContext } : task;
    }));
}

type PersistedCreationTask = GenerationTask & { creationResultUrls?: string[]; creationError?: string };

async function persistCreationTaskResults(tasks: GenerationTask[]): Promise<PersistedCreationTask[]> {
    const addAsset = useAssetStore.getState().addAsset;
    return Promise.all(tasks.map(async (task): Promise<PersistedCreationTask> => {
        if (task.status !== "succeeded" || !task.clientContext) return task;
        try {
            const result = task.resultJson ? parseBackendGenerationResult(task) : null;
            const images = result?.images?.length ? result.images : task.previewUrl && task.previewKind !== "video" ? [{ dataUrl: task.previewUrl }] : [];
            if (images.length) {
                const storedImages = await Promise.all(images.map(async (image, resultIndex) => {
                    const uploaded = await persistCreationImageResult(image);
                    addCreationAssetOnce(creationImageAsset({ title: task.prompt.slice(0, 24), uploaded, metadata: { source: "create-generation", taskId: task.id, conversationId: task.clientContext?.conversationId, messageId: task.clientContext?.messageId, batchIndex: task.clientContext?.batchIndex, resultIndex, prompt: task.prompt } }), { taskId: task.id, messageId: task.clientContext?.messageId, resultIndex });
                    return uploaded.url;
                }));
                return { ...task, creationResultUrls: storedImages };
            }

            const videoUrl = result?.video?.dataUrl || (task.previewKind === "video" ? task.previewUrl : "");
            if (videoUrl) {
                const storedVideo = await storeGeneratedVideo({ url: videoUrl, mimeType: result?.video?.mimeType || "video/mp4" });
                if (!storedVideo.url) throw new Error("视频结果资源不可用");
                addCreationAssetOnce(creationVideoAsset({ title: task.prompt.slice(0, 24), uploaded: storedVideo, metadata: { source: "create-generation", taskId: task.id, conversationId: task.clientContext?.conversationId, messageId: task.clientContext?.messageId, batchIndex: task.clientContext?.batchIndex, resultIndex: 0, prompt: task.prompt } }), { taskId: task.id, messageId: task.clientContext?.messageId, resultIndex: 0 });
                return { ...task, creationResultUrls: [storedVideo.url] };
            }
            return task;
        } catch (error) {
            return { ...task, creationError: error instanceof Error ? error.message : "生成结果资源化失败" };
        }
    }));
}

function reconcileCreationTaskMessages(conversations: CreationConversation[], tasks: PersistedCreationTask[]) {
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
            const failedCount = matches.filter((task) => task.status !== "succeeded" || Boolean(task.creationError)).length;
            const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
            completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
            conversationChanged = true;
            changed = true;

            if (resultUrls.length) {
                const content = message.mode === "video" ? "视频已生成" : failedCount ? `${resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成";
                return { ...message, status: "done" as const, content, resultUrls, error: undefined, taskIds: nextTaskIds };
            }
            if (matches.every((task) => task.status === "cancelled")) return { ...message, status: "cancelled" as const, content: "已停止", error: undefined, taskIds: nextTaskIds };
            const failed = matches.find((task) => task.status === "failed" || task.creationError);
            return { ...message, status: "error" as const, content: "生成失败", error: generationErrorMessage(failed?.creationError || failed?.error || "任务已结束，但生成结果暂时无法读取"), taskIds: nextTaskIds };
        });
        return conversationChanged ? { ...conversation, messages, updatedAt: completedAt } : conversation;
    });
    return changed ? next : conversations;
}

function creationTaskResultUrls(task: PersistedCreationTask) {
    if (task.creationResultUrls?.length) return task.creationResultUrls;
    return [];
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
