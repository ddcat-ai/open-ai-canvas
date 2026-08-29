import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { App, Button, Drawer, Modal, Popover, Spin, Tooltip } from "antd";
import { Reorder } from "motion/react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Clock3, Copy, Download, FileText, Film, FolderOpen, History, Image as ImageIcon, LoaderCircle, Maximize2, MessageSquareText, Minimize2, Music2, Paperclip, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import { Link } from "react-router";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { CanvasPromptOptimizerDrawer } from "@/components/canvas/canvas-prompt-optimizer-drawer";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { creationCanvasHandoffPath, creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { createGenerationBatchRetryContexts, createGenerationRetryContext, runGenerationOperationOnce, type GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { createClientId } from "@/lib/client-id";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { buildImageResolutionOptions, formatImageResolutionSize, imageRatioForSize, imageResolutionChoices, imageResolutionOption, imageSizeForResolution, supportsImageResolutionPresets, type ImageResolutionChoice } from "@/lib/image-resolution-tiers";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { inferVideoOperation, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import { backendModelRuntimeRequired, isGenerationTaskCancelled, runBackendGenerationTask, runBackendGenerationTaskBatch, type BackendGenerationResult } from "@/services/api/generation-task";
import { requestImageQuestion, type AiTextContentPart } from "@/services/api/image";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { createTextReplayPublisher } from "@/lib/creation-text-replay";
import { isLocalDreaminaWaitStopped, localDreaminaCancellationMessage } from "@/services/local-dreamina-task-projection";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { consumeGenerationTaskMessage, generationTaskMaterializedUrls, materializeGenerationTaskAssets, projectGenerationTaskResult } from "@/services/project-asset-sync";
import { applyGenerationConsumerEffect } from "@/services/generation-consumer-dedupe";
import { beginGenerationConsumer, runGenerationConsumer } from "@/services/generation-consumer-lifecycle";
import { loadCreationConversations, pendingCreationTaskIds, pendingCreationTaskKey, removeCreationConversationSnapshot, saveCreationConversations, updateCreationConversationSnapshot } from "@/services/creation-conversation-store";
import { recoverCreationTextTask } from "@/services/creation-text-task-recovery";
import { modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { buildCreationMentionReferences, displayCreationPrompt, expandCreationPrompt, reconcileCreationAttachmentLimit, removeCreationReferenceTokens, replaceCreationAttachmentReference, selectedCreationReferences, type CreationReference } from "./creation-references";
import { skillRuntime } from "@/services/skill-runtime";
import { creationAttachmentFromAsset, creationAttachmentFromAudio, creationAttachmentFromAudioAsset, creationAttachmentFromDocument, creationAttachmentFromExternalAsset, creationAttachmentFromImage, creationAttachmentFromVideo, creationAttachmentFromVideoAsset, creationAttachmentKind, creationAudioAsset, creationFileAccepted, creationImageAsset, creationMediaAspectRatio, creationUploadAccept, creationVideoAsset, removeCreationAttachment, splitCreationAttachments, type CreationAttachment } from "./creation-assets";

type CreationMode = "text" | "image" | "video";
type CreationViewMode = "chat" | "storyboard";
type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string };
type CreationRetryContext = GenerationRetryContext & { retryContextsByBatchIndex?: GenerationRetryContext[] };
type CreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: CreationMode;
    content: string;
    reasoning?: string;
    createdAt: string;
    status?: CreationStatus;
    model?: string;
    resultUrls?: string[];
    error?: string;
    generationErrorCode?: string;
    generationOperation?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
    clientOperationId?: string;
    retryOf?: string;
    attemptGroupId?: string;
    generationStage?: string;
    generationEffectKeys?: string[];
};
type CreationConversation = { id: string; title: string; updatedAt: string; messages: CreationMessage[] };

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
const TEXT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const conversationTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

function newMessage(role: CreationMessage["role"], content: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id: createClientId(), role, content, createdAt: new Date().toISOString(), ...extra };
}

type CreationShot = { user?: CreationMessage; result?: CreationMessage };

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

function completedCreationGenerationTask(input: { taskId: string; task?: GenerationTask; mode: "image" | "video"; prompt: string; result: BackendGenerationResult; conversationId: string; messageId: string; batchIndex?: number; batchCount?: number }): GenerationTask {
    const now = new Date().toISOString();
    const task = input.task ?? { id: input.taskId, type: input.mode, status: "succeeded" as const, prompt: input.prompt, attempts: 1, createdAt: now, updatedAt: now };
    return projectGenerationTaskResult({ ...task, status: "succeeded", prompt: input.prompt, clientContext: { conversationId: input.conversationId, messageId: input.messageId, ...(typeof input.batchIndex === "number" ? { batchIndex: input.batchIndex } : {}), ...(typeof input.batchCount === "number" ? { batchCount: input.batchCount } : {}) } }, input.result);
}

export default function CreatePage() {
    const { message: toast, modal } = App.useApp();
    const config = useEffectiveConfig();
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const promptOptimizerProvider = useMemo<PromptOptimizerProvider | null>(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, config));
    }, [config, promptOptimizerEnabled, promptOptimizerInstallation]);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [conversations, setConversations] = useState<CreationConversation[]>([]);
    const conversationsRef = useRef<CreationConversation[]>([]);
    const [activeId, setActiveId] = useState("");
    const activeIdRef = useRef("");
    const [hydrated, setHydrated] = useState(false);
    const [mode, setMode] = useState<CreationMode>("video");
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const promptRef = useRef(prompt);
    const attachmentsRef = useRef(attachments);
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [busy, setBusy] = useState(false);
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [viewMode, setViewMode] = useState<CreationViewMode>("chat");
    const [selectedShotIndex, setSelectedShotIndex] = useState(-1);
    const [composingNextShot, setComposingNextShot] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const externalAssetSources = useExternalAssetSources(libraryOpen);
    const abortRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const retryPreparingRef = useRef(new Set<string>());
    const pendingRetryRef = useRef<{ context: CreationRetryContext; lockKey: string } | null>(null);
    const [retrySequence, setRetrySequence] = useState(0);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

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
            audioCount: attachments.filter((attachment) => creationAttachmentKind(attachment) === "audio").length,
            characterCount: 0,
        },
        videoSeconds: mode === "video" ? seconds : undefined,
        imageSize: mode === "image" ? ratio : undefined,
		options: mode === "image"
			? { size: ratio, quality, count: Number(count), transparentBackground: config.transparentBackground === "true" }
			: mode === "video"
				? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality, videoGenerateAudio: config.videoGenerateAudio === "true", videoWatermark: config.videoWatermark === "true" }
				: {},
	}), [attachments, config.transparentBackground, config.videoGenerateAudio, config.videoWatermark, count, hasPrompt, mode, quality, ratio, seconds, videoQuality]);
    const selectedModel = resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    const maxReferences = mode === "video" ? videoProfile.operations.includes("image_to_video") ? videoProfile.references.maxImages : 0 : mode === "image" ? imageProfile.references.maxImages : 6;
    const referenceImageSize = useMemo(() => {
        const imageAttachments = attachments.filter(isImageAttachment);
        if (imageAttachments.length !== 1) return undefined;
        const { width, height } = imageAttachments[0];
        if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return undefined;
        return { width, height };
    }, [attachments]);
    const mentionReferences = useMemo(() => buildCreationMentionReferences(addedSkills, attachments, draftReferences), [addedSkills, attachments, draftReferences]);
    const isEmpty = !activeConversation?.messages.length;
    const pendingTaskKey = useMemo(() => pendingCreationTaskKey(conversations), [conversations]);
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(conversations), [conversations]);
    const shots = useMemo(() => shotsFromMessages(activeConversation?.messages || []), [activeConversation]);
    const visibleShotIndex = shots.length ? selectedShotIndex >= 0 && selectedShotIndex < shots.length ? selectedShotIndex : shots.length - 1 : -1;

    useEffect(() => {
        if (mode !== "image") return;
        // 前台逻辑模型的默认参数优先于旧的全局创作参数；否则旧的合法值会一直覆盖后台刚配置的默认值。
        const normalized = normalizeImageValue(imageProfile, {
            size: imageProfile.size.default,
            quality: imageProfile.quality.default,
            count,
        });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setCount(normalized.count);
    }, [mode, selectedModel, imageProfile]);

    useEffect(() => {
        if (mode !== "video") return;
        // 前台逻辑模型的默认参数必须直接落到创作端状态，提交任务时才不会被旧状态覆盖。
        const normalized = normalizeVideoValue(videoProfile, {
            seconds: String(videoProfile.duration.default),
            ratio: videoProfile.defaultRatio,
            resolution: videoProfile.defaultResolution,
        });
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        const maxReferences = videoProfile.operations.includes("image_to_video") ? videoProfile.references.maxImages : 0;
        if (attachments.length > maxReferences) setAttachments((current) => current.slice(0, maxReferences));
    }, [mode, selectedModel, videoProfile]);

    useEffect(() => {
        const reconciled = reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciled.attachments === attachments) return;
        setAttachments(reconciled.attachments);
        if (reconciled.removedReferences.length) setPrompt((current) => removeCreationReferenceTokens(current, reconciled.removedReferences));
    }, [attachments, maxReferences, mentionReferences]);

    useEffect(() => {
        let cancelled = false;
        void loadCreationConversations<CreationConversation>().then((stored) => {
            if (cancelled) return;
            const next = stored?.length ? stored : [newConversation()];
            conversationsRef.current = next;
            setConversations(next);
            setActiveId(next[0].id);
            setHydrated(true);
        });
        return () => {
            cancelled = true;
            // 页面卸载只停止当前页面的状态更新，后台任务由任务中心继续执行，返回页面后再恢复状态。
        };
    }, []);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (hydrated) void saveCreationConversations(conversations);
    }, [conversations, hydrated]);

    useEffect(() => {
        if (!hydrated || !pendingTaskKey || !pendingTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const contextual = attachCreationTaskContexts(tasks, conversations);
            const persistedTasks = await materializeCreationTaskResults(contextual, observationController.signal);
            if (cancelled) return;
            taskSyncWarningRef.current = false;
            const attachable = persistedTasks.filter((task) => task.status === "succeeded" && Boolean(task.clientContext?.messageId) && Boolean(task.creationResultUrls?.length));
            for (const task of attachable) {
                await consumeGenerationTaskMessage(task, task.clientContext!.messageId!, async ({ effectKey, resultUrls }) => {
                    if (cancelled) return;
                    await updateConversationMessage(task.clientContext!.conversationId!, task.clientContext!.messageId!, (item) =>
                        applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) })).value,
                    );
                }, { signal: observationController.signal, materialize: async () => task, materializedUrls: generationTaskMaterializedUrls });
            }
            if (!attachable.length && !cancelled) setConversations((current) => reconcileCreationTaskMessages(current, persistedTasks));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn("创作任务状态同步失败", error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning("任务状态暂时无法同步，请稍后刷新");
            }
        };
        let applyChain = Promise.resolve();
        const unsubscribe = subscribeGenerationTasks(pendingTaskIds, (task) => {
            applyChain = applyChain.then(() => applyTasks([task])).catch(warnSync);
        });
        return () => {
            cancelled = true;
            observationController.abort();
            unsubscribe();
        };
    }, [hydrated, pendingTaskKey, toast]);

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
        const next = updateCreationConversationSnapshot(conversationsRef.current, activeId, updater);
        conversationsRef.current = next;
        setConversations(next);
    }, [activeId]);

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => item.id === id ? updater(item) : item),
        }));
        conversationsRef.current = next;
        setConversations(next);
        await saveCreationConversations(next);
    }, []);

    const selectMode = (next: CreationMode) => {
        setMode(next);
        const nextModels = selectableModelsByCapability(config, next);
        const current = next === "text" ? config.textModel : next === "image" ? config.imageModel : config.videoModel;
        if (!nextModels.includes(current) && nextModels[0]) {
            updateConfig(next === "text" ? "textModel" : next === "image" ? "imageModel" : "videoModel", nextModels[0]);
        }
    };

    const externalLibraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => externalAssetSources.items.map((item) => ({
            ...item,
            disabledReason: mode === "image" && item.external?.item.kind !== "image" ? "图片创作仅支持参考图" : undefined,
        })),
        [externalAssetSources.items, mode],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(() => [
        ...assets
            .filter((asset): asset is Extract<Asset, { kind: "image" | "video" | "audio" }> => asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
            .map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: asset.category || "other",
                kindLabel: asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片",
                asset,
                searchText: (asset.tags || []).join(" "),
                disabledReason: mode === "image" && asset.kind !== "image" ? "图片创作仅支持参考图" : undefined,
            })),
        ...externalLibraryItems,
    ], [assets, externalLibraryItems, mode]);
    const uploadCreationAsset = async (file: File) => {
        if (file.type.startsWith("video/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationVideoAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromVideo(file, uploaded),
            };
        }
        if (file.type.startsWith("audio/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationAudioAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromAudio(file, uploaded),
            };
        }
        if (!file.type.startsWith("image/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return { attachment: creationAttachmentFromDocument(file, uploaded) };
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
            .filter((file) => creationFileAccepted(mode, file))
            .slice(0, Math.max(0, maxReferences - attachments.length));
        if (!next.length) return;
        void Promise.allSettled(next.map(async (file) => {
            const { asset, attachment } = await uploadCreationAsset(file);
            if (asset) addAsset(asset);
            return attachment;
        })).then((settled) => {
            const items = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
            const failed = settled.filter((entry) => entry.status === "rejected");
            if (items.length) setAttachments((current) => [...current, ...items].slice(0, maxReferences));
            if (failed.length) toast.error(`${failed.length} 个参考素材上传失败，请重试`);
        });
    };

    const uploadLibraryAssets = async (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => creationFileAccepted(mode, file));
        if (!next.length) return [];
        const settled = await Promise.allSettled(next.map(async (file) => {
            const { asset } = await uploadCreationAsset(file);
            return asset ? addAsset(asset) : "";
        }));
        const assetIds = settled.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : []);
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(`${assetIds.length} 个素材已上传到素材库并自动选中`);
        if (failed.length) toast.error(`${failed.length} 个素材上传失败，请重试`);
        return assetIds;
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) addAttachments(event.target.files);
        event.target.value = "";
    };

    const handleLibrarySelect = (selectedIds: string[]) => {
        const next = selectedIds.flatMap((id): CreationAttachment[] => {
            const asset = assets.find((item) => item.id === id);
            if (asset?.kind === "image") return [creationAttachmentFromAsset(asset)];
            if (asset?.kind === "video" && mode !== "image") return [creationAttachmentFromVideoAsset(asset)];
            if (asset?.kind === "audio" && mode !== "image") return [creationAttachmentFromAudioAsset(asset)];
            const external = libraryItems.find((item) => item.id === id)?.external;
            return external ? [creationAttachmentFromExternalAsset(external)] : [];
        });
        if (!next.length) return;
        setAttachments((current) => [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next].slice(0, maxReferences));
        setLibraryOpen(false);
    };

    const removeAttachment = (id: string) => {
        const reference = mentionReferences.find((item) => item.attachmentId === id);
        setAttachments((current) => removeCreationAttachment(current, id));
        if (reference) setPrompt((current) => removeCreationReferenceTokens(current, [reference]));
    };

    const clearAttachments = () => {
        const attachmentIds = new Set(attachments.map((item) => item.id));
        const references = mentionReferences.filter((item) => item.attachmentId && attachmentIds.has(item.attachmentId));
        setAttachments([]);
        if (references.length) setPrompt((current) => removeCreationReferenceTokens(current, references));
    };

    const reorderAttachments = useCallback((next: CreationAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);

    const replaceAttachmentReference = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        const currentAttachments = attachmentsRef.current;
        const target = currentAttachments.find((attachment) => attachment.id === targetAttachmentId);
        if (!target) throw new Error("要替换的参考图不存在");
        if (creationAttachmentKind(target) !== "image" || creationAttachmentKind(replacement) !== "image") throw new Error("目前只支持替换提示词中的图片引用");
        if (target.id === replacement.id) return false;

        const result = replaceCreationAttachmentReference(promptRef.current, currentAttachments, targetAttachmentId, replacement);
        promptRef.current = result.prompt;
        attachmentsRef.current = result.attachments;
        setPrompt(result.prompt);
        setAttachments(result.attachments);
        return true;
    }, []);

    const replaceReferenceFromTrack = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        try {
            if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success("参考图已替换，槽位不变，提示词无需修改");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "参考图替换失败");
        }
    }, [replaceAttachmentReference, toast]);

    const replaceReferenceFromFiles = useCallback(async (targetAttachmentId: string, files: File[]) => {
        if (busy || referenceReplacementBusy) return;
        const file = files.find((item) => item.type.startsWith("image/"));
        if (!file) {
            toast.warning("请拖入图片文件进行替换");
            return;
        }
        setReferenceReplacementBusy(true);
        try {
            const { asset, attachment } = await uploadCreationAsset(file);
            if (creationAttachmentKind(attachment) !== "image") throw new Error("上传结果不是可用图片");
            if (asset) addAsset(asset);
            if (replaceAttachmentReference(targetAttachmentId, attachment)) toast.success("参考图已替换，槽位不变，提示词无需修改");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "参考图上传或替换失败");
        } finally {
            setReferenceReplacementBusy(false);
        }
    }, [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, toast]);

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string) => {
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        const text = prompt.trim();
        if (!text || busy || !activeConversation) {
            releaseRetryLock();
            return;
        }
        if (!selectedModel) {
            toast.warning(`请先在设置中配置${modeLabels[mode]}模型`);
            releaseRetryLock();
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds))) {
            toast.error("当前模型不支持所选视频时长，请重新选择");
            releaseRetryLock();
            return;
        }
        if (attachments.length > maxReferences) {
            toast.warning("参考内容正在按当前模型能力调整，请稍后重试");
            releaseRetryLock();
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(attachments);
        const videoOperation = inferVideoOperation({
            textCount: text ? 1 : 0,
            imageCount: referenceImages.length,
            videoCount: referenceVideos.length,
            audioCount: referenceAudios.length,
            characterCount: 0,
        });
        const skillReferences = references.flatMap((reference) => (reference.skill ? [reference.skill] : []));
        let skillExecution: Awaited<ReturnType<typeof skillRuntime.prepare<"creation">>>;
        try {
            skillExecution = await skillRuntime.prepare({
                profile: "creation",
                prompt: expandCreationPrompt(text, references, attachments),
                skills: skillReferences,
                selectedSkillIds: skillReferences.map((skill) => skill.skill_id),
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "技能上下文加载失败");
            releaseRetryLock();
            return;
        }
        const expandedPrompt = skillExecution.prompt;
        const referenceMetadata = skillExecution.metadata;
        followLatestMessageRef.current = true;
        const userMessage = newMessage("user", text, { mode, model: selectedModel, attachments, references, settings });
        const assistantMessage = newMessage("assistant", "", { mode, model: selectedModel, status: mode === "text" ? "streaming" : "pending", settings, ...retryContext });
        const originConversationId = activeConversation.id;
        const updateOriginAssistant = (updater: (item: CreationMessage) => CreationMessage) => updateConversationMessage(originConversationId, assistantMessage.id, updater);
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const boundTasks = new Map<string, GenerationTask>();
        const bindTask = (task: GenerationTask) => {
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
            boundTaskIds.add(task.id);
            boundTasks.set(task.id, task);
            updateOriginAssistant((item) => ({ ...item, generationStage: task.stage, generationOperation: task.operation, generationErrorCode: task.errorCode, taskIds: Array.from(new Set([...(item.taskIds || []), task.id])), clientOperationId: task.clientOperationId, retryOf: task.retryOf, attemptGroupId: task.attemptGroupId }));
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
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
        const requestLifecycle = beginGenerationConsumer(controller.signal);
        abortRef.current = controller;
        const normalizedImage = mode === "image" ? normalizeImageValue(imageProfile, { size: ratio, quality, count }) : undefined;
        const normalizedVideo = mode === "video" ? normalizeVideoValue(videoProfile, { seconds, ratio, resolution: videoQuality }) : undefined;
        const requestConfig = {
            ...config,
            model: selectedModel,
            imageModel: selectedModel,
            videoModel: selectedModel,
            textModel: selectedModel,
            ...(mode === "image"
                ? { size: normalizedImage?.size || ratio, quality: normalizedImage?.quality || quality, count: normalizedImage?.count || count, videoSeconds: config.videoSeconds }
                : mode === "video"
                  ? { size: normalizedVideo?.ratio ?? ratio, videoSeconds: normalizedVideo?.seconds || seconds, vquality: (normalizedVideo?.resolution ?? videoQuality).replace(/p$/i, "") }
                  : {}),
        };
        try {
            if (mode === "text") {
                if (backendModelRuntimeRequired(requestConfig)) {
					const result = await runGenerationOperationOnce(retryContext?.clientOperationId, () => runBackendGenerationTask({
						mode: "text",
						prompt: expandedPrompt,
						config: requestConfig,
						referenceImages,
						referenceVideos,
						referenceAudios,
						textHistory: (activeConversation.messages || []).filter((item) => item.content.trim()).map((item) => ({ role: item.role, content: item.content })),
						signal: requestLifecycle.signal,
						metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
						onTaskUpdate: bindTask,
						onTextDelta: (text) => updateOriginAssistant((item) => ({ ...item, content: text })),
						...retryContext,
					}));
					if (!result.text?.trim()) throw new Error("后端任务没有返回文本");
					updateOriginAssistant((item) => ({ ...item, content: result.text || "" }));
				} else {
					const history = await Promise.all([...(activeConversation.messages || []), userMessage].map(async (item) => ({
						role: item.role,
						content: item.role === "user"
							? await buildTextMessageContent(item)
							: item.content,
					})));
					const replayPublisher = createTextReplayPublisher(requestConfig, text);
					void replayPublisher.start();
					let finalText = "";
					await requestImageQuestion(requestConfig, history, (full) => {
						finalText = full;
						updateOriginAssistant((item) => ({ ...item, content: full }));
						replayPublisher.publish(full);
					}, {
						signal: requestLifecycle.signal,
						onReasoning: (reasoning) => updateOriginAssistant((item) => ({ ...item, reasoning })),
					});
					replayPublisher.finish(finalText);
				}
            } else if (mode === "image") {
                const taskCount = Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runGenerationOperationOnce(retryContext?.clientOperationId, () => runBackendGenerationTaskBatch({
                    mode: "image",
                    prompt: expandedPrompt,
                    config: { ...requestConfig, count: "1" },
                    referenceImages,
                    signal: requestLifecycle.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    count: taskCount,
                    ...retryContext,
                }));
                if (requestLifecycle.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedImages = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return (entry.value.images || []).map((image, resultIndex) => ({
                        image,
                        taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                        batchIndex,
                        resultIndex,
                    }));
                });
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const storedImages = await Promise.allSettled(generatedImages.map(async ({ image, taskId, batchIndex }) => {
                    if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                    const task = completedCreationGenerationTask({ taskId, task: boundTasks.get(taskId), mode: "image", prompt: expandedPrompt, result: { mode: "image", images: [image] }, conversationId: activeConversation.id, messageId: assistantMessage.id, batchIndex, batchCount: taskCount });
                    const materialized = await consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, effectKey }) => {
                        await updateOriginAssistant((item) => applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "图片已生成", resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) })).value);
                    }, { signal: requestLifecycle.signal });
                    const url = generationTaskMaterializedUrls(materialized)[0];
                    if (!url) throw new Error("图片结果资源不可用");
                    return url;
                }));
                const resultUrls = storedImages.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    const reason = taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failedCount) toast.warning(`${resultUrls.length} 张图片已生成，${failedCount} 张生成失败`);
                updateOriginAssistant((item) => ({ ...item, content: failedCount ? `${resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成" }));
            } else {
                const result = await runGenerationOperationOnce(retryContext?.clientOperationId, () => runBackendGenerationTask({
                    mode: "video",
                    prompt: expandedPrompt,
                    config: requestConfig,
                    referenceImages,
                    referenceVideos,
                    referenceAudios,
                    signal: requestLifecycle.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: videoOperation, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    ...retryContext,
                }));
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                const task = completedCreationGenerationTask({ taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, effectKey }) => {
                    await updateOriginAssistant((item) => applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "视频已生成", resultUrls })).value);
                }, { signal: requestLifecycle.signal });
                if (!generationTaskMaterializedUrls(materialized)[0]) throw new Error("视频结果资源不可用");
            }
            updateOriginAssistant((item) => ({ ...item, status: "done" }));
        } catch (error) {
            if (isGenerationTaskCancelled(error, requestLifecycle.signal)) {
                updateOriginAssistant((item) => ({ ...item, status: "cancelled", content: "已停止" }));
                return;
            }
            const message = generationErrorMessage(error);
            updateOriginAssistant((item) => ({ ...item, status: "error", error: message, generationErrorCode: item.generationErrorCode || generationErrorCode(error), generationOperation: item.generationOperation || (mode === "video" ? videoOperation : mode), createdAt: assistantMessage.createdAt, content: "生成失败" }));
        } finally {
            requestLifecycle.release();
            releaseRetryLock();
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        }
    };

    useEffect(() => {
        if (!retrySequence) return;
        const pending = pendingRetryRef.current;
        if (!pending) return;
        pendingRetryRef.current = null;
        void submit(pending.context, pending.lockKey);
    }, [retrySequence]);

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

    const confirmDeleteConversation = (conversation: CreationConversation) => {
        const title = conversation.title.trim() || "新创作";
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: "删除历史对话？",
            content: `确定删除「${label}」吗？这只会删除历史对话记录，不会删除已上传或生成的任何素材。此操作不可撤销。`,
            okText: "删除对话",
            okButtonProps: { danger: true },
            cancelText: "保留",
            onOk: async () => {
                try {
                    const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversation.id);
                    const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
                    const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
                    const next = remaining.length ? remaining : [fallback];
                    await saveCreationConversations(next);
                    conversationsRef.current = next;
                    setConversations(next);
                    if (activeIdRef.current === conversation.id) {
                        followLatestMessageRef.current = true;
                        activeIdRef.current = fallback.id;
                        setActiveId(fallback.id);
                        setPrompt("");
                        setAttachments([]);
                        setDraftReferences([]);
                        setSelectedShotIndex(-1);
                        setComposingNextShot(false);
                    }
                    toast.success("历史对话已删除，素材仍保留");
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : "历史对话删除失败");
                    throw error;
                }
            },
        });
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

    const retryFailedMessage = async (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        const retryOf = item.taskIds?.[0];
        const restoreForRetry = () => {
            followLatestMessageRef.current = true;
            restoreMessageDraft(previous);
            setSelectedShotIndex(-1);
            setComposingNextShot(false);
            const removedIds = new Set([item.id, previous.id]);
            updateActive((conversation) => {
                const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
                const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : "新创作", updatedAt: new Date().toISOString(), messages };
            });
        };
        if (!retryOf) {
            restoreForRetry();
            return;
        }
        if (retryPreparingRef.current.has(retryOf)) return;
        retryPreparingRef.current.add(retryOf);
        try {
            const attemptGroupId = item.attemptGroupId || item.retryOf || retryOf;
            const context: CreationRetryContext = { ...(await createGenerationRetryContext(retryOf, attemptGroupId)), ...(item.taskIds && item.taskIds.length > 1 ? { retryContextsByBatchIndex: await createGenerationBatchRetryContexts(item.taskIds, attemptGroupId) } : {}) };
            restoreForRetry();
            pendingRetryRef.current = { context, lockKey: retryOf };
            setRetrySequence((current) => current + 1);
        } catch (error) {
            retryPreparingRef.current.delete(retryOf);
            toast.error(generationErrorMessage(error));
        }
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
        referenceReplacementBusy,
        attachments,
        referenceImageSize,
        maxReferences,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        onClearAttachments: clearAttachments,
        onReorderAttachments: reorderAttachments,
        onReplaceAttachment: replaceReferenceFromTrack,
        onReplaceReferenceFiles: replaceReferenceFromFiles,
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
        promptOptimizerProvider,
        composerFocusRef,
        placeholderOverride: viewMode === "storyboard" && composingNextShot ? `SC.${String(nextShotNumber).padStart(2, "0")} · 写下这一镜的镜头、画面或故事` : undefined,
        onSubmit: () => void submit(),
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
            </> : viewMode === "chat" ? <div className="creation-thread-workbench">
                <CreationWorkspaceToolbar viewMode={viewMode} onViewModeChange={setViewMode} onNewConversation={startNewConversation} onOpenHistory={() => setHistoryOpen(true)} />
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                    <section className="creation-thread-stage"><div className="creation-results">{activeConversation.messages.map((item, index) => <CreationMessageView
                        key={item.id}
                        item={item}
                        modelName={item.model ? modelDisplayName(config, item.model) : ""}
                        onRetryFailure={() => retryFailedMessage(item, index)}
                        onCreateVariant={() => createVariant(item, index)}
                    />)}</div></section>
                </main>
                <section className="creation-thread-composer"><CreationComposer {...composerProps} variant="thread" /></section>
            </div> : <div className="storyboard-workbench">
                <StoryboardToolbar
                    shots={shots}
                    activeIndex={visibleShotIndex}
                    composing={composingNextShot}
                    onSelect={(index) => { setSelectedShotIndex(index); setComposingNextShot(false); }}
                    onBeginCompose={beginComposeNextShot}
                    onCancelCompose={cancelComposeNextShot}
                    onNewConversation={startNewConversation}
                    onOpenHistory={() => setHistoryOpen(true)}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
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
        <CreationHistoryDrawer open={historyOpen} conversations={historyConversations} activeId={activeConversation.id} onClose={() => setHistoryOpen(false)} onSelect={selectConversation} onDelete={confirmDeleteConversation} />
        <AssetLibraryPickerModal
            open={libraryOpen}
            items={libraryItems}
            categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            initialSelectedIds={attachments.flatMap((item) => item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : [])}
            upload={{ accept: creationUploadAccept(mode), description: mode === "text" ? "支持图片、视频、音频和常用文档；媒体会保存到素材库" : `支持图片${mode === "video" ? "、视频和音频" : ""}，上传后保存到素材库`, onUpload: uploadLibraryAssets, external: { accept: "image/*", description: "写入当前 Eagle 文件夹；Eagle 当前支持图片文件", onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) } }}
            onClose={() => setLibraryOpen(false)}
            onConfirm={handleLibrarySelect}
        />
    </>;
}

const creationAssetCategoryLabels: Record<string, string> = { all: "全部素材", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };

function CreationHistoryDrawer({ open, conversations, activeId, onClose, onSelect, onDelete }: { open: boolean; conversations: CreationConversation[]; activeId: string; onClose: () => void; onSelect: (conversation: CreationConversation) => void; onDelete: (conversation: CreationConversation) => void }) {
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
                        <button type="button" className="creation-history-item-main" aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation)}>
                            <span className="creation-history-time"><time dateTime={conversation.updatedAt}>{formatConversationTime(conversation.updatedAt)}</time><em>{latest?.mode ? modeLabels[latest.mode] : "创作"}</em></span>
                            <strong className="creation-history-item-heading">{conversation.title.trim() || "新创作"}</strong>
                            <span className="creation-history-snippet">{latest ? displayCreationPrompt(latest.content, latest.references || []).trim() || "还没有开始创作" : "还没有开始创作"}</span>
                        </button>
                        <Tooltip title="删除对话"><button type="button" className="creation-history-delete" aria-label={`删除对话：${conversation.title.trim() || "新创作"}`} onClick={() => onDelete(conversation)}><Trash2 /></button></Tooltip>
                    </li>;
                })}
            </ul> : <div className="creation-history-empty">{keyword.trim() ? "没有找到匹配的对话" : "暂无历史对话"}</div>}
        </div>
    </Drawer>;
}

function CreationViewSwitch({ viewMode, onChange }: { viewMode: CreationViewMode; onChange: (mode: CreationViewMode) => void }) {
    return <div className="creation-view-switch" role="group" aria-label="创作视图">
        <button type="button" aria-pressed={viewMode === "chat"} onClick={() => onChange("chat")}><MessageSquareText />连续对话</button>
        <button type="button" aria-pressed={viewMode === "storyboard"} onClick={() => onChange("storyboard")}><Clapperboard />镜头创作</button>
    </div>;
}

function CreationWorkspaceToolbar({ viewMode, onViewModeChange, onNewConversation, onOpenHistory }: { viewMode: CreationViewMode; onViewModeChange: (mode: CreationViewMode) => void; onNewConversation: () => void; onOpenHistory: () => void }) {
    return <header className="creation-thread-toolbar">
        <CreationViewSwitch viewMode={viewMode} onChange={onViewModeChange} />
        <div className="storyboard-workbench-bar-actions">
            <Tooltip title="新建创作"><button type="button" aria-label="新建创作" className="storyboard-workbench-bar-action" onClick={onNewConversation}><Plus /></button></Tooltip>
            <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" className="storyboard-workbench-bar-action" onClick={onOpenHistory}><History /></button></Tooltip>
        </div>
    </header>;
}

function CreationMessageView({ item, modelName, onRetryFailure, onCreateVariant }: { item: CreationMessage; modelName: string; onRetryFailure: () => void; onCreateVariant: () => void }) {
    if (item.role === "user") return <CreationUserMessage item={item} />;
    const mode = item.mode || "text";
    const stateLabel = item.status === "pending" ? "生成中" : item.status === "cancelled" ? "已停止" : item.status === "error" ? "生成失败" : "";
    const heading = <><span className="creation-message-mark"><Sparkles /></span><strong>{mode === "image" ? "图像生成" : mode === "video" ? "视频生成" : "影策 AI"}</strong>{mode !== "text" ? <span className="creation-message-progress-copy">{item.status === "pending" ? `影策正在生成${mode === "video" ? "视频" : "图像"}……` : item.status === "done" ? `你的${mode === "video" ? "视频" : "图像"}已创建` : null}</span> : null}{modelName ? <span className="creation-message-model">{modelName}</span> : null}{item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}{stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}</>;
    const toolStatus: GenerationToolStatus = item.status === "pending" ? "running" : item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "completed";
    return <article className={`creation-assistant-message is-${mode}`}>
        {mode === "text" ? <><div className="creation-message-heading">{heading}</div>{item.reasoning ? <MessageReasoning reasoning={item.reasoning} isStreaming={item.status === "streaming"} /> : null}<div className="creation-message-content">{item.content ? <AIMessageMarkdown isStreaming={item.status === "streaming"}>{item.content}</AIMessageMarkdown> : <span>正在生成…</span>}</div></> : <GenerationToolCard status={toolStatus} isBulk={(item.resultUrls?.length || Number(item.settings?.count) || 1) > 1} heading={heading}><MediaResult item={item} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} /></GenerationToolCard>}
        {item.error && mode === "text" ? <div className="creation-message-error"><span>{generationErrorMessage(item.error)}</span><button type="button" onClick={onRetryFailure}><RefreshCw />重新生成</button></div> : null}
    </article>;
}

function CreationUserMessage({ item }: { item: CreationMessage }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const copyText = useCopyText();
    const visiblePrompt = displayCreationPrompt(item.content, item.references || []);
    return <article className="creation-user-message">
        <div className="creation-user-message-meta"><span>你</span>{item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}<Tooltip title="复制消息"><button type="button" className="creation-user-message-copy" aria-label="复制提示词" onClick={() => copyText(visiblePrompt, "提示词已复制")}><Copy /></button></Tooltip></div>
        <div className="creation-user-message-copy-wrap"><p>{visiblePrompt}</p></div>
        {item.references?.length ? <CreationMessageReferences references={item.references} /> : null}
        {item.attachments?.length ? <div className="creation-user-message-attachments">{item.attachments.map((attachment) => {
            const kind = creationAttachmentKind(attachment);
            const previewable = kind === "image" || kind === "video";
            const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
            return <button key={attachment.id} type="button" className={!previewable ? "is-file" : undefined} onClick={() => { if (!previewable) return; setPreviewType(kind === "video" ? "video" : "image"); setPreviewUrl(kind === "video" ? attachment.url || "" : url); }} aria-label={previewable ? `预览 ${attachment.name || "附件"}` : attachment.name || "附件"} disabled={previewable && !url}>{kind === "video" ? <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" /> : kind === "image" ? <img src={url} alt={attachment.name || "附件"} width={44} height={44} loading="lazy" /> : kind === "audio" ? <Music2 /> : <FileText />}{previewable ? <span aria-hidden="true"><Maximize2 /></span> : null}</button>;
        })}</div> : null}
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
    </article>;
}

function MediaResult({ item, onRetryFailure, onCreateVariant }: { item: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const assets = useAssetStore((state) => state.assets);
    const resultUrls = item.resultUrls || [];
    const resultAssetIds = resultUrls.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls }) : [];
    const canvasPath = creationCanvasHandoffPath(resultAssetIds) || "/canvas";
    if (item.status === "pending") return <CreationMediaPending mode={item.mode || "image"} ratio={item.settings?.ratio} />;
    if ((item.status === "error" || item.status === "cancelled") && !resultUrls.length) return <div className="creation-media-error"><span>{item.status === "cancelled" ? item.content || "已停止" : generationErrorMessage(item.error || "生成失败")}</span><button type="button" onClick={onRetryFailure}><RefreshCw />重新生成</button></div>;
    if (!resultUrls.length) return <div className="creation-media-empty">没有返回可预览结果 <button type="button" onClick={onRetryFailure}>重试</button></div>;
    const isVideo = item.mode === "video";
    return <div className="creation-media-result">
        {isVideo ? <button type="button" className="creation-video-result" onClick={() => { setPreviewType("video"); setPreviewUrl(resultUrls[0]); }} aria-label="预览生成视频"><video muted preload="metadata" src={resultUrls[0]} /><span><Maximize2 />预览视频</span></button> : <div className="creation-image-result-grid">{resultUrls.map((url) => <button key={url} type="button" className="creation-image-result" onClick={() => { setPreviewType("image"); setPreviewUrl(url); }} aria-label="预览生成图片"><img src={url} alt="生成结果" /><span><Maximize2 /></span></button>)}</div>}
        <div className="creation-media-actions"><span>{isVideo ? "视频结果" : `${resultUrls.length} 张图片`}</span><button type="button" onClick={onCreateVariant}><RefreshCw />生成同款</button><Link to={canvasPath}>{resultAssetIds.length ? "添加到画布" : "打开画布"}</Link>{resultUrls.map((url, index) => <a key={`${url}-download`} href={url} download>{resultUrls.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}</div>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
    </div>;
}

function CreationMediaPending({ mode, ratio }: { mode: CreationMode; ratio?: string }) {
    return <div className={`creation-media-pending is-${mode}`} style={{ aspectRatio: creationMediaAspectRatio(ratio, mode) }} aria-live="polite"><span className="creation-media-pending-icon"><Sparkles /></span><span className="sr-only">影策正在生成{mode === "video" ? "视频" : "图像"}</span></div>;
}

function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return <div className="creation-user-message-references" aria-label="本次引用">{references.map((reference) => {
        const Icon = reference.kind === "skill" ? Sparkles : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
        return <span key={reference.id} className="creation-user-message-reference">{reference.previewUrl && reference.kind === "video" ? <video src={reference.previewUrl} muted playsInline preload="metadata" aria-label={reference.label} /> : reference.previewUrl && reference.kind === "image" ? <img src={reference.previewUrl} alt="" /> : <Icon />}<span>{reference.label}</span></span>;
    })}</div>;
}

function CreationMediaPreviewModal({ url, type, onClose }: { url: string; type: "image" | "video"; onClose: () => void }) {
    return <Modal open={Boolean(url)} title={null} footer={null} centered destroyOnHidden width={type === "video" ? "min(1160px, calc(100vw - 32px))" : "min(980px, calc(100vw - 32px))"} onCancel={onClose} className="creation-media-preview-modal" styles={{ body: { padding: 0 } }}>{url ? type === "video" ? <video controls autoPlay className="creation-media-preview-video" src={url} /> : <img className="creation-media-preview-image" src={url} alt="媒体预览" /> : null}</Modal>;
}

function CreationAttachmentThumbnail({ item, onPreview, onRemove }: {
    item: CreationAttachment;
    onPreview: (type: "image" | "video", url: string) => void;
    onRemove: (id: string) => void;
}) {
    const kind = creationAttachmentKind(item);
    const previewable = kind === "image" || kind === "video";
    const url = (kind === "video" ? item.url : item.previewUrl) || "";
    const content = kind === "video" ? <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} /> : kind === "image" ? <img src={item.previewUrl} alt={item.name} /> : <span className="creation-chat-file-icon">{kind === "audio" ? <Music2 /> : <FileText />}<em>{item.name}</em></span>;
    return <div className="creation-reference-card-content">
        {previewable ? <button type="button" className="creation-reference-card-preview" onClick={() => onPreview(kind === "video" ? "video" : "image", url)} aria-label={`放大预览 ${item.name}`} disabled={!url}>{content}<span aria-hidden="true"><Maximize2 /></span></button> : <div className="creation-reference-card-preview is-file" aria-label={item.name}>{content}</div>}
        <button type="button" className="creation-reference-card-remove" onPointerDownCapture={(event) => event.stopPropagation()} onMouseDownCapture={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(item.id); }} aria-label={`移除 ${item.name}`}><X /></button>
    </div>;
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    referenceReplacementBusy: boolean;
    attachments: CreationAttachment[];
    referenceImageSize?: { width: number; height: number };
    maxReferences: number;
    references: CreationReference[];
    onRemoveAttachment: (id: string) => void;
    onClearAttachments: () => void;
    onReorderAttachments: (attachments: CreationAttachment[]) => void;
    onReplaceAttachment: (targetAttachmentId: string, replacement: CreationAttachment) => void;
    onReplaceReferenceFiles: (targetAttachmentId: string, files: File[]) => void;
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
    promptOptimizerProvider: PromptOptimizerProvider | null;
    composerFocusRef: RefObject<HTMLTextAreaElement | null>;
    placeholderOverride?: string;
    onSubmit: () => void;
};

type CreationReferenceFilter = "all" | "image" | "video" | "audio" | "file";

function CreationComposer(props: ComposerProps) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [referenceFilter, setReferenceFilter] = useState<CreationReferenceFilter>("all");
    const [canDragReferences, setCanDragReferences] = useState(false);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    const attachmentTrackRef = useRef<HTMLUListElement>(null);
    const cardDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
    const suppressAttachmentClickRef = useRef(false);
    const [trackState, setTrackState] = useState({ canScrollLeft: false, canScrollRight: false, isExpanded: false, isDragging: false });
    const interactionBusy = props.busy || props.referenceReplacementBusy;
    const canSubmit = Boolean(props.prompt.trim()) && !interactionBusy;
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const priceChannel = resolveModelChannel(props.config, props.model);
    const canOptimizePrompt = Boolean(props.promptOptimizerProvider) && (props.mode === "image" || props.mode === "video");
    const optimizerReferences = props.references.filter((reference) => reference.active && reference.kind !== "skill");
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(props.model),
        count: props.mode === "image" ? props.count : 1,
        seconds: props.mode === "video" ? props.seconds : 1,
    });
    const showCost = creditsEnabled && credits !== null;
    const formattedCredits = credits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const actionLabel = props.referenceReplacementBusy ? "正在替换参考图" : props.busy ? "生成中" : showCost ? `预计消耗 ${formattedCredits} 积分，发送` : "发送";
    const placeholder = props.mode === "text"
        ? "描述你的故事、角色或想继续讨论的创意"
        : props.mode === "image"
            ? "描述画面、人物、场景、构图与风格"
            : "描述镜头内容、运动、光线与节奏";
    const emptyPlaceholder = "输入你的镜头、画面或故事。也可以添加参考图开始创作";
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "image" ? imageReferencesSupported : props.mode !== "video" || props.videoProfile.operations.includes("image_to_video");
    const canAddMoreReferences = referencesSupported && props.attachments.length < props.maxReferences;
    const addReferenceLabel = interactionBusy ? (props.referenceReplacementBusy ? "正在替换参考图" : "生成中暂不能添加参考内容") : canAddMoreReferences ? "添加更多参考内容" : `已达到当前模型的参考内容上限（${props.maxReferences} 个）`;
    const referenceCounts = useMemo(() => props.attachments.reduce((counts, attachment) => {
        const kind = creationAttachmentKind(attachment);
        counts[kind] += 1;
        return counts;
    }, { image: 0, video: 0, audio: 0, file: 0 }), [props.attachments]);
    const visibleAttachments = useMemo(() => referenceFilter === "all"
        ? props.attachments
        : props.attachments.filter((attachment) => creationAttachmentKind(attachment) === referenceFilter), [props.attachments, referenceFilter]);
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || props.imageProfile.maxOutputs > 1;
    const updateTrackScrollState = useCallback(() => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        setTrackState((current) => ({
            ...current,
            canScrollLeft: track.scrollLeft > 1,
            canScrollRight: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
        }));
    }, []);
    const setReferencePanelExpanded = useCallback((isExpanded: boolean) => {
        setTrackState((current) => ({ ...current, isExpanded }));
        if (!isExpanded) setReferenceFilter("all");
    }, []);
    useEffect(() => {
        if (!props.attachments.length) setReferencePanelExpanded(false);
        updateTrackScrollState();
    }, [props.attachments.length, setReferencePanelExpanded, updateTrackScrollState]);
    useEffect(() => {
        const query = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setCanDragReferences(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        const frame = window.requestAnimationFrame(updateTrackScrollState);
        return () => window.cancelAnimationFrame(frame);
    }, [referenceFilter, trackState.isExpanded, updateTrackScrollState, visibleAttachments.length]);
    const beginCardDrag = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || interactionBusy || !trackState.isExpanded) return;
        if ((event.target as HTMLElement).closest(".creation-reference-card-remove")) return;
        cardDragRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    };
    const endCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag) return;
        cardDragRef.current = null;
        if (drag.moved) {
            suppressAttachmentClickRef.current = true;
            window.setTimeout(() => { suppressAttachmentClickRef.current = false; }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setTrackState((current) => ({ ...current, isDragging: false }));
    };
    const moveCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag || drag.moved) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
        drag.moved = true;
        setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true }));
    };
    const previewAttachment = (type: "image" | "video", url: string) => {
        if (suppressAttachmentClickRef.current || cardDragRef.current?.moved) return;
        setPreviewType(type);
        setPreviewUrl(url);
    };
    const reorderVisibleAttachments = useCallback((next: CreationAttachment[]) => {
        if (referenceFilter === "all") {
            props.onReorderAttachments(next);
            return;
        }
        const visibleIds = new Set(visibleAttachments.map((attachment) => attachment.id));
        const reordered = [...next];
        props.onReorderAttachments(props.attachments.map((attachment) => visibleIds.has(attachment.id) ? reordered.shift() || attachment : attachment));
    }, [props.attachments, props.onReorderAttachments, referenceFilter, visibleAttachments]);
    useEffect(() => {
        if (!canOptimizePrompt) setPromptOptimizerOpen(false);
    }, [canOptimizePrompt]);

    const scrollAttachmentTrack = (direction: -1 | 1) => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.72, 120), behavior: "smooth" });
        window.setTimeout(updateTrackScrollState, 180);
    };
    const imageReferenceAtPoint = (x: number, y: number) => {
        for (const element of document.elementsFromPoint(x, y)) {
            const chip = element.closest<HTMLElement>("[data-mention-reference-id]");
            const referenceId = chip?.dataset.mentionReferenceId;
            const reference = referenceId ? props.references.find((item) => item.id === referenceId) : undefined;
            if (reference?.kind === "image" && reference.attachmentId) return reference;
        }
        return undefined;
    };
    const composer = <section className={`creation-chat-composer is-${props.variant}`}>
        <div className="creation-chat-writing-surface">
            <input ref={props.fileInputRef} type="file" hidden accept={creationUploadAccept(props.mode)} multiple onChange={props.onFileChange} />
            <div className="creation-chat-editor">
                <CanvasResourceMentionTextarea ref={props.composerFocusRef} value={props.prompt} references={props.references} mentionMenuWidth={400} sendOnEnter={false} onChange={props.setPrompt} onSubmit={props.onSubmit} containerClassName="creation-chat-mention-container" className="creation-chat-mention-editor creation-scrollbar" style={{ color: "var(--creation-text)" }} placeholder={props.placeholderOverride || (props.variant === "empty" ? emptyPlaceholder : placeholder)} aria-label="创作提示词，可使用 @ 引用当前参考内容或技能" spellCheck disabled={interactionBusy} activeDropReferenceId={dropTargetReferenceId} onReferenceFilesDrop={(reference, files) => { const target = props.references.find((item) => item.id === reference.id); if (target?.attachmentId) props.onReplaceReferenceFiles(target.attachmentId, files); }} />
                {props.attachments.length || referencesSupported ? <div className={`creation-reference-panel${trackState.isExpanded ? " is-expanded" : ""}`} aria-busy={interactionBusy}>
                    {trackState.isExpanded ? <div className="creation-reference-panel-header">
                        <div className="creation-reference-filter-tabs" role="group" aria-label="筛选参考内容">
                            {([
                                { id: "all", label: "全部", count: props.attachments.length },
                                { id: "image", label: "图片", count: referenceCounts.image },
                                { id: "video", label: "视频", count: referenceCounts.video },
                                { id: "audio", label: "音频", count: referenceCounts.audio },
                                { id: "file", label: "文件", count: referenceCounts.file },
                            ] as const).map((filter) => <button key={filter.id} type="button" aria-pressed={referenceFilter === filter.id} className={referenceFilter === filter.id ? "is-active" : undefined} onClick={() => setReferenceFilter(filter.id)}>{filter.label}{filter.count ? ` (${filter.count})` : ""}</button>)}
                        </div>
                        <div className="creation-reference-panel-actions">
                            {props.attachments.length ? <button type="button" onClick={props.onClearAttachments} disabled={interactionBusy}>清空全部素材</button> : null}
                            <Tooltip title="收起素材面板"><button type="button" className="creation-reference-panel-collapse" onClick={() => setReferencePanelExpanded(false)} aria-label="收起素材面板"><Minimize2 aria-hidden="true" /></button></Tooltip>
                        </div>
                    </div> : null}
                    <div className="creation-reference-track-wrapper">
                        <div className="creation-reference-stack-shell">
                            {trackState.canScrollLeft ? <button type="button" className="creation-reference-track-button is-left" onClick={() => scrollAttachmentTrack(-1)} aria-label="向左浏览参考内容" title="向左浏览参考内容"><ChevronLeft aria-hidden="true" /></button> : null}
                            <Reorder.Group<CreationAttachment[]>
                                as="ul"
                                ref={attachmentTrackRef}
                                className={`creation-reference-track${trackState.isExpanded ? " is-expanded" : ""}${trackState.isDragging ? " is-dragging" : ""}${visibleAttachments.length ? "" : " is-empty"}`}
                                axis="x"
                                values={visibleAttachments}
                                onReorder={reorderVisibleAttachments}
                                layoutScroll
                                role="list"
                                aria-label="参考内容轨道"
                                onScroll={updateTrackScrollState}
                            >
                                {visibleAttachments.map((item) => <Reorder.Item<CreationAttachment>
                                    key={item.id}
                                    value={item}
                                    layout="position"
                                    drag={trackState.isExpanded && canDragReferences && !interactionBusy}
                                    className="creation-reference-stack-card"
                                    onPointerDown={beginCardDrag}
                                    onPointerMove={moveCardDrag}
                                    onPointerUp={endCardDrag}
                                    onPointerCancel={endCardDrag}
                                    onDragStart={() => { setDropTargetReferenceId(null); setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true })); }}
                                    onDrag={(_, info) => {
                                        if (creationAttachmentKind(item) !== "image") return;
                                        const target = imageReferenceAtPoint(info.point.x, info.point.y);
                                        setDropTargetReferenceId(target?.attachmentId !== item.id ? target?.id || null : null);
                                    }}
                                    onDragEnd={(_, info) => {
                                        const target = creationAttachmentKind(item) === "image" ? imageReferenceAtPoint(info.point.x, info.point.y) : undefined;
                                        setDropTargetReferenceId(null);
                                        setTrackState((current) => ({ ...current, isDragging: false, isExpanded: true }));
                                        if (target?.attachmentId && target.attachmentId !== item.id) props.onReplaceAttachment(target.attachmentId, item);
                                    }}
                                >
                                    <CreationAttachmentThumbnail item={item} onPreview={previewAttachment} onRemove={props.onRemoveAttachment} />
                                </Reorder.Item>)}
                                {!visibleAttachments.length && props.attachments.length ? <li className="creation-reference-filter-empty">该类型暂无参考内容</li> : null}
                                {referencesSupported ? <li className="creation-reference-add-slot"><Tooltip title={addReferenceLabel}><button type="button" className="creation-reference-add-button" onClick={props.onOpenLibrary} disabled={interactionBusy || !canAddMoreReferences} aria-label={addReferenceLabel}><Plus aria-hidden="true" /><span>参考内容</span></button></Tooltip></li> : null}
                            </Reorder.Group>
                            {trackState.canScrollRight ? <button type="button" className="creation-reference-track-button is-right" onClick={() => scrollAttachmentTrack(1)} aria-label="向右浏览参考内容" title="向右浏览参考内容"><ChevronRight aria-hidden="true" /></button> : null}
                            {!trackState.isExpanded && props.attachments.length ? <Tooltip title="查看全部"><button type="button" className="creation-reference-panel-expand" onClick={() => setReferencePanelExpanded(true)} aria-label={`查看全部 ${props.attachments.length} 个参考内容`} aria-expanded="false"><Maximize2 aria-hidden="true" /></button></Tooltip> : null}
                        </div>
                    </div>
                </div> : null}
            </div>
        </div>
        <footer className="creation-chat-dock">
            <div className="creation-chat-controls">
                <VoiceRecordingButton
                    disabled={interactionBusy}
                    onTranscribed={(text) => props.setPrompt(props.prompt.trim() ? `${props.prompt} ${text}` : text)}
                />
                <ModePicker mode={props.mode} onModeChange={props.onModeChange} />
                {canOptimizePrompt ? <Tooltip title="用 AI 优化提示词">
                    <button
                        type="button"
                        className="creation-chat-control"
                        onClick={() => setPromptOptimizerOpen(true)}
                        aria-label="优化提示词"
                        aria-expanded={promptOptimizerOpen}
                        aria-haspopup="dialog"
                    >
                        <WandSparkles />
                        <span>优化</span>
                    </button>
                </Tooltip> : null}
                <Tooltip title="从本机上传附件"><button type="button" className="creation-chat-control" onClick={() => props.fileInputRef.current?.click()} disabled={interactionBusy || !referencesSupported} aria-label="从本机上传附件"><Paperclip /><span>附件</span></button></Tooltip>
                <Tooltip title={!referencesSupported ? "当前模型不支持参考媒体" : "从素材库选择参考内容"}><button type="button" className="creation-chat-control" onClick={props.onOpenLibrary} disabled={interactionBusy || !referencesSupported} aria-label="打开素材库选择参考内容"><FolderOpen /><span>素材库</span></button></Tooltip>
				<ModelPicker config={props.config} value={props.model} onChange={props.onModelChange} capability={props.mode} requirements={props.modelRequirements} className="creation-model-picker" placeholder={`选择${modeLabels[props.mode]}模型`} showSelectedPrice variant="creation" />
                {props.mode === "video" || (props.mode === "image" && imageSettingsSupported) ? <GenerationSettingsMenu {...props} /> : null}
                {props.mode === "video" ? <DurationMenu profile={props.videoProfile} seconds={props.seconds} onChange={props.setSeconds} /> : null}
            </div>
            <Button
                type="text"
                className={`canvas-node-composer-submit ${showCost ? "has-cost" : ""}`}
                disabled={interactionBusy || !canSubmit}
                style={{
                    color: !interactionBusy && !canSubmit ? "var(--creation-faint)" : "var(--creation-text)",
                    "--canvas-composer-submit-action": !interactionBusy && !canSubmit ? "var(--creation-surface-hover)" : "var(--creation-text)",
                    "--canvas-composer-submit-action-fg": !interactionBusy && !canSubmit ? "var(--creation-faint)" : "var(--creation-bg)",
                } as CSSProperties}
                onClick={interactionBusy ? undefined : props.onSubmit}
                aria-label={actionLabel}
                title={actionLabel}
            >
                {showCost ? <span className="canvas-node-composer-submit-cost"><CreditSymbol /><span>{formattedCredits}</span></span> : null}
                <span className="canvas-node-composer-submit-action" aria-hidden>{interactionBusy ? <LoaderCircle className="size-3 animate-spin" /> : <ArrowUp className="size-3" />}</span>
            </Button>
        </footer>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
    </section>;

    return (
        <CanvasPromptOptimizerDrawer
            open={promptOptimizerOpen}
            prompt={props.prompt}
            generationMode={props.mode === "video" ? "video" : "image"}
            targetModel={modelOptionName(props.model) || props.model}
            targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(props.model))?.protocol || priceChannel.interfaceType}
            config={props.config}
            optimizerModel={props.config.textModel}
            references={optimizerReferences}
            provider={props.promptOptimizerProvider}
            onClose={() => setPromptOptimizerOpen(false)}
            onApply={props.setPrompt}
        >
            {composer}
        </CanvasPromptOptimizerDrawer>
    );
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
    // 尺寸/比例/分辨率选项取同显示名分组内全部模型的并集，路由模型只决定发送参数。
    const mergedProfile = mergedImageCapabilityConfig(props.config, props.model || props.config.imageModel);
    const usesImageResolutionPicker = props.mode === "image" && supportsImageResolutionPresets(mergedProfile.size);
    const imageResolutionOptions = usesImageResolutionPicker ? buildImageResolutionOptions(mergedProfile.size.values) : [];
    const activeImageResolution = usesImageResolutionPicker ? imageResolutionOption(imageResolutionOptions, props.ratio) : undefined;
    const activeImageRatio = activeImageResolution?.ratio || imageRatioForSize(props.ratio) || (props.ratio.includes(":") ? props.ratio : "1:1");
    const activeImageResolutionChoice: ImageResolutionChoice = activeImageResolution?.tier || "auto";
    const imageResolutionChoiceOptions = usesImageResolutionPicker ? imageResolutionChoices(mergedProfile.size.values) : [];
    const imageRatios = usesImageResolutionPicker
        ? Array.from(new Set(imageResolutionOptions.filter((item) => !activeImageResolution || item.tier === activeImageResolution.tier).map((item) => item.ratio)))
        : mergedProfile.size.values.length ? mergedProfile.size.values : ratioOptions.map((item) => item.value);
    const ratios = props.mode === "video" ? props.videoProfile.ratios : imageRatios;
    const referenceImageSize = props.mode === "image" && mergedProfile.size.allowCustom ? props.referenceImageSize : undefined;
    const referenceImageSizeValue = referenceImageSize ? String(referenceImageSize.width) + "x" + String(referenceImageSize.height) : "";
    const referenceImageSizeLabel = referenceImageSize ? String(referenceImageSize.width) + " × " + String(referenceImageSize.height) : "";
    const referenceImageSizeRatio = referenceImageSize ? String(referenceImageSize.width) + ":" + String(referenceImageSize.height) : "";
    const referenceImageSizeSelected = Boolean(referenceImageSizeValue && props.ratio === referenceImageSizeValue);
    const resolutions = props.mode === "video" ? props.videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: videoResolutionLabel(value) })) : resolutionOptions;
    const selectImageRatio = (nextRatio: string) => {
        if (!usesImageResolutionPicker || activeImageResolutionChoice === "auto") {
            props.setRatio(nextRatio);
            return;
        }
        props.setRatio(imageSizeForResolution(imageResolutionOptions, activeImageResolutionChoice, nextRatio) || nextRatio);
    };
    const selectImageResolution = (choice: ImageResolutionChoice) => {
        if (choice === "auto") {
            props.setRatio(mergedProfile.size.values.includes("auto") ? "auto" : activeImageRatio);
            return;
        }
        const nextSize = imageSizeForResolution(imageResolutionOptions, choice, activeImageRatio) || imageResolutionOptions.find((item) => item.tier === choice)?.size;
        if (nextSize) props.setRatio(nextSize);
    };
    const selectReferenceImageSize = () => {
        if (!referenceImageSizeValue) return;
        props.setRatio(referenceImageSizeValue);
        setCustomRatioOpen(false);
    };
    const videoResolutionSupported = props.mode === "video" && resolutions.length > 0;
    const imageSummary = [
        ...(mergedProfile.size.parameter !== "none" ? [referenceImageSizeSelected ? referenceImageSizeLabel : usesImageResolutionPicker ? formatImageResolutionSize(props.ratio, imageResolutionOptions) : props.ratio] : []),
        ...(props.imageProfile.quality.supported ? [qualityLabel] : []),
        ...(props.imageProfile.maxOutputs > 1 ? [props.count] : []),
    ].join(" · ");
    const videoRatioSupported = props.mode === "video" && ratios.length > 0;
    const summary = props.mode === "video" ? [...(videoRatioSupported ? [props.ratio] : []), ...(videoResolutionSupported ? [videoResolutionLabel(props.videoQuality)] : [])].join(" · ") : imageSummary;
    const panel = <div className="creation-parameter-menu">
        {videoRatioSupported || props.mode !== "video" && mergedProfile.size.parameter !== "none" ? <SettingSection title="画幅" value={referenceImageSizeSelected ? referenceImageSizeLabel : props.mode === "image" && usesImageResolutionPicker ? activeImageRatio : props.ratio}><div className="creation-parameter-content"><div className="creation-choice-grid is-ratio">{referenceImageSizeValue ? <button type="button" aria-pressed={referenceImageSizeSelected} aria-label={"使用参考图尺寸 " + referenceImageSizeLabel} title={"使用参考图尺寸 " + referenceImageSizeLabel} className={"creation-reference-size-choice" + (referenceImageSizeSelected ? " is-selected" : "")} onClick={selectReferenceImageSize}><span className="creation-ratio-preview"><span style={ratioPreviewStyle(referenceImageSizeRatio)} /></span><span>参考图</span></button> : null}{ratios.map((value) => { const selected = props.mode === "image" && usesImageResolutionPicker ? value === activeImageRatio : value === props.ratio; return <button key={value} type="button" aria-pressed={selected} className={selected ? "is-selected" : ""} onClick={() => { if (props.mode === "image") selectImageRatio(value); else props.setRatio(value); setCustomRatioOpen(false); }}><span className="creation-ratio-preview"><span style={ratioPreviewStyle(value)} /></span><span>{value}</span></button>; })}</div>{props.mode !== "video" && mergedProfile.size.allowCustom && (customRatioOpen ? <label className="creation-custom-value"><span>宽 x 高</span><input value={props.ratio} onFocus={(event) => event.currentTarget.select()} onChange={(event) => props.setRatio(event.target.value)} placeholder="1920x1080 或 2:1" aria-label="自定义图片尺寸或比例" /></label> : <button type="button" className="creation-custom-trigger" onClick={() => setCustomRatioOpen(true)}><Plus />输入自定义尺寸</button>)}</div></SettingSection> : null}
        {props.mode === "video" ? (videoResolutionSupported ? <SettingSection title="清晰度" value={videoResolutionLabel(props.videoQuality)}><div className="creation-choice-grid is-resolution">{resolutions.map((option) => <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>{option.label}</button>)}</div></SettingSection> : null) : <>
            {imageResolutionChoiceOptions.length ? <SettingSection title="分辨率" value={activeImageResolutionChoice === "auto" ? "自动" : activeImageResolutionChoice.toUpperCase()}><div className="creation-choice-grid is-resolution">{imageResolutionChoiceOptions.map((choice) => <button key={choice} type="button" aria-pressed={choice === activeImageResolutionChoice} className={choice === activeImageResolutionChoice ? "is-selected" : ""} onClick={() => selectImageResolution(choice)}>{choice === "auto" ? "自动" : choice.toUpperCase()}</button>)}</div></SettingSection> : null}
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
                <span className={`library-icon-tile suggest-icon is-${item.mode}`}><Icon size={15} strokeWidth={2} /></span>
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
    if (mode === "video") return `已按 ${[`${settings.seconds}s`, ...(settings.videoQuality ? [videoResolutionLabel(settings.videoQuality)] : []), settings.ratio].join(" · ")} 渲染这一镜，等待你的下一句指令。`;
    if (mode === "image") return `已按 ${settings.ratio} 出图 ${settings.count} 张，等待你的下一句指令。`;
    return "";
}

function StoryboardToolbar({ shots, activeIndex, composing, onSelect, onBeginCompose, onCancelCompose, onNewConversation, onOpenHistory, viewMode, onViewModeChange }: { shots: CreationShot[]; activeIndex: number; composing: boolean; onSelect: (index: number) => void; onBeginCompose: () => void; onCancelCompose: () => void; onNewConversation: () => void; onOpenHistory: () => void; viewMode: CreationViewMode; onViewModeChange: (mode: CreationViewMode) => void }) {
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
            <CreationViewSwitch viewMode={viewMode} onChange={onViewModeChange} />
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
    const copyText = useCopyText();
    const assets = useAssetStore((state) => state.assets);
    const visiblePrompt = user ? displayCreationPrompt(user.content, user.references || []) : "";
    const resultUrls = result?.resultUrls || [];
    const resultAssetIds = result && resultUrls.length ? creationResultAssetIds(assets, { messageId: result.id, taskIds: result.taskIds || [], resultUrls }) : [];
    const canvasHandoffPath = result ? creationCanvasHandoffPath(resultAssetIds, resultUrls.length) : "";
    const canvasPath = canvasHandoffPath || "/canvas";
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
                {status === "done" && resultUrls.length ? <Link to={canvasPath}>{canvasHandoffPath ? "添加到画布" : "打开画布"}</Link> : null}
                {resultUrls.map((url, index) => <a key={`${url}-download`} href={url} download>{resultUrls.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}
            </div>
        </header>
        <div className="storyboard-workbench-card-body">
            <div className="storyboard-workbench-thread" aria-label={`镜头 ${shotNumber} 的对话过程`}>
                {briefVisible && user ? <div className="storyboard-workbench-turn is-user">
                    <div className="storyboard-workbench-turn-copy">
                        <div className="storyboard-workbench-turn-meta"><span className="storyboard-workbench-turn-role">{shotScriptLabels[mode]}</span>{user.createdAt ? <time className="storyboard-workbench-turn-time" dateTime={user.createdAt}>{formatMessageTime(user.createdAt)}</time> : null}<Tooltip title="复制消息"><button type="button" className="creation-user-message-copy" aria-label="复制提示词" onClick={() => copyText(visiblePrompt, "提示词已复制")}><Copy /></button></Tooltip></div>
                        <div className="storyboard-workbench-turn-bubble">
                            <p className="storyboard-workbench-turn-text">{visiblePrompt}</p>
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
                            <StoryboardShotResult result={result} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} canvasPath={canvasPath} canvasHandoffAvailable={Boolean(canvasHandoffPath)} />
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
        const kind = creationAttachmentKind(attachment);
        const previewable = kind === "image" || kind === "video";
        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
        return <button key={attachment.id} type="button" className={!previewable ? "is-file" : undefined} onClick={() => { if (!previewable) return; setPreviewType(kind === "video" ? "video" : "image"); setPreviewUrl(kind === "video" ? attachment.url || "" : url); }} aria-label={previewable ? `预览 ${attachment.name || "附件"}` : attachment.name || "附件"} disabled={previewable && !url}>{kind === "video" ? <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" /> : kind === "image" ? <img src={url} alt={attachment.name || "附件"} width={44} height={44} loading="lazy" /> : kind === "audio" ? <Music2 /> : <FileText />}{previewable ? <span aria-hidden="true"><Maximize2 /></span> : null}</button>;
    })}</div><CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} /></>;
}

function StoryboardShotResult({ result, onRetryFailure, onCreateVariant, canvasPath, canvasHandoffAvailable }: { result?: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void; canvasPath: string; canvasHandoffAvailable: boolean }) {
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
    if (status === "cancelled") return <div className="storyboard-workbench-error"><span>{result.content || "已停止"}</span><button type="button" onClick={onRetryFailure}><RefreshCw />重新生成</button></div>;
    if (mode === "text") return <div className="creation-message-content storyboard-workbench-text">{result.content ? <AIMessageMarkdown isStreaming={status === "streaming"}>{result.content}</AIMessageMarkdown> : <span>正在生成…</span>}</div>;
    if (!resultUrls.length) return <div className="storyboard-workbench-empty"><Film />没有返回可预览结果 <button type="button" onClick={onRetryFailure}>重试</button></div>;
    const note = result.settings ? directorNoteFor(mode, result.settings) : "";
    return <>
        {mode === "video" ? <button type="button" className="creation-video-result" onClick={() => openPreview(resultUrls[0], "video")} aria-label="预览生成视频"><video muted preload="metadata" className="size-full object-cover" src={resultUrls[0]} /><span><Maximize2 />预览视频</span></button> : <div className="creation-image-result-grid">{resultUrls.map((url) => <button key={url} type="button" className="creation-image-result" onClick={() => openPreview(url, "image")} aria-label="预览生成图片"><img src={url} alt="生成结果" /><span><Maximize2 /></span></button>)}</div>}
        {note ? <p className="storyboard-workbench-director-note"><span>导演手记</span>{note}</p> : null}
        <div className="storyboard-workbench-media-meta"><span>{mode === "video" ? "视频结果" : `${resultUrls.length} 张图片`}</span><button type="button" onClick={onCreateVariant}><RefreshCw />生成变体</button><Link to={canvasPath}>{canvasHandoffAvailable ? "添加到画布" : "打开画布"}</Link>{resultUrls.map((url, index) => <a key={`${url}-download`} href={url} download>{resultUrls.length > 1 ? `下载 ${index + 1}` : <><Download />下载</>}</a>)}</div>
        <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
    </>;
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

async function buildTextMessageContent(item: CreationMessage) {
    const content = expandCreationPrompt(item.content, item.references || [], item.attachments || []);
    const attachments = item.attachments || [];
    if (!attachments.length) return content;
    const parts: AiTextContentPart[] = [{ type: "text", text: content }];
    for (const attachment of attachments) {
        if (isImageAttachment(attachment)) {
            parts.push({ type: "image_url", image_url: { url: attachment.dataUrl || attachment.url || "" } });
            continue;
        }
        const url = await creationAttachmentDataUrl(attachment);
        parts.push({ type: "file_url", file_url: { url, name: attachment.name || "附件", mimeType: attachment.type || "application/octet-stream" } });
    }
    return parts;
}

async function creationAttachmentDataUrl(attachment: CreationAttachment) {
    if ((attachment.bytes || 0) > TEXT_ATTACHMENT_MAX_BYTES) throw new Error(`${attachment.name} 超过 20MB，当前文本模型附件需要压缩后再上传`);
    const attachmentUrl = attachment.url || "";
    if (attachmentUrl.startsWith("data:")) return attachmentUrl;
    const blob = attachment.storageKey ? await getMediaBlob(attachment.storageKey) : null;
    if (blob) {
        if (blob.size > TEXT_ATTACHMENT_MAX_BYTES) throw new Error(`${attachment.name} 超过 20MB，当前文本模型附件需要压缩后再上传`);
        return blobToDataUrl(blob);
    }
    if (/^https:\/\//i.test(attachmentUrl)) return attachmentUrl;
    throw new Error(`${attachment.name} 无法读取，请重新上传后再试`);
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("附件读取失败"));
        reader.readAsDataURL(blob);
    });
}

function isVideoAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { url: string } {
    return creationAttachmentKind(attachment) === "video";
}

function isImageAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { dataUrl: string; width?: number; height?: number } {
    return creationAttachmentKind(attachment) === "image";
}

type PersistedCreationTask = GenerationTask & { creationResultUrls?: string[]; creationError?: string };

function attachCreationTaskContexts(tasks: GenerationTask[], conversations: CreationConversation[]) {
    const contexts = new Map<string, { prompt: string; clientContext: NonNullable<GenerationTask["clientContext"]> }>();
    for (const conversation of conversations) {
        for (const [messageIndex, message] of conversation.messages.entries()) {
            if (message.role !== "assistant" || !message.taskIds?.length) continue;
            const prompt = conversation.messages[messageIndex - 1]?.role === "user" ? conversation.messages[messageIndex - 1].content : "";
            for (const [batchIndex, taskId] of message.taskIds.entries()) contexts.set(taskId, { prompt, clientContext: { conversationId: conversation.id, messageId: message.id, batchIndex, batchCount: message.taskIds.length } });
        }
    }
    return tasks.map((task) => {
        const context = contexts.get(task.id);
        return context ? { ...task, prompt: context.prompt, clientContext: context.clientContext } : task;
    });
}

async function materializeCreationTaskResults(tasks: GenerationTask[], signal?: AbortSignal): Promise<PersistedCreationTask[]> {
    return Promise.all(tasks.map(async (task): Promise<PersistedCreationTask> => {
        // 文本正文保存在 resultJson，不进入媒体资源化链路。
        if (task.status !== "succeeded" || !task.clientContext || task.type === "canvas_text") return task;
        try {
            const materialized = await runGenerationConsumer(signal, (managedSignal) => materializeGenerationTaskAssets(task, managedSignal));
            const creationResultUrls = generationTaskMaterializedUrls(materialized);
            return creationResultUrls.length ? { ...materialized, creationResultUrls } : materialized;
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
            const taskIds = new Set(message.taskIds || []);
            const matches = tasks
                .filter((task) => taskIds.has(task.id) || (task.clientContext?.conversationId === conversation.id && task.clientContext.messageId === message.id))
                .sort((left, right) => (left.clientContext?.batchIndex || 0) - (right.clientContext?.batchIndex || 0));
            if (message.role === "assistant" && message.mode === "text") {
                const recovery = recoverCreationTextTask(message, matches);
                if (!recovery) return message;
                completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
                conversationChanged = true;
                changed = true;
                return { ...message, ...recovery };
            }
            if (message.role !== "assistant" || message.status !== "pending") return message;
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
            if (matches.every((task) => task.status === "cancelled")) {
                const localOnly = matches.find(isLocalDreaminaWaitStopped);
                return { ...message, status: "cancelled" as const, content: localOnly ? localDreaminaCancellationMessage(localOnly) : "已停止", error: undefined, taskIds: nextTaskIds };
            }
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
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 10, height: 10 };
    // 画幅容器的可用空间是 14×10；同时计算宽高，避免 CSS 的 max-width/max-height 把宽银幕比例压扁。
    const scale = Math.min(14 / width, 10 / height);
    return { width: Math.max(4, Math.round(width * scale)), height: Math.max(4, Math.round(height * scale)) };
}
