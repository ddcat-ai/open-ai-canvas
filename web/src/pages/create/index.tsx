import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, type RefObject } from "react";
import { App, Button, Drawer, Modal, Popover, Spin, Tooltip } from "antd";
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronDown,
    Clapperboard,
    Clock3,
    Copy,
    Download,
    FileText,
    Film,
    FolderOpen,
    History,
    Image as ImageIcon,
    LoaderCircle,
    Maximize2,
    MessageSquareText,
    Music2,
    Paperclip,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import { Link } from "react-router";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { creationCanvasHandoffPath, creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { createGenerationBatchRetryContexts, createGenerationRetryContext, runGenerationOperationOnce, type GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { createClientId } from "@/lib/client-id";
import { formatLocale } from "@/lib/format-locale";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { buildImageResolutionOptions, formatImageResolutionSize, imageRatioForSize, imageResolutionChoices, imageResolutionOption, imageSizeForResolution, supportsImageResolutionPresets, type ImageResolutionChoice } from "@/lib/image-resolution-tiers";
import { VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
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
import {
    buildCreationMentionReferences,
    creationReferenceMetadata,
    displayCreationPrompt,
    expandCreationPrompt,
    reconcileCreationAttachmentLimit,
    removeCreationReferenceTokens,
    selectedCreationReferences,
    type CreationReference,
} from "./creation-references";
import {
    creationAttachmentFromAsset,
    creationAttachmentFromAudio,
    creationAttachmentFromAudioAsset,
    creationAttachmentFromDocument,
    creationAttachmentFromExternalAsset,
    creationAttachmentFromImage,
    creationAttachmentFromVideo,
    creationAttachmentFromVideoAsset,
    creationAttachmentKind,
    creationAudioAsset,
    creationFileAccepted,
    creationImageAsset,
    creationMediaAspectRatio,
    creationUploadAccept,
    creationVideoAsset,
    splitCreationAttachments,
    type CreationAttachment,
} from "./creation-assets";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

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

const modeLabels = (): Record<CreationMode, string> => ({ text: t("canvas:texts"), image: t("canvas:images"), video: t("canvas:videos") });
const shotScriptLabels = (): Record<CreationMode, string> => ({ text: t("canvas:story-idea"), image: t("canvas:image-direction"), video: t("canvas:shot-script") });
const ratioOptions = () => [
    { value: "1:1", label: t("canvas:square") },
    { value: "16:9", label: t("canvas:landscape") },
    { value: "9:16", label: t("canvas:portrait") },
    { value: "4:3", label: t("canvas:standard-landscape") },
    { value: "3:4", label: t("canvas:standard-portrait") },
    { value: "21:9", label: t("canvas:widescreen") },
];
const qualityOptions = () => [
    { value: "auto", label: t("canvas:auto"), description: t("canvas:let-the-model-decide") },
    { value: "low", label: t("canvas:low"), description: t("canvas:faster-generation") },
    { value: "medium", label: t("canvas:medium"), description: t("canvas:balanced") },
    { value: "high", label: t("canvas:high"), description: t("canvas:detail-first") },
    // grok2api / xAI Imagine：quality 映射 resolution
    { value: "1k", label: "1K", description: t("canvas:standard-resolution") },
    { value: "2k", label: "2K", description: t("canvas:higher-resolution") },
];
const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
const countOptions = ["1", "2", "3", "4"];
const TEXT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
// 语言切换后模块级 formatter 不会重建：按 locale 惰性缓存，避免 en 模式下时间仍按中文习惯显示
const conversationTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function conversationTimeFormatter() {
    const locale = formatLocale();
    let formatter = conversationTimeFormatters.get(locale);
    if (!formatter)
        conversationTimeFormatters.set(locale, (formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })));
    return formatter;
}

function newConversation(): CreationConversation {
    const { t } = useTranslation("canvas");
    return { id: createClientId(), title: t("canvas:new-creation"), updatedAt: new Date().toISOString(), messages: [] };
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

function completedCreationGenerationTask(input: {
    taskId: string;
    task?: GenerationTask;
    mode: "image" | "video";
    prompt: string;
    result: BackendGenerationResult;
    conversationId: string;
    messageId: string;
    batchIndex?: number;
    batchCount?: number;
}): GenerationTask {
    const now = new Date().toISOString();
    const task = input.task ?? { id: input.taskId, type: input.mode, status: "succeeded" as const, prompt: input.prompt, attempts: 1, createdAt: now, updatedAt: now };
    return projectGenerationTaskResult(
        {
            ...task,
            status: "succeeded",
            prompt: input.prompt,
            clientContext: {
                conversationId: input.conversationId,
                messageId: input.messageId,
                ...(typeof input.batchIndex === "number" ? { batchIndex: input.batchIndex } : {}),
                ...(typeof input.batchCount === "number" ? { batchCount: input.batchCount } : {}),
            },
        },
        input.result,
    );
}

export default function CreatePage() {
    const { t } = useTranslation("canvas");
    const { message: toast, modal } = App.useApp();
    const config = useEffectiveConfig();
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
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [busy, setBusy] = useState(false);
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

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [activeId, conversations]);
    const historyConversations = useMemo(
        () => conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt)),
        [activeId, conversations],
    );
    const preferredModel = mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(
        () => ({
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
            options:
                mode === "image"
                    ? { size: ratio, quality, count: Number(count), transparentBackground: config.transparentBackground === "true" }
                    : mode === "video"
                      ? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality, videoGenerateAudio: config.videoGenerateAudio === "true", videoWatermark: config.videoWatermark === "true" }
                      : {},
        }),
        [attachments, config.transparentBackground, config.videoGenerateAudio, config.videoWatermark, count, hasPrompt, mode, quality, ratio, seconds, videoQuality],
    );
    const selectedModel = resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    const maxReferences = mode === "video" ? (videoProfile.operations.includes("image_to_video") ? videoProfile.references.maxImages : 0) : mode === "image" ? imageProfile.references.maxImages : 6;
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
    const visibleShotIndex = shots.length ? (selectedShotIndex >= 0 && selectedShotIndex < shots.length ? selectedShotIndex : shots.length - 1) : -1;

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
                await consumeGenerationTaskMessage(
                    task,
                    task.clientContext!.messageId!,
                    async ({ effectKey, resultUrls }) => {
                        if (cancelled) return;
                        await updateConversationMessage(
                            task.clientContext!.conversationId!,
                            task.clientContext!.messageId!,
                            (item) => applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) })).value,
                        );
                    },
                    { signal: observationController.signal, materialize: async () => task, materializedUrls: generationTaskMaterializedUrls },
                );
            }
            if (!attachable.length && !cancelled) setConversations((current) => reconcileCreationTaskMessages(current, persistedTasks));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn(t("canvas:failed-to-sync-creation-task-status"), error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning(t("canvas:task-status-cannot-sync-right-now-refresh-later"));
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
        listAddedSkills()
            .then(({ skills }) => {
                if (!cancelled) setAddedSkills(skills);
            })
            .catch(() => {
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

    const updateActive = useCallback(
        (updater: (conversation: CreationConversation) => CreationConversation) => {
            const next = updateCreationConversationSnapshot(conversationsRef.current, activeId, updater);
            conversationsRef.current = next;
            setConversations(next);
        },
        [activeId],
    );

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => (item.id === id ? updater(item) : item)),
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
        () =>
            externalAssetSources.items.map((item) => ({
                ...item,
                disabledReason: mode === "image" && item.external?.item.kind !== "image" ? t("canvas:image-creation-supports-reference-images-only") : undefined,
            })),
        [externalAssetSources.items, mode],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...assets
                .filter((asset): asset is Extract<Asset, { kind: "image" | "video" | "audio" }> => asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: asset.category || "other",
                    kindLabel: asset.kind === "video" ? t("canvas:videos") : asset.kind === "audio" ? t("canvas:audio") : t("canvas:images"),
                    asset,
                    searchText: asset.tags.join(" "),
                    disabledReason: mode === "image" && asset.kind !== "image" ? t("canvas:image-creation-supports-reference-images-only") : undefined,
                })),
            ...externalLibraryItems,
        ],
        [assets, externalLibraryItems, mode],
    );
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
            toast.warning(mode === "image" ? t("canvas:the-current-image-model-does-not-support-reference-images") : t("canvas:the-current-model-does-not-support-image-to-video"));
            return;
        }
        const next = Array.from(files)
            .filter((file) => creationFileAccepted(mode, file))
            .slice(0, Math.max(0, maxReferences - attachments.length));
        if (!next.length) return;
        void Promise.allSettled(
            next.map(async (file) => {
                const { asset, attachment } = await uploadCreationAsset(file);
                if (asset) addAsset(asset);
                return attachment;
            }),
        ).then((settled) => {
            const items = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
            const failed = settled.filter((entry) => entry.status === "rejected");
            if (items.length) setAttachments((current) => [...current, ...items].slice(0, maxReferences));
            if (failed.length) toast.error(t("canvas:param-reference-assets-failed-to-upload-please-retry", { length: failed.length }));
        });
    };

    const uploadLibraryAssets = async (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => creationFileAccepted(mode, file));
        if (!next.length) return [];
        const settled = await Promise.allSettled(
            next.map(async (file) => {
                const { asset } = await uploadCreationAsset(file);
                return asset ? addAsset(asset) : "";
            }),
        );
        const assetIds = settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []));
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(t("canvas:param-assets-uploaded-to-the-library-and-selected-automatically", { length: assetIds.length }));
        if (failed.length) toast.error(t("canvas:param-assets-failed-to-upload-please-retry", { length: failed.length }));
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
        setAttachments((current) => current.filter((item) => item.id !== id));
        if (reference) setPrompt((current) => removeCreationReferenceTokens(current, [reference]));
    };

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
            toast.warning(t("canvas:configure-model-first", { model: modeLabels()[mode] }));
            releaseRetryLock();
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds))) {
            toast.error(t("canvas:the-current-model-does-not-support-the-selected-duration-choose-again"));
            releaseRetryLock();
            return;
        }
        if (attachments.length > maxReferences) {
            toast.warning(t("canvas:references-are-being-adjusted-to-the-current-model-s-capabilities-try-ag"));
            releaseRetryLock();
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(attachments);
        const expandedPrompt = expandCreationPrompt(text, references, attachments);
        const referenceMetadata = creationReferenceMetadata(references);
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
            updateOriginAssistant((item) => ({
                ...item,
                generationStage: task.stage,
                generationOperation: task.operation,
                generationErrorCode: task.errorCode,
                taskIds: Array.from(new Set([...(item.taskIds || []), task.id])),
                clientOperationId: task.clientOperationId,
                retryOf: task.retryOf,
                attemptGroupId: task.attemptGroupId,
            }));
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
                  ? { size: normalizedVideo?.ratio || ratio, videoSeconds: normalizedVideo?.seconds || seconds, vquality: (normalizedVideo?.resolution || videoQuality).replace(/p$/i, "") }
                  : {}),
        };
        try {
            if (mode === "text") {
                if (backendModelRuntimeRequired(requestConfig)) {
                    const result = await runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                        runBackendGenerationTask({
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
                            ...retryContext,
                        }),
                    );
                    if (!result.text?.trim()) throw new Error(t("canvas:backend-task-returned-no-text"));
                    updateOriginAssistant((item) => ({ ...item, content: result.text || "" }));
                } else {
                    const history = await Promise.all(
                        [...(activeConversation.messages || []), userMessage].map(async (item) => ({
                            role: item.role,
                            content: item.role === "user" ? await buildTextMessageContent(item) : item.content,
                        })),
                    );
                    const replayPublisher = createTextReplayPublisher(requestConfig, text);
                    void replayPublisher.start();
                    let finalText = "";
                    await requestImageQuestion(
                        requestConfig,
                        history,
                        (full) => {
                            finalText = full;
                            updateOriginAssistant((item) => ({ ...item, content: full }));
                            replayPublisher.publish(full);
                        },
                        {
                            signal: requestLifecycle.signal,
                            onReasoning: (reasoning) => updateOriginAssistant((item) => ({ ...item, reasoning })),
                        },
                    );
                    replayPublisher.finish(finalText);
                }
            } else if (mode === "image") {
                const taskCount = Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                    runBackendGenerationTaskBatch({
                        mode: "image",
                        prompt: expandedPrompt,
                        config: { ...requestConfig, count: "1" },
                        referenceImages,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        count: taskCount,
                        ...retryContext,
                    }),
                );
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
                const storedImages = await Promise.allSettled(
                    generatedImages.map(async ({ image, taskId, batchIndex }) => {
                        if (!taskId) throw new Error(t("canvas:generation-task-lacks-a-stable-task-identifier-2"));
                        const task = completedCreationGenerationTask({
                            taskId,
                            task: boundTasks.get(taskId),
                            mode: "image",
                            prompt: expandedPrompt,
                            result: { mode: "image", images: [image] },
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            batchIndex,
                            batchCount: taskCount,
                        });
                        const materialized = await consumeGenerationTaskMessage(
                            task,
                            assistantMessage.id,
                            async ({ resultUrls, effectKey }) => {
                                await updateOriginAssistant(
                                    (item) =>
                                        applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                            ...current,
                                            status: "done" as const,
                                            content: t("canvas:image-generated"),
                                            resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])),
                                        })).value,
                                );
                            },
                            { signal: requestLifecycle.signal },
                        );
                        const url = generationTaskMaterializedUrls(materialized)[0];
                        if (!url) throw new Error(t("canvas:image-result-resource-unavailable"));
                        return url;
                    }),
                );
                const resultUrls = storedImages.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    const reason = taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error(t("canvas:backend-task-returned-no-images-4"));
                }
                if (failedCount) toast.warning(t("canvas:param-images-generated-param-failed", { length: resultUrls.length, failedCount: failedCount }));
                updateOriginAssistant((item) => ({ ...item, content: failedCount ? t("canvas:param-images-generated-param-failed-2", { length: resultUrls.length, failedCount: failedCount }) : t("canvas:image-generated") }));
            } else {
                const result = await runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                    runBackendGenerationTask({
                        mode: "video",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        signal: requestLifecycle.signal,
                        metadata: {
                            source: "create-page",
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            videoEditOperation: referenceAudios.length && !referenceImages.length && !referenceVideos.length ? "audio_to_video" : attachments.length ? "image_to_video" : "text_to_video",
                            ...referenceMetadata,
                        },
                        onTaskUpdate: bindTask,
                        ...retryContext,
                    }),
                );
                if (!result.video?.dataUrl) throw new Error(t("canvas:backend-task-returned-no-video"));
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error(t("canvas:generation-task-lacks-a-stable-task-identifier-2"));
                const task = completedCreationGenerationTask({ taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await consumeGenerationTaskMessage(
                    task,
                    assistantMessage.id,
                    async ({ resultUrls, effectKey }) => {
                        await updateOriginAssistant((item) => applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: t("canvas:video-generated"), resultUrls })).value);
                    },
                    { signal: requestLifecycle.signal },
                );
                if (!generationTaskMaterializedUrls(materialized)[0]) throw new Error(t("canvas:video-result-resource-unavailable"));
            }
            updateOriginAssistant((item) => ({ ...item, status: "done" }));
        } catch (error) {
            if (isGenerationTaskCancelled(error, requestLifecycle.signal)) {
                updateOriginAssistant((item) => ({ ...item, status: "cancelled", content: t("canvas:stopped") }));
                return;
            }
            const message = generationErrorMessage(error);
            updateOriginAssistant((item) => ({
                ...item,
                status: "error",
                error: message,
                generationErrorCode: item.generationErrorCode || generationErrorCode(error),
                generationOperation: item.generationOperation || (mode === "video" ? (attachments.length ? "image_to_video" : "text_to_video") : mode),
                createdAt: assistantMessage.createdAt,
                content: t("canvas:generation-failed"),
            }));
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
        const title = conversation.title.trim() || t("canvas:new-creation");
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t("canvas:delete-this-conversation-history"),
            content: t("canvas:delete-param-only-the-conversation-history-is-removed-uploaded-or-genera", { label: label }),
            okText: t("canvas:delete-conversation"),
            okButtonProps: { danger: true },
            cancelText: t("canvas:keep"),
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
                    toast.success(t("canvas:conversation-deleted-assets-are-kept"));
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t("canvas:failed-to-delete-conversation-history"));
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
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : t("canvas:new-creation"), updatedAt: new Date().toISOString(), messages };
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
            const context: CreationRetryContext = {
                ...(await createGenerationRetryContext(retryOf, attemptGroupId)),
                ...(item.taskIds && item.taskIds.length > 1 ? { retryContextsByBatchIndex: await createGenerationBatchRetryContexts(item.taskIds, attemptGroupId) } : {}),
            };
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

    if (!hydrated || !activeConversation)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );

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
        referenceImageSize,
        maxReferences,
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
        placeholderOverride: viewMode === "storyboard" && composingNextShot ? t("canvas:sc-n-write-shot-prompt", { n: String(nextShotNumber).padStart(2, "0") }) : undefined,
        onSubmit: () => void submit(),
    };

    const visibleShot = shots[visibleShotIndex];
    const visibleShotResultIndex = visibleShot?.result ? activeConversation.messages.indexOf(visibleShot.result) : -1;

    return (
        <>
            <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
                {isEmpty ? (
                    <>
                        <div className="creation-top-actions">
                            <Tooltip title={t("canvas:history-2")}>
                                <button type="button" aria-label={t("canvas:view-history")} aria-expanded={historyOpen} className="creation-top-action" onClick={() => setHistoryOpen(true)}>
                                    <History />
                                </button>
                            </Tooltip>
                        </div>
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-empty-workspace creation-scrollbar">
                            <CreationEmptyBanner />
                            <div className="creation-chat-intro">
                                <span className="creation-intro-signal" aria-hidden="true" />
                                <p>{t("canvas:yingce-ai-film-creation-studio")}</p>
                                <h1>
                                    {t("canvas:turn-the-pictures-in-your-head")}
                                    <span className="creation-intro-emphasis">
                                        <span className="is-pink">{t("canvas:over-to-yingce")}</span>
                                        <span className="is-blue">{t("canvas:and-shoot-them")}</span>
                                    </span>
                                </h1>
                            </div>
                            <div className="creation-empty-composer">
                                <CreationComposer {...composerProps} variant="empty" />
                            </div>
                            <CreationEmptySuggest
                                onStartPrompt={(nextMode, prompt) => {
                                    selectMode(nextMode);
                                    setPrompt(prompt);
                                    window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                                }}
                                onOpenLibrary={() => {
                                    selectMode("image");
                                    setLibraryOpen(true);
                                }}
                            />
                        </main>
                    </>
                ) : viewMode === "chat" ? (
                    <div className="creation-thread-workbench">
                        <CreationWorkspaceToolbar viewMode={viewMode} onViewModeChange={setViewMode} onNewConversation={startNewConversation} onOpenHistory={() => setHistoryOpen(true)} />
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                            <section className="creation-thread-stage">
                                <div className="creation-results">
                                    {activeConversation.messages.map((item, index) => (
                                        <CreationMessageView
                                            key={item.id}
                                            item={item}
                                            modelName={item.model ? modelDisplayName(config, item.model) : ""}
                                            onRetryFailure={() => retryFailedMessage(item, index)}
                                            onCreateVariant={() => createVariant(item, index)}
                                        />
                                    ))}
                                </div>
                            </section>
                        </main>
                        <section className="creation-thread-composer">
                            <CreationComposer {...composerProps} variant="thread" />
                        </section>
                    </div>
                ) : (
                    <div className="storyboard-workbench">
                        <StoryboardToolbar
                            shots={shots}
                            activeIndex={visibleShotIndex}
                            composing={composingNextShot}
                            onSelect={(index) => {
                                setSelectedShotIndex(index);
                                setComposingNextShot(false);
                            }}
                            onBeginCompose={beginComposeNextShot}
                            onCancelCompose={cancelComposeNextShot}
                            onNewConversation={startNewConversation}
                            onOpenHistory={() => setHistoryOpen(true)}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                        />
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="storyboard-workbench-stage creation-scrollbar">
                            <div className="storyboard-workbench-stage-inner">
                                {composingNextShot ? (
                                    <StoryboardNextShotCard shotNumber={nextShotNumber} onCancel={cancelComposeNextShot} />
                                ) : visibleShot ? (
                                    <StoryboardShotCard
                                        shot={visibleShot}
                                        shotNumber={visibleShotIndex + 1}
                                        modelName={visibleShot.result?.model ? modelDisplayName(config, visibleShot.result.model) : ""}
                                        busy={busy}
                                        onRetryFailure={() => {
                                            if (visibleShotResultIndex >= 0 && visibleShot.result) retryFailedMessage(visibleShot.result, visibleShotResultIndex);
                                        }}
                                        onCreateVariant={() => {
                                            if (visibleShotResultIndex >= 0 && visibleShot.result) createVariant(visibleShot.result, visibleShotResultIndex);
                                        }}
                                    />
                                ) : null}
                            </div>
                        </main>
                        <section className="storyboard-workbench-composer">
                            <CreationComposer {...composerProps} variant="thread" />
                        </section>
                    </div>
                )}
            </div>
            <CreationHistoryDrawer open={historyOpen} conversations={historyConversations} activeId={activeConversation.id} onClose={() => setHistoryOpen(false)} onSelect={selectConversation} onDelete={confirmDeleteConversation} />
            <AssetLibraryPickerModal
                open={libraryOpen}
                items={libraryItems}
                categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
                folders={externalAssetSources.folders}
                initialSelectedIds={attachments.flatMap((item) => (item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : []))}
                upload={{
                    accept: creationUploadAccept(mode),
                    description:
                        mode === "text" ? t("canvas:supports-images-videos-audio-and-common-documents-media-is-saved-to-the") : t("canvas:supports-media-for-mode", { media: mode === "video" ? t("canvas:videos-and-audio") : t("canvas:images-2") }),
                    onUpload: uploadLibraryAssets,
                    external: { accept: "image/*", description: t("canvas:writes-into-the-current-eagle-folder-eagle-currently-supports-image-file"), onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) },
                }}
                onClose={() => setLibraryOpen(false)}
                onConfirm={handleLibrarySelect}
            />
        </>
    );
}

const creationAssetCategoryLabels: Record<string, string> = {
    all: t("canvas:all-assets"),
    character: t("canvas:characters"),
    environment: t("canvas:scenes"),
    wardrobe: t("canvas:costumes"),
    prop: t("canvas:props"),
    weapon: t("canvas:weapons"),
    style: t("canvas:styles"),
    other: t("canvas:other"),
};

function CreationHistoryDrawer({
    open,
    conversations,
    activeId,
    onClose,
    onSelect,
    onDelete,
}: {
    open: boolean;
    conversations: CreationConversation[];
    activeId: string;
    onClose: () => void;
    onSelect: (conversation: CreationConversation) => void;
    onDelete: (conversation: CreationConversation) => void;
}) {
    const { t } = useTranslation("canvas");
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
                latest?.mode ? modeLabels()[latest.mode] : t("canvas:create"),
                formatConversationTime(conversation.updatedAt),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return searchable.includes(query);
        });
    }, [conversations, keyword]);

    return (
        <Drawer
            open={open}
            onClose={onClose}
            placement="right"
            size="min(440px, 100vw)"
            closeIcon={<X className="size-4" />}
            className="creation-history-drawer"
            rootClassName="creation-history-drawer-root"
            styles={{ body: { padding: 0 } }}
            title={
                <div className="creation-history-title">
                    <span>{t("canvas:history-2")}</span>
                    <small>
                        {conversations.length} {t("canvas:conversations")}
                    </small>
                </div>
            }
        >
            <div className="creation-history-content">
                <label className="creation-history-search">
                    <Search aria-hidden="true" />
                    <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("canvas:search-conversation-titles-or-content")} aria-label={t("canvas:search-history")} />
                </label>
                {visibleConversations.length ? (
                    <ul className="creation-history-list" aria-label={t("canvas:conversation-history-newest-first")}>
                        {visibleConversations.map((conversation) => {
                            const latest = conversationPreviewMessage(conversation);
                            const active = conversation.id === activeId;
                            return (
                                <li key={conversation.id} className={active ? "is-active" : undefined}>
                                    <button type="button" className="creation-history-item-main" aria-current={active ? "page" : undefined} onClick={() => onSelect(conversation)}>
                                        <span className="creation-history-time">
                                            <time dateTime={conversation.updatedAt}>{formatConversationTime(conversation.updatedAt)}</time>
                                            <em>{latest?.mode ? modeLabels()[latest.mode] : t("canvas:create")}</em>
                                        </span>
                                        <strong className="creation-history-item-heading">{conversation.title.trim() || t("canvas:new-creation")}</strong>
                                        <span className="creation-history-snippet">{latest ? displayCreationPrompt(latest.content, latest.references || []).trim() || t("canvas:no-creations-yet") : t("canvas:no-creations-yet")}</span>
                                    </button>
                                    <Tooltip title={t("canvas:delete-conversation")}>
                                        <button type="button" className="creation-history-delete" aria-label={t("canvas:delete-conversation-aria", { title: conversation.title.trim() || t("canvas:new-creation") })} onClick={() => onDelete(conversation)}>
                                            <Trash2 />
                                        </button>
                                    </Tooltip>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="creation-history-empty">{keyword.trim() ? t("canvas:no-matching-conversations") : t("canvas:no-history-yet")}</div>
                )}
            </div>
        </Drawer>
    );
}

function CreationViewSwitch({ viewMode, onChange }: { viewMode: CreationViewMode; onChange: (mode: CreationViewMode) => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="creation-view-switch" role="group" aria-label={t("canvas:creation-view")}>
            <button type="button" aria-pressed={viewMode === "chat"} onClick={() => onChange("chat")}>
                <MessageSquareText />
                {t("canvas:continuous-chat")}
            </button>
            <button type="button" aria-pressed={viewMode === "storyboard"} onClick={() => onChange("storyboard")}>
                <Clapperboard />
                {t("canvas:shot-creation")}
            </button>
        </div>
    );
}

function CreationWorkspaceToolbar({ viewMode, onViewModeChange, onNewConversation, onOpenHistory }: { viewMode: CreationViewMode; onViewModeChange: (mode: CreationViewMode) => void; onNewConversation: () => void; onOpenHistory: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <header className="creation-thread-toolbar">
            <CreationViewSwitch viewMode={viewMode} onChange={onViewModeChange} />
            <div className="storyboard-workbench-bar-actions">
                <Tooltip title={t("canvas:new-creation-2")}>
                    <button type="button" aria-label={t("canvas:new-creation-2")} className="storyboard-workbench-bar-action" onClick={onNewConversation}>
                        <Plus />
                    </button>
                </Tooltip>
                <Tooltip title={t("canvas:history-2")}>
                    <button type="button" aria-label={t("canvas:view-history")} className="storyboard-workbench-bar-action" onClick={onOpenHistory}>
                        <History />
                    </button>
                </Tooltip>
            </div>
        </header>
    );
}

function CreationMessageView({ item, modelName, onRetryFailure, onCreateVariant }: { item: CreationMessage; modelName: string; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const { t } = useTranslation("canvas");
    if (item.role === "user") return <CreationUserMessage item={item} />;
    const mode = item.mode || "text";
    const stateLabel = item.status === "pending" ? t("canvas:generating") : item.status === "cancelled" ? t("canvas:stopped") : item.status === "error" ? t("canvas:generation-failed") : "";
    const heading = (
        <>
            <span className="creation-message-mark">
                <Sparkles />
            </span>
            <strong>{mode === "image" ? t("canvas:image-generation-2") : mode === "video" ? t("canvas:video-generation") : t("canvas:yingce-ai-2")}</strong>
            {mode !== "text" ? (
                <span className="creation-message-progress-copy">
                    {item.status === "pending"
                        ? t("canvas:yingce-generating-media-ellipsis", { media: mode === "video" ? t("canvas:videos") : t("canvas:images-2") })
                        : item.status === "done"
                          ? t("canvas:yours-media-created", { media: mode === "video" ? t("canvas:videos") : t("canvas:images-2") })
                          : null}
                </span>
            ) : null}
            {modelName ? <span className="creation-message-model">{modelName}</span> : null}
            {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
            {stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}
        </>
    );
    const toolStatus: GenerationToolStatus = item.status === "pending" ? "running" : item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "completed";
    return (
        <article className={`creation-assistant-message is-${mode}`}>
            {mode === "text" ? (
                <>
                    <div className="creation-message-heading">{heading}</div>
                    {item.reasoning ? <MessageReasoning reasoning={item.reasoning} isStreaming={item.status === "streaming"} /> : null}
                    <div className="creation-message-content">{item.content ? <AIMessageMarkdown isStreaming={item.status === "streaming"}>{item.content}</AIMessageMarkdown> : <span>{t("canvas:generating-3")}</span>}</div>
                </>
            ) : (
                <GenerationToolCard status={toolStatus} isBulk={(item.resultUrls?.length || Number(item.settings?.count) || 1) > 1} heading={heading}>
                    <MediaResult item={item} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} />
                </GenerationToolCard>
            )}
            {item.error && mode === "text" ? (
                <div className="creation-message-error">
                    <span>{generationErrorMessage(item.error)}</span>
                    <button type="button" onClick={onRetryFailure}>
                        <RefreshCw />
                        {t("canvas:regenerate-5")}
                    </button>
                </div>
            ) : null}
        </article>
    );
}

function CreationUserMessage({ item }: { item: CreationMessage }) {
    const { t } = useTranslation("canvas");
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const copyText = useCopyText();
    const visiblePrompt = displayCreationPrompt(item.content, item.references || []);
    return (
        <article className="creation-user-message">
            <div className="creation-user-message-meta">
                <span>{t("canvas:you")}</span>
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                <Tooltip title={t("canvas:copy-message")}>
                    <button type="button" className="creation-user-message-copy" aria-label={t("canvas:copy-prompt")} onClick={() => copyText(visiblePrompt, t("canvas:prompt-copied"))}>
                        <Copy />
                    </button>
                </Tooltip>
            </div>
            <div className="creation-user-message-copy-wrap">
                <p>{visiblePrompt}</p>
            </div>
            {item.references?.length ? <CreationMessageReferences references={item.references} /> : null}
            {item.attachments?.length ? (
                <div className="creation-user-message-attachments">
                    {item.attachments.map((attachment) => {
                        const kind = creationAttachmentKind(attachment);
                        const previewable = kind === "image" || kind === "video";
                        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
                        return (
                            <button
                                key={attachment.id}
                                type="button"
                                className={!previewable ? "is-file" : undefined}
                                onClick={() => {
                                    if (!previewable) return;
                                    setPreviewType(kind === "video" ? "video" : "image");
                                    setPreviewUrl(kind === "video" ? attachment.url || "" : url);
                                }}
                                aria-label={previewable ? t("canvas:preview-attachment-aria", { name: attachment.name || t("canvas:attachments-2") }) : attachment.name || t("canvas:attachments-2")}
                                disabled={previewable && !url}
                            >
                                {kind === "video" ? (
                                    <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" />
                                ) : kind === "image" ? (
                                    <img src={url} alt={attachment.name || t("canvas:attachments-2")} width={44} height={44} loading="lazy" />
                                ) : kind === "audio" ? (
                                    <Music2 />
                                ) : (
                                    <FileText />
                                )}
                                {previewable ? (
                                    <span aria-hidden="true">
                                        <Maximize2 />
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </article>
    );
}

function MediaResult({ item, onRetryFailure, onCreateVariant }: { item: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const { t } = useTranslation("canvas");
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const assets = useAssetStore((state) => state.assets);
    const resultUrls = item.resultUrls || [];
    const resultAssetIds = resultUrls.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls }) : [];
    const canvasPath = creationCanvasHandoffPath(resultAssetIds) || "/canvas";
    if (item.status === "pending") return <CreationMediaPending mode={item.mode || "image"} ratio={item.settings?.ratio} />;
    if ((item.status === "error" || item.status === "cancelled") && !resultUrls.length)
        return (
            <div className="creation-media-error">
                <span>{item.status === "cancelled" ? item.content || t("canvas:stopped") : generationErrorMessage(item.error || t("canvas:generation-failed"))}</span>
                <button type="button" onClick={onRetryFailure}>
                    <RefreshCw />
                    {t("canvas:regenerate-5")}
                </button>
            </div>
        );
    if (!resultUrls.length)
        return (
            <div className="creation-media-empty">
                {t("canvas:no-previewable-results-returned-2")}{" "}
                <button type="button" onClick={onRetryFailure}>
                    {t("canvas:retry-2")}
                </button>
            </div>
        );
    const isVideo = item.mode === "video";
    return (
        <div className="creation-media-result">
            {isVideo ? (
                <button
                    type="button"
                    className="creation-video-result"
                    onClick={() => {
                        setPreviewType("video");
                        setPreviewUrl(resultUrls[0]);
                    }}
                    aria-label={t("canvas:preview-generated-video")}
                >
                    <video muted preload="metadata" src={resultUrls[0]} />
                    <span>
                        <Maximize2 />
                        {t("canvas:preview-video-2")}
                    </span>
                </button>
            ) : (
                <div className="creation-image-result-grid">
                    {resultUrls.map((url) => (
                        <button
                            key={url}
                            type="button"
                            className="creation-image-result"
                            onClick={() => {
                                setPreviewType("image");
                                setPreviewUrl(url);
                            }}
                            aria-label={t("canvas:preview-generated-images")}
                        >
                            <img src={url} alt={t("canvas:generation-results")} />
                            <span>
                                <Maximize2 />
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <div className="creation-media-actions">
                <span>{isVideo ? t("canvas:video-results") : t("canvas:param-images", { length: resultUrls.length })}</span>
                <button type="button" onClick={onCreateVariant}>
                    <RefreshCw />
                    {t("canvas:generate-similar")}
                </button>
                <Link to={canvasPath}>{resultAssetIds.length ? t("canvas:add-to-canvas") : t("canvas:open-canvas")}</Link>
                {resultUrls.map((url, index) => (
                    <a key={`${url}-download`} href={url} download>
                        {resultUrls.length > 1 ? (
                            t("canvas:download-n", { index: index + 1 })
                        ) : (
                            <>
                                <Download />
                                {t("canvas:download-3")}
                            </>
                        )}
                    </a>
                ))}
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </div>
    );
}

function CreationMediaPending({ mode, ratio }: { mode: CreationMode; ratio?: string }) {
    const { t } = useTranslation("canvas");
    return (
        <div className={`creation-media-pending is-${mode}`} style={{ aspectRatio: creationMediaAspectRatio(ratio, mode) }} aria-live="polite">
            <span className="creation-media-pending-icon">
                <Sparkles />
            </span>
            <span className="sr-only">
                {t("canvas:yingce-is-generating")}
                {mode === "video" ? t("canvas:videos") : t("canvas:images-2")}
            </span>
        </div>
    );
}

function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="creation-user-message-references" aria-label={t("canvas:referenced-this-time")}>
            {references.map((reference) => {
                const Icon = reference.kind === "skill" ? Sparkles : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
                return (
                    <span key={reference.id} className="creation-user-message-reference">
                        {reference.previewUrl && reference.kind === "video" ? (
                            <video src={reference.previewUrl} muted playsInline preload="metadata" aria-label={reference.label} />
                        ) : reference.previewUrl && reference.kind === "image" ? (
                            <img src={reference.previewUrl} alt="" />
                        ) : (
                            <Icon />
                        )}
                        <span>{reference.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

function CreationMediaPreviewModal({ url, type, onClose }: { url: string; type: "image" | "video"; onClose: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <Modal
            open={Boolean(url)}
            title={null}
            footer={null}
            centered
            destroyOnHidden
            width={type === "video" ? "min(1160px, calc(100vw - 32px))" : "min(980px, calc(100vw - 32px))"}
            onCancel={onClose}
            className="creation-media-preview-modal"
            styles={{ body: { padding: 0 } }}
        >
            {url ? type === "video" ? <video controls autoPlay className="creation-media-preview-video" src={url} /> : <img className="creation-media-preview-image" src={url} alt={t("canvas:media-preview")} /> : null}
        </Modal>
    );
}

function CreationAttachmentThumbnail({
    item,
    primary = false,
    canAddMore = false,
    onPreview,
    onRemove,
    onAdd,
}: {
    item: CreationAttachment;
    primary?: boolean;
    canAddMore?: boolean;
    onPreview: (type: "image" | "video", url: string) => void;
    onRemove: (id: string) => void;
    onAdd?: () => void;
}) {
    const { t } = useTranslation("canvas");
    const kind = creationAttachmentKind(item);
    const previewable = kind === "image" || kind === "video";
    const url = (kind === "video" ? item.url : item.previewUrl) || "";
    return (
        <div className={primary ? "creation-chat-reference is-paper creation-chat-reference-media" : "creation-chat-attachment"}>
            <button
                type="button"
                className={`creation-chat-attachment-preview${previewable ? "" : " is-file"}`}
                onClick={() => {
                    if (previewable) onPreview(kind === "video" ? "video" : "image", url);
                }}
                aria-label={previewable ? t("canvas:enlarge-preview-param", { name: item.name }) : item.name}
                disabled={previewable && !url}
            >
                {kind === "video" ? (
                    <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} />
                ) : kind === "image" ? (
                    <img src={item.previewUrl} alt={item.name} />
                ) : (
                    <span className="creation-chat-file-icon">
                        {kind === "audio" ? <Music2 /> : <FileText />}
                        <em>{item.name}</em>
                    </span>
                )}
                {previewable ? (
                    <span aria-hidden="true">
                        <Maximize2 />
                    </span>
                ) : null}
            </button>
            <button type="button" className="creation-chat-attachment-remove" onClick={() => onRemove(item.id)} aria-label={t("canvas:remove-param", { name: item.name })}>
                <X />
            </button>
            {primary && canAddMore && onAdd ? (
                <Tooltip title={t("canvas:add-more-references")}>
                    <button type="button" className="creation-chat-reference-add" onClick={onAdd} aria-label={t("canvas:add-more-references")}>
                        <Plus />
                    </button>
                </Tooltip>
            ) : null}
        </div>
    );
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    attachments: CreationAttachment[];
    referenceImageSize?: { width: number; height: number };
    maxReferences: number;
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
};

function CreationComposer(props: ComposerProps) {
    const { t } = useTranslation("canvas");
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const canSubmit = Boolean(props.prompt.trim()) && !props.busy;
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const priceChannel = resolveModelChannel(props.config, props.model);
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(props.model),
        count: props.mode === "image" ? props.count : 1,
        seconds: props.mode === "video" ? props.seconds : 1,
    });
    const showCost = creditsEnabled && credits !== null;
    const formattedCredits = credits?.toLocaleString(formatLocale(), { maximumFractionDigits: 6 });
    const actionLabel = props.busy ? t("canvas:generating") : showCost ? t("canvas:estimated-cost-param-credits-send", { formattedCredits: formattedCredits }) : t("canvas:send");
    const placeholder =
        props.mode === "text"
            ? t("canvas:describe-your-story-characters-or-ideas-to-continue-exploring")
            : props.mode === "image"
              ? t("canvas:describe-the-visuals-characters-scene-composition-and-style")
              : t("canvas:describe-shot-content-camera-movement-lighting-and-pacing");
    const emptyPlaceholder = t("canvas:type-your-shots-visuals-or-story-you-can-also-add-reference-images-to-st");
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "image" ? imageReferencesSupported : props.mode !== "video" || props.videoProfile.operations.includes("image_to_video");
    const [primaryAttachment, ...secondaryAttachments] = props.attachments;
    const canAddMoreReferences = referencesSupported && props.attachments.length < props.maxReferences;
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || props.imageProfile.maxOutputs > 1;
    const previewAttachment = (type: "image" | "video", url: string) => {
        setPreviewType(type);
        setPreviewUrl(url);
    };
    return (
        <section className={`creation-chat-composer is-${props.variant}`}>
            <div className="creation-chat-writing-surface">
                <input ref={props.fileInputRef} type="file" hidden accept={creationUploadAccept(props.mode)} multiple onChange={props.onFileChange} />
                {primaryAttachment ? (
                    <CreationAttachmentThumbnail item={primaryAttachment} primary canAddMore={canAddMoreReferences && !props.busy} onPreview={previewAttachment} onRemove={props.onRemoveAttachment} onAdd={props.onOpenLibrary} />
                ) : (
                    <Tooltip title={!referencesSupported ? t("canvas:the-current-model-does-not-support-reference-media") : t("canvas:choose-references-from-the-asset-library")}>
                        <button type="button" className="creation-chat-reference is-paper" onClick={props.onOpenLibrary} disabled={props.busy || !referencesSupported} aria-label={t("canvas:open-the-asset-library-to-pick-references")}>
                            <Plus />
                            <span>{t("canvas:references")}</span>
                        </button>
                    </Tooltip>
                )}
                <div className="creation-chat-editor">
                    <CanvasResourceMentionTextarea
                        ref={props.composerFocusRef}
                        value={props.prompt}
                        references={props.references}
                        mentionMenuWidth={400}
                        sendOnEnter={false}
                        onChange={props.setPrompt}
                        onSubmit={props.onSubmit}
                        containerClassName="creation-chat-mention-container"
                        className="creation-chat-mention-editor creation-scrollbar"
                        style={{ color: "var(--creation-text)" }}
                        placeholder={props.placeholderOverride || (props.variant === "empty" ? emptyPlaceholder : placeholder)}
                        aria-label={t("canvas:write-your-prompt-use-to-reference-current-references-or-skills")}
                        spellCheck
                        disabled={props.busy}
                    />
                    {secondaryAttachments.length ? (
                        <div className="creation-chat-attachment-strip">
                            {secondaryAttachments.map((item) => (
                                <CreationAttachmentThumbnail key={item.id} item={item} onPreview={previewAttachment} onRemove={props.onRemoveAttachment} />
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
            <footer className="creation-chat-dock">
                <div className="creation-chat-controls">
                    <VoiceRecordingButton disabled={props.busy} onTranscribed={(text) => props.setPrompt(props.prompt.trim() ? `${props.prompt} ${text}` : text)} />
                    <ModePicker mode={props.mode} onModeChange={props.onModeChange} />
                    <Tooltip title={t("canvas:upload-attachments-from-this-device")}>
                        <button type="button" className="creation-chat-control" onClick={() => props.fileInputRef.current?.click()} disabled={props.busy || !referencesSupported} aria-label={t("canvas:upload-attachments-from-this-device")}>
                            <Paperclip />
                            <span>{t("canvas:attachments-2")}</span>
                        </button>
                    </Tooltip>
                    <Tooltip title={!referencesSupported ? t("canvas:the-current-model-does-not-support-reference-media") : t("canvas:choose-references-from-the-asset-library")}>
                        <button type="button" className="creation-chat-control" onClick={props.onOpenLibrary} disabled={props.busy || !referencesSupported} aria-label={t("canvas:open-the-asset-library-to-pick-references")}>
                            <FolderOpen />
                            <span>{t("canvas:asset-library")}</span>
                        </button>
                    </Tooltip>
                    <ModelPicker
                        config={props.config}
                        value={props.model}
                        onChange={props.onModelChange}
                        capability={props.mode}
                        requirements={props.modelRequirements}
                        className="creation-model-picker"
                        placeholder={t("canvas:select-model-for", { model: modeLabels()[props.mode] })}
                        showSelectedPrice
                        variant="creation"
                    />
                    {props.mode === "video" || (props.mode === "image" && imageSettingsSupported) ? <GenerationSettingsMenu {...props} /> : null}
                    {props.mode === "video" ? <DurationMenu profile={props.videoProfile} seconds={props.seconds} onChange={props.setSeconds} /> : null}
                </div>
                <Button
                    type="text"
                    className={`canvas-node-composer-submit ${showCost ? "has-cost" : ""}`}
                    disabled={props.busy || !canSubmit}
                    style={
                        {
                            color: !props.busy && !canSubmit ? "var(--creation-faint)" : "var(--creation-text)",
                            "--canvas-composer-submit-action": !props.busy && !canSubmit ? "var(--creation-surface-hover)" : "var(--creation-text)",
                            "--canvas-composer-submit-action-fg": !props.busy && !canSubmit ? "var(--creation-faint)" : "var(--creation-bg)",
                        } as CSSProperties
                    }
                    onClick={props.busy ? undefined : props.onSubmit}
                    aria-label={actionLabel}
                    title={actionLabel}
                >
                    {showCost ? (
                        <span className="canvas-node-composer-submit-cost">
                            <CreditSymbol />
                            <span>{formattedCredits}</span>
                        </span>
                    ) : null}
                    <span className="canvas-node-composer-submit-action" aria-hidden>
                        {props.busy ? <LoaderCircle className="size-3 animate-spin" /> : <ArrowUp className="size-3" />}
                    </span>
                </Button>
            </footer>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </section>
    );
}

function ModePicker({ mode, onModeChange }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void }) {
    const { t } = useTranslation("canvas");
    const [open, setOpen] = useState(false);
    const items: { mode: CreationMode; icon: ReactNode; label: string }[] = [
        { mode: "video", icon: <Film />, label: t("canvas:video-generation") },
        { mode: "image", icon: <ImageIcon />, label: t("canvas:image-generation") },
        { mode: "text", icon: <MessageSquareText />, label: t("canvas:text-creation") },
    ];
    const current = items.find((item) => item.mode === mode) || items[0];
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={
                <div className="creation-mode-picker-menu" role="listbox" aria-label={t("canvas:choose-generation-type")}>
                    {items.map((item) => (
                        <button
                            key={item.mode}
                            type="button"
                            role="option"
                            aria-selected={item.mode === mode}
                            className={item.mode === mode ? "is-selected" : ""}
                            onClick={() => {
                                onModeChange(item.mode);
                                setOpen(false);
                            }}
                        >
                            <span className="creation-menu-icon">{item.icon}</span>
                            <span>{item.label}</span>
                            {item.mode === mode ? <Check /> : null}
                        </button>
                    ))}
                </div>
            }
        >
            <button type="button" className="creation-chat-control is-mode" aria-label={t("canvas:generation-type-param", { label: current.label })}>
                {current.icon}
                <span>{current.label}</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

function GenerationSettingsMenu(props: ComposerProps) {
    const { t } = useTranslation("canvas");
    const [open, setOpen] = useState(false);
    const [customRatioOpen, setCustomRatioOpen] = useState(!ratioOptions().some((option) => option.value === props.ratio));
    const activeQualityOptions = props.imageProfile.quality.values.map((value) => qualityOptions().find((item) => item.value === value) || { value, label: value.toUpperCase(), description: t("canvas:quality-resolution-supported-by-the-model") });
    const qualityLabel = activeQualityOptions.find((item) => item.value === props.quality)?.label || qualityOptions().find((item) => item.value === props.quality)?.label || props.quality || t("canvas:auto");
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
        : mergedProfile.size.values.length
          ? mergedProfile.size.values
          : ratioOptions().map((item) => item.value);
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
    const summary = props.mode === "video" ? [props.ratio, ...(videoResolutionSupported ? [videoResolutionLabel(props.videoQuality)] : [])].join(" · ") : imageSummary;
    const panel = (
        <div className="creation-parameter-menu">
            {props.mode === "video" || mergedProfile.size.parameter !== "none" ? (
                <SettingSection title={t("canvas:aspect-ratio")} value={referenceImageSizeSelected ? referenceImageSizeLabel : props.mode === "image" && usesImageResolutionPicker ? activeImageRatio : props.ratio}>
                    <div className="creation-parameter-content">
                        <div className="creation-choice-grid is-ratio">
                            {referenceImageSizeValue ? (
                                <button
                                    type="button"
                                    aria-pressed={referenceImageSizeSelected}
                                    aria-label={t("canvas:use-reference-image-size") + referenceImageSizeLabel}
                                    title={t("canvas:use-reference-image-size") + referenceImageSizeLabel}
                                    className={"creation-reference-size-choice" + (referenceImageSizeSelected ? " is-selected" : "")}
                                    onClick={selectReferenceImageSize}
                                >
                                    <span className="creation-ratio-preview">
                                        <span style={ratioPreviewStyle(referenceImageSizeRatio)} />
                                    </span>
                                    <span>{t("canvas:reference-image")}</span>
                                </button>
                            ) : null}
                            {ratios.map((value) => {
                                const selected = props.mode === "image" && usesImageResolutionPicker ? value === activeImageRatio : value === props.ratio;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={selected}
                                        className={selected ? "is-selected" : ""}
                                        onClick={() => {
                                            if (props.mode === "image") selectImageRatio(value);
                                            else props.setRatio(value);
                                            setCustomRatioOpen(false);
                                        }}
                                    >
                                        <span className="creation-ratio-preview">
                                            <span style={ratioPreviewStyle(value)} />
                                        </span>
                                        <span>{value}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {props.mode !== "video" &&
                            mergedProfile.size.allowCustom &&
                            (customRatioOpen ? (
                                <label className="creation-custom-value">
                                    <span>{t("canvas:width-x-height")}</span>
                                    <input
                                        value={props.ratio}
                                        onFocus={(event) => event.currentTarget.select()}
                                        onChange={(event) => props.setRatio(event.target.value)}
                                        placeholder={t("canvas:1920x1080-or-2-1")}
                                        aria-label={t("canvas:custom-image-size-or-ratio")}
                                    />
                                </label>
                            ) : (
                                <button type="button" className="creation-custom-trigger" onClick={() => setCustomRatioOpen(true)}>
                                    <Plus />
                                    {t("canvas:enter-custom-size")}
                                </button>
                            ))}
                    </div>
                </SettingSection>
            ) : null}
            {props.mode === "video" ? (
                videoResolutionSupported ? (
                    <SettingSection title={t("canvas:resolution-2")} value={videoResolutionLabel(props.videoQuality)}>
                        <div className="creation-choice-grid is-resolution">
                            {resolutions.map((option) => (
                                <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </SettingSection>
                ) : null
            ) : (
                <>
                    {imageResolutionChoiceOptions.length ? (
                        <SettingSection title={t("canvas:resolution")} value={activeImageResolutionChoice === "auto" ? t("canvas:auto") : activeImageResolutionChoice.toUpperCase()}>
                            <div className="creation-choice-grid is-resolution">
                                {imageResolutionChoiceOptions.map((choice) => (
                                    <button key={choice} type="button" aria-pressed={choice === activeImageResolutionChoice} className={choice === activeImageResolutionChoice ? "is-selected" : ""} onClick={() => selectImageResolution(choice)}>
                                        {choice === "auto" ? t("canvas:auto") : choice.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        </SettingSection>
                    ) : null}
                    {props.imageProfile.quality.supported ? (
                        <SettingSection title={activeQualityOptions.some((item) => item.value === "1k" || item.value === "2k") ? t("canvas:resolution") : t("canvas:image-quality")} value={qualityLabel}>
                            <div className="creation-choice-grid is-quality">
                                {activeQualityOptions.map((option) => (
                                    <button key={option.value} type="button" aria-pressed={option.value === props.quality} className={option.value === props.quality ? "is-selected" : ""} onClick={() => props.setQuality(option.value)}>
                                        <span>{option.label}</span>
                                        <small>{option.description}</small>
                                    </button>
                                ))}
                            </div>
                        </SettingSection>
                    ) : null}
                    {props.imageProfile.maxOutputs > 1 ? (
                        <SettingSection title={t("canvas:count")} value={t("canvas:param", { count: props.count })}>
                            <div className="creation-parameter-content">
                                <div className="creation-choice-grid is-count">
                                    {countOptions
                                        .filter((option) => Number(option) <= props.imageProfile.maxOutputs)
                                        .map((option) => (
                                            <button key={option} type="button" aria-pressed={option === props.count} className={option === props.count ? "is-selected" : ""} onClick={() => props.setCount(option)}>
                                                {option}
                                            </button>
                                        ))}
                                </div>
                                <label className="creation-custom-value">
                                    <span>{t("canvas:custom")}</span>
                                    <input
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={props.count}
                                        onChange={(event) => props.setCount(String(Math.max(1, Math.min(props.imageProfile.maxOutputs, Number(event.target.value) || 1))))}
                                        aria-label={t("canvas:output-count-from-1-to-param", { maxOutputs: props.imageProfile.maxOutputs })}
                                    />
                                    <em>{t("canvas:item")}</em>
                                </label>
                            </div>
                        </SettingSection>
                    ) : null}
                </>
            )}
        </div>
    );
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={panel}
        >
            <button type="button" className="creation-chat-control" aria-label={t("canvas:generation-settings-param", { summary: summary })}>
                <SlidersHorizontal />
                <span>{summary}</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

function SettingSection({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
    return (
        <section className="creation-parameter-section">
            <header>
                <h3>{title}</h3>
                {value ? <span>{value}</span> : null}
            </header>
            {children}
        </section>
    );
}

function DurationMenu({ profile, seconds, onChange }: { profile: VideoCapabilityConfig; seconds: string; onChange: (value: string) => void }) {
    const { t } = useTranslation("canvas");
    const [open, setOpen] = useState(false);
    const value = Number(normalizeVideoValue(profile, { seconds }).seconds);
    const presets = profile.duration.selection === "enum" ? videoDurationOptions(profile) : [];
    const fallbackPreset = presets.length ? presets : [profile.duration.default];
    const min = profile.duration.selection === "range" ? profile.duration.min || 1 : Math.min(...fallbackPreset);
    const max = profile.duration.selection === "range" ? Math.max(min, profile.duration.max || min) : Math.max(...fallbackPreset);
    const step = Math.max(1, profile.duration.step || 1);
    const durationControl =
        profile.duration.selection === "range" ? (
            <>
                <input className="h-8 w-full" style={{ accentColor: "var(--creation-text)" }} type="range" min={min} max={max} step={step} value={value} aria-label={t("canvas:video-duration-seconds")} onChange={(event) => onChange(event.target.value)} />
                <div className="flex justify-between px-0.5 text-[var(--fs-tiny)] text-[var(--creation-muted)]">
                    <span>{min}s</span>
                    <span>{max}s</span>
                </div>
                <label className="creation-custom-value is-duration">
                    <span>{t("canvas:custom-duration")}</span>
                    <span className="creation-duration-custom-field">
                        <input
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            inputMode="numeric"
                            value={seconds}
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={() => onChange(String(value))}
                            onChange={(event) => onChange(event.target.value)}
                            aria-label={t("canvas:custom-video-duration-in-seconds")}
                        />
                        <em>{t("canvas:s-2")}</em>
                    </span>
                </label>
            </>
        ) : (
            <div className="creation-duration-choices">
                {presets.map((item) => (
                    <button key={item} type="button" className={item === value ? "is-selected" : ""} onClick={() => onChange(String(item))}>
                        {item}s
                    </button>
                ))}
            </div>
        );
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={
                <div className="creation-duration-menu">
                    <div className="creation-duration-heading">
                        <span>{t("canvas:duration-2")}</span>
                        <strong>
                            {value} {t("canvas:s-2")}
                        </strong>
                    </div>
                    {durationControl}
                </div>
            }
        >
            <button type="button" className="creation-chat-control is-duration" aria-label={t("canvas:duration-params", { value: value })}>
                <Clock3 />
                <span>{value}s</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

const creationEmptyBannerFrames = [
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: t("canvas:sc-01-neon-rain-night") },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: t("canvas:sc-02-alley-chase") },
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: t("canvas:sc-03-rooftop-reunion") },
];

function CreationEmptyBanner() {
    const { t } = useTranslation("canvas");
    return (
        <div className="creation-empty-art" aria-hidden="true">
            {creationEmptyBannerFrames.map((frame, index) => (
                <figure key={frame.caption} className={`creation-empty-art-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                    <img src={frame.src} alt="" />
                    <span>{frame.caption}</span>
                </figure>
            ))}
            <span className="creation-empty-art-caption">
                <span>{t("canvas:yingce")}</span>
                {t("canvas:leave-every-frame-to-your-shot-director")}
            </span>
        </div>
    );
}

const creationEmptySuggestions: Array<{ mode: CreationMode; icon: typeof Clapperboard; title: string; hint: string; prompt: string; openLibrary?: boolean }> = [
    { mode: "video", icon: Clapperboard, title: t("canvas:generate-the-first-shot"), hint: t("canvas:describe-visuals-camera-movement-and-lighting"), prompt: t("canvas:rainy-rooftop-the-camera-pushes-in-on-the-heroine-beneath-a-neon-sign-as") },
    { mode: "image", icon: ImageIcon, title: t("canvas:start-from-a-reference-image"), hint: t("canvas:upload-a-style-image-and-generate-matching-visuals"), prompt: "", openLibrary: true },
    { mode: "text", icon: FileText, title: t("canvas:continue-a-story"), hint: t("canvas:discuss-plot-characters-and-dialogue-with-ai"), prompt: t("canvas:help-me-continue-a-short-drama-story-let-s-talk-direction-first") },
    { mode: "video", icon: Sparkles, title: t("canvas:boost-with-skills"), hint: t("canvas:skills-for-storyboarding-dubbing-and-more"), prompt: t("canvas:use-the-storyboard-skill-to-plan-this-shot") },
];

function CreationEmptySuggest({ onStartPrompt, onOpenLibrary }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; onOpenLibrary: () => void }) {
    return (
        <div className="creation-empty-suggest">
            {creationEmptySuggestions.map((item) => {
                const Icon = item.icon;
                return (
                    <button
                        key={item.title}
                        type="button"
                        className="suggest-card"
                        onClick={() => {
                            if (item.openLibrary) onOpenLibrary();
                            else onStartPrompt(item.mode, item.prompt);
                        }}
                    >
                        <span className={`library-icon-tile suggest-icon is-${item.mode}`}>
                            <Icon size={15} strokeWidth={2} />
                        </span>
                        <span className="suggest-copy">
                            <strong>{item.title}</strong>
                            <span>{item.hint}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

type CreationThinking = { title: string; hint: string; steps: string[] };

function thinkingFor(mode: CreationMode): CreationThinking {
    const { t } = useTranslation("canvas");
    if (mode === "image")
        return {
            title: t("canvas:drawing-this-shot-for-you"),
            hint: t("canvas:yingce-reads-your-composition-intent-and-hands-the-frame-to-the-model"),
            steps: [t("canvas:reading-composition"), t("canvas:setting-the-style"), t("canvas:generating-the-frame")],
        };
    if (mode === "text")
        return { title: t("canvas:writing-this-passage-for-you"), hint: t("canvas:yingce-is-organizing-your-creative-thread-wording-and-structure"), steps: [t("canvas:untangling-the-thread"), t("canvas:polishing-wording"), t("canvas:writing-output")] };
    return {
        title: t("canvas:shooting-this-scene-for-you"),
        hint: t("canvas:yingce-breaks-down-your-shot-script-designs-camera-and-lighting-and-rend"),
        steps: [t("canvas:breaking-down-the-shot"), t("canvas:designing-camera-moves"), t("canvas:setting-the-lighting"), t("canvas:rendering-the-cut")],
    };
}

function directorNoteFor(mode: CreationMode, settings: CreationSettings): string {
    const { t } = useTranslation("canvas");
    if (mode === "video") return t("canvas:rendered-at-ratio-awaiting-next", { ratio: [`${settings.seconds}s`, ...(settings.videoQuality ? [videoResolutionLabel(settings.videoQuality)] : []), settings.ratio].join(" · ") });
    if (mode === "image") return t("canvas:generated-param-images-at-param-awaiting-your-next-instruction", { ratio: settings.ratio, count: settings.count });
    return "";
}

function StoryboardToolbar({
    shots,
    activeIndex,
    composing,
    onSelect,
    onBeginCompose,
    onCancelCompose,
    onNewConversation,
    onOpenHistory,
    viewMode,
    onViewModeChange,
}: {
    shots: CreationShot[];
    activeIndex: number;
    composing: boolean;
    onSelect: (index: number) => void;
    onBeginCompose: () => void;
    onCancelCompose: () => void;
    onNewConversation: () => void;
    onOpenHistory: () => void;
    viewMode: CreationViewMode;
    onViewModeChange: (mode: CreationViewMode) => void;
}) {
    const { t } = useTranslation("canvas");
    const [railOpen, setRailOpen] = useState(false);
    const nextShotNumber = shots.length + 1;
    const closeRail = () => setRailOpen(false);
    const statusOf = (shot: CreationShot) => shot.result?.status || "queued";
    const shotTitle = (shot: CreationShot) => (shot.user ? displayCreationPrompt(shot.user.content, shot.user.references || []).trim() || t("canvas:untitled-shot") : t("canvas:shots-3"));
    return (
        <header className="storyboard-workbench-bar" aria-label={t("canvas:shot-toolbar")}>
            <div className="storyboard-workbench-rail">
                <Tooltip title={t("canvas:shot-timeline-2")}>
                    <button
                        type="button"
                        className={`storyboard-workbench-rail-button${railOpen ? " is-open" : ""}${composing ? " is-draft" : ""}`}
                        aria-expanded={railOpen}
                        aria-label={t("canvas:shot-timeline-2")}
                        onClick={() => setRailOpen((value) => !value)}
                    >
                        <Film />
                        <span className="storyboard-workbench-rail-badge">{composing ? nextShotNumber : shots.length}</span>
                    </button>
                </Tooltip>
                {railOpen ? (
                    <div className="storyboard-workbench-rail-pop" role="listbox" aria-label={t("canvas:shot-list")}>
                        <div className="storyboard-workbench-rail-pop-head">
                            <span className="storyboard-workbench-rail-pop-title">
                                <Clapperboard />
                                {t("canvas:shot-timeline-2")}
                                <small>{composing ? t("canvas:next-shot-sc-n", { n: String(nextShotNumber).padStart(2, "0") }) : t("canvas:param-shots", { length: shots.length })}</small>
                            </span>
                            <button type="button" className="storyboard-workbench-rail-pop-close" aria-label={t("canvas:close-shot-list")} onClick={closeRail}>
                                <X />
                            </button>
                        </div>
                        <ul className="creation-scrollbar">
                            {shots.map((shot, index) => {
                                const status = statusOf(shot);
                                const title = shotTitle(shot);
                                const thumbUrl = shot.result?.resultUrls?.[0];
                                const thumbIsVideo = shot.result?.mode === "video";
                                return (
                                    <li key={shot.user?.id || shot.result?.id || index}>
                                        <button
                                            type="button"
                                            className={`storyboard-workbench-rail-row${index === activeIndex && !composing ? " is-active" : ""}`}
                                            onClick={() => {
                                                onSelect(index);
                                                closeRail();
                                            }}
                                        >
                                            <span className="storyboard-workbench-rail-thumb">
                                                {thumbUrl ? (
                                                    thumbIsVideo ? (
                                                        <video muted preload="metadata" src={thumbUrl} />
                                                    ) : (
                                                        <img src={thumbUrl} alt="" />
                                                    )
                                                ) : (
                                                    <span className="storyboard-workbench-rail-thumb-ph">
                                                        <Clapperboard />
                                                        <em>SC.{String(index + 1).padStart(2, "0")}</em>
                                                    </span>
                                                )}
                                            </span>
                                            <span className="storyboard-workbench-rail-info">
                                                <span className="storyboard-workbench-rail-head">
                                                    <span className="storyboard-workbench-rail-row-shot">SC.{String(index + 1).padStart(2, "0")}</span>
                                                    <span className={`storyboard-workbench-rail-row-state is-${status}`}>
                                                        {status === "pending" ? t("canvas:generating") : status === "error" ? t("canvas:failed") : status === "done" ? t("canvas:done") : t("canvas:to-generate-2")}
                                                    </span>
                                                    {shot.result?.createdAt ? <time dateTime={shot.result.createdAt}>{formatMessageTime(shot.result.createdAt)}</time> : null}
                                                </span>
                                                <span className="storyboard-workbench-rail-row-title">{title}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                            {composing ? (
                                <li>
                                    <button
                                        type="button"
                                        className="storyboard-workbench-rail-row is-draft"
                                        onClick={() => {
                                            onCancelCompose();
                                            closeRail();
                                        }}
                                    >
                                        <span className="storyboard-workbench-rail-thumb">
                                            <span className="storyboard-workbench-rail-thumb-ph">
                                                <Clapperboard />
                                                <em>SC.{String(nextShotNumber).padStart(2, "0")}</em>
                                            </span>
                                        </span>
                                        <span className="storyboard-workbench-rail-info">
                                            <span className="storyboard-workbench-rail-head">
                                                <span className="storyboard-workbench-rail-row-shot">SC.{String(nextShotNumber).padStart(2, "0")}</span>
                                                <span className="storyboard-workbench-rail-row-state">{t("canvas:to-write-2")}</span>
                                            </span>
                                            <span className="storyboard-workbench-rail-row-title">{t("canvas:waiting-for-your-script-2")}</span>
                                        </span>
                                    </button>
                                </li>
                            ) : null}
                        </ul>
                        <button
                            type="button"
                            className="storyboard-workbench-rail-pop-add"
                            onClick={() => {
                                closeRail();
                                onBeginCompose();
                            }}
                        >
                            <Plus />
                            {t("canvas:add-shot-2")}
                        </button>
                    </div>
                ) : null}
            </div>
            <div className="storyboard-workbench-bar-actions">
                <CreationViewSwitch viewMode={viewMode} onChange={onViewModeChange} />
                <Tooltip title={composing ? t("canvas:collapse-next-shot") : t("canvas:add-shot-2")}>
                    <button type="button" aria-label={composing ? t("canvas:collapse-next-shot") : t("canvas:add-shot-2")} className="storyboard-workbench-bar-action" onClick={composing ? onCancelCompose : onBeginCompose}>
                        {composing ? <X /> : <Clapperboard />}
                    </button>
                </Tooltip>
                <Tooltip title={t("canvas:new-creation-2")}>
                    <button type="button" aria-label={t("canvas:new-creation-2")} className="storyboard-workbench-bar-action" onClick={onNewConversation}>
                        <Plus />
                    </button>
                </Tooltip>
                <Tooltip title={t("canvas:history-2")}>
                    <button type="button" aria-label={t("canvas:view-history")} className="storyboard-workbench-bar-action" onClick={onOpenHistory}>
                        <History />
                    </button>
                </Tooltip>
            </div>
        </header>
    );
}

function StoryboardShotCard({ shot, shotNumber, modelName, busy, onRetryFailure, onCreateVariant }: { shot: CreationShot; shotNumber: number; modelName: string; busy: boolean; onRetryFailure: () => void; onCreateVariant: () => void }) {
    const { t } = useTranslation("canvas");
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
    return (
        <article className={`storyboard-workbench-card is-${status}`}>
            <header className="storyboard-workbench-card-head">
                <div className="storyboard-workbench-card-heading">
                    <span className="storyboard-workbench-card-shot">
                        <span className="storyboard-workbench-card-shot-index">SC.{String(shotNumber).padStart(2, "0")}</span>
                        {t("canvas:shots-3")} {shotNumber}
                    </span>
                    <span className="storyboard-workbench-card-mode">
                        {mode === "video" ? <Film /> : mode === "image" ? <ImageIcon /> : <MessageSquareText />}
                        {modeLabels()[mode]}
                    </span>
                    {modelName ? <span className="storyboard-workbench-card-model">{modelName}</span> : null}
                    {status === "pending" ? (
                        <span className="storyboard-workbench-card-state is-pending">
                            <LoaderCircle className="animate-spin" />
                            {t("canvas:generating")}
                        </span>
                    ) : status === "error" ? (
                        <span className="storyboard-workbench-card-state is-error">{t("canvas:generation-failed")}</span>
                    ) : status === "done" ? (
                        <span className="storyboard-workbench-card-state is-done">
                            <Check />
                            {t("canvas:done-2")}
                        </span>
                    ) : (
                        <span className="storyboard-workbench-card-state">{t("canvas:to-generate-2")}</span>
                    )}
                </div>
                <div className="storyboard-workbench-card-actions">
                    {status === "error" ? (
                        <button type="button" onClick={onRetryFailure} disabled={busy}>
                            <RefreshCw />
                            {t("canvas:regenerate-5")}
                        </button>
                    ) : null}
                    {status === "done" && result?.resultUrls?.length ? (
                        <button type="button" onClick={onCreateVariant} disabled={busy}>
                            <RefreshCw />
                            {t("canvas:generate-variants-2")}
                        </button>
                    ) : null}
                    {status === "done" && resultUrls.length ? <Link to={canvasPath}>{canvasHandoffPath ? t("canvas:add-to-canvas") : t("canvas:open-canvas")}</Link> : null}
                    {resultUrls.map((url, index) => (
                        <a key={`${url}-download`} href={url} download>
                            {resultUrls.length > 1 ? (
                                t("canvas:download-n", { index: index + 1 })
                            ) : (
                                <>
                                    <Download />
                                    {t("canvas:download-3")}
                                </>
                            )}
                        </a>
                    ))}
                </div>
            </header>
            <div className="storyboard-workbench-card-body">
                <div className="storyboard-workbench-thread" aria-label={t("canvas:conversation-for-shot-param", { shotNumber: shotNumber })}>
                    {briefVisible && user ? (
                        <div className="storyboard-workbench-turn is-user">
                            <div className="storyboard-workbench-turn-copy">
                                <div className="storyboard-workbench-turn-meta">
                                    <span className="storyboard-workbench-turn-role">{shotScriptLabels()[mode]}</span>
                                    {user.createdAt ? (
                                        <time className="storyboard-workbench-turn-time" dateTime={user.createdAt}>
                                            {formatMessageTime(user.createdAt)}
                                        </time>
                                    ) : null}
                                    <Tooltip title={t("canvas:copy-message")}>
                                        <button type="button" className="creation-user-message-copy" aria-label={t("canvas:copy-prompt")} onClick={() => copyText(visiblePrompt, t("canvas:prompt-copied"))}>
                                            <Copy />
                                        </button>
                                    </Tooltip>
                                </div>
                                <div className="storyboard-workbench-turn-bubble">
                                    <p className="storyboard-workbench-turn-text">{visiblePrompt}</p>
                                    {user.references?.length ? <CreationMessageReferences references={user.references} /> : null}
                                    {user.attachments?.length ? <StoryboardBriefAttachments attachments={user.attachments} /> : null}
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {briefVisible && user ? (
                        <div className="storyboard-workbench-handoff" aria-hidden="true">
                            <span className="storyboard-workbench-handoff-rail" />
                            <span className="storyboard-workbench-handoff-badge">
                                <ArrowDown />
                                {t("canvas:hand-off-to-yingce-ai")}
                            </span>
                            <span className="storyboard-workbench-handoff-rail" />
                        </div>
                    ) : null}
                    <div className="storyboard-workbench-turn is-ai">
                        <span className="storyboard-workbench-ai-avatar">
                            <Clapperboard />
                        </span>
                        <div className="storyboard-workbench-turn-copy">
                            <div className="storyboard-workbench-turn-meta">
                                <span className="storyboard-workbench-turn-role is-ai">
                                    <Sparkles />
                                    {t("canvas:yingce-ai-2")}
                                </span>
                                {modelName ? <span className="storyboard-workbench-turn-model">{modelName}</span> : null}
                                {result?.createdAt ? (
                                    <time className="storyboard-workbench-turn-time" dateTime={result.createdAt}>
                                        {formatMessageTime(result.createdAt)}
                                    </time>
                                ) : null}
                            </div>
                            <div className="storyboard-workbench-turn-bubble">
                                <StoryboardShotResult result={result} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} canvasPath={canvasPath} canvasHandoffAvailable={Boolean(canvasHandoffPath)} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}

function StoryboardNextShotCard({ shotNumber, onCancel }: { shotNumber: number; onCancel: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <article className="storyboard-workbench-card is-next">
            <header className="storyboard-workbench-card-head">
                <div className="storyboard-workbench-card-heading">
                    <span className="storyboard-workbench-card-shot">
                        <span className="storyboard-workbench-card-shot-index">SC.{String(shotNumber).padStart(2, "0")}</span>
                        {t("canvas:next-shot")} {shotNumber}
                    </span>
                    <span className="storyboard-workbench-card-state is-draft">
                        <Clapperboard />
                        {t("canvas:to-write-2")}
                    </span>
                </div>
                <div className="storyboard-workbench-card-actions">
                    <button type="button" onClick={onCancel}>
                        <X />
                        {t("canvas:cancel-writing")}
                    </button>
                </div>
            </header>
            <div className="storyboard-workbench-card-body">
                <div className="storyboard-workbench-next-panel">
                    <span className="storyboard-workbench-next-panel-icon">
                        <Clapperboard />
                    </span>
                    <div className="storyboard-workbench-next-panel-copy">
                        <strong>
                            SC.{String(shotNumber).padStart(2, "0")} {t("canvas:waiting-for-your-script-2")}
                        </strong>
                        <span>
                            {t("canvas:write-this-shot-s-visuals-camera-or-story-below-yingce-breaks-down-the-s")}
                            {String(shotNumber).padStart(2, "0")} {t("canvas:on-the-shot-timeline")}
                        </span>
                    </div>
                </div>
            </div>
        </article>
    );
}

function StoryboardBriefAttachments({ attachments }: { attachments: CreationAttachment[] }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const { t } = useTranslation("canvas");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    return (
        <>
            <div className="creation-user-message-attachments storyboard-workbench-brief-attachments">
                {attachments.map((attachment) => {
                    const kind = creationAttachmentKind(attachment);
                    const previewable = kind === "image" || kind === "video";
                    const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
                    return (
                        <button
                            key={attachment.id}
                            type="button"
                            className={!previewable ? "is-file" : undefined}
                            onClick={() => {
                                if (!previewable) return;
                                setPreviewType(kind === "video" ? "video" : "image");
                                setPreviewUrl(kind === "video" ? attachment.url || "" : url);
                            }}
                            aria-label={previewable ? t("canvas:preview-attachment-aria", { name: attachment.name || t("canvas:attachments-2") }) : attachment.name || t("canvas:attachments-2")}
                            disabled={previewable && !url}
                        >
                            {kind === "video" ? (
                                <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" />
                            ) : kind === "image" ? (
                                <img src={url} alt={attachment.name || t("canvas:attachments-2")} width={44} height={44} loading="lazy" />
                            ) : kind === "audio" ? (
                                <Music2 />
                            ) : (
                                <FileText />
                            )}
                            {previewable ? (
                                <span aria-hidden="true">
                                    <Maximize2 />
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </>
    );
}

function StoryboardShotResult({ result, onRetryFailure, onCreateVariant, canvasPath, canvasHandoffAvailable }: { result?: CreationMessage; onRetryFailure: () => void; onCreateVariant: () => void; canvasPath: string; canvasHandoffAvailable: boolean }) {
    const { t } = useTranslation("canvas");
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const openPreview = (url: string, type: "image" | "video") => {
        setPreviewType(type);
        setPreviewUrl(url);
    };
    if (!result)
        return (
            <div className="storyboard-workbench-empty">
                <Film />
                {t("canvas:this-shot-hasn-t-started-write-your-script-below-and-i-ll-take-over")}
            </div>
        );
    const mode = result.mode || "video";
    const status = result.status || "queued";
    const resultUrls = result.resultUrls || [];
    if (status === "pending" || status === "queued") {
        const thinking = thinkingFor(mode);
        return (
            <div className="storyboard-workbench-pending">
                <div className="storyboard-workbench-thinking">
                    <span className="storyboard-workbench-thinking-copy">
                        <strong>{thinking.title}</strong>
                        <span>{thinking.hint}</span>
                    </span>
                    <span className="storyboard-workbench-pipeline" aria-hidden="true">
                        {thinking.steps.map((step, index) => (
                            <em key={step} style={{ "--step": index } as CSSProperties}>
                                <i>{String(index + 1).padStart(2, "0")}</i>
                                {step}
                            </em>
                        ))}
                    </span>
                </div>
            </div>
        );
    }
    if (status === "error")
        return (
            <div className="storyboard-workbench-error">
                <span>{generationErrorMessage(result.error || "")}</span>
                <button type="button" onClick={onRetryFailure}>
                    <RefreshCw />
                    {t("canvas:regenerate-5")}
                </button>
            </div>
        );
    if (status === "cancelled")
        return (
            <div className="storyboard-workbench-error">
                <span>{result.content || t("canvas:stopped")}</span>
                <button type="button" onClick={onRetryFailure}>
                    <RefreshCw />
                    {t("canvas:regenerate-5")}
                </button>
            </div>
        );
    if (mode === "text")
        return <div className="creation-message-content storyboard-workbench-text">{result.content ? <AIMessageMarkdown isStreaming={status === "streaming"}>{result.content}</AIMessageMarkdown> : <span>{t("canvas:generating-3")}</span>}</div>;
    if (!resultUrls.length)
        return (
            <div className="storyboard-workbench-empty">
                <Film />
                {t("canvas:no-previewable-results-returned-2")}{" "}
                <button type="button" onClick={onRetryFailure}>
                    {t("canvas:retry-2")}
                </button>
            </div>
        );
    const note = result.settings ? directorNoteFor(mode, result.settings) : "";
    return (
        <>
            {mode === "video" ? (
                <button type="button" className="creation-video-result" onClick={() => openPreview(resultUrls[0], "video")} aria-label={t("canvas:preview-generated-video")}>
                    <video muted preload="metadata" className="size-full object-cover" src={resultUrls[0]} />
                    <span>
                        <Maximize2 />
                        {t("canvas:preview-video-2")}
                    </span>
                </button>
            ) : (
                <div className="creation-image-result-grid">
                    {resultUrls.map((url) => (
                        <button key={url} type="button" className="creation-image-result" onClick={() => openPreview(url, "image")} aria-label={t("canvas:preview-generated-images")}>
                            <img src={url} alt={t("canvas:generation-results")} />
                            <span>
                                <Maximize2 />
                            </span>
                        </button>
                    ))}
                </div>
            )}
            {note ? (
                <p className="storyboard-workbench-director-note">
                    <span>{t("canvas:director-s-notes")}</span>
                    {note}
                </p>
            ) : null}
            <div className="storyboard-workbench-media-meta">
                <span>{mode === "video" ? t("canvas:video-results") : t("canvas:param-images", { length: resultUrls.length })}</span>
                <button type="button" onClick={onCreateVariant}>
                    <RefreshCw />
                    {t("canvas:generate-variants-2")}
                </button>
                <Link to={canvasPath}>{canvasHandoffAvailable ? t("canvas:add-to-canvas") : t("canvas:open-canvas")}</Link>
                {resultUrls.map((url, index) => (
                    <a key={`${url}-download`} href={url} download>
                        {resultUrls.length > 1 ? (
                            t("canvas:download-n", { index: index + 1 })
                        ) : (
                            <>
                                <Download />
                                {t("canvas:download-3")}
                            </>
                        )}
                    </a>
                ))}
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </>
    );
}

function videoResolutionLabel(value: string | number) {
    return Number(String(value).replace(/p$/i, "")) === 2160 ? "4K" : `${String(value).replace(/p$/i, "")}P`;
}

function formatMessageTime(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? conversationTimeFormatter().format(timestamp) : "";
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
    const { t } = useTranslation("canvas");
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
        parts.push({ type: "file_url", file_url: { url, name: attachment.name || t("canvas:attachments-2"), mimeType: attachment.type || "application/octet-stream" } });
    }
    return parts;
}

async function creationAttachmentDataUrl(attachment: CreationAttachment) {
    const { t } = useTranslation("canvas");
    if ((attachment.bytes || 0) > TEXT_ATTACHMENT_MAX_BYTES) throw new Error(t("canvas:param-exceeds-20mb-compress-it-before-uploading-as-a-text-model-attachme", { name: attachment.name }));
    const attachmentUrl = attachment.url || "";
    if (attachmentUrl.startsWith("data:")) return attachmentUrl;
    const blob = attachment.storageKey ? await getMediaBlob(attachment.storageKey) : null;
    if (blob) {
        if (blob.size > TEXT_ATTACHMENT_MAX_BYTES) throw new Error(t("canvas:param-exceeds-20mb-compress-it-before-uploading-as-a-text-model-attachme", { name: attachment.name }));
        return blobToDataUrl(blob);
    }
    if (/^https:\/\//i.test(attachmentUrl)) return attachmentUrl;
    throw new Error(t("canvas:param-cannot-be-read-upload-it-again", { name: attachment.name }));
}

function blobToDataUrl(blob: Blob) {
    const { t } = useTranslation("canvas");
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(t("canvas:failed-to-read-attachment")));
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
    const { t } = useTranslation("canvas");
    return Promise.all(
        tasks.map(async (task): Promise<PersistedCreationTask> => {
            // 文本正文保存在 resultJson，不进入媒体资源化链路。
            if (task.status !== "succeeded" || !task.clientContext || task.type === "canvas_text") return task;
            try {
                const materialized = await runGenerationConsumer(signal, (managedSignal) => materializeGenerationTaskAssets(task, managedSignal));
                const creationResultUrls = generationTaskMaterializedUrls(materialized);
                return creationResultUrls.length ? { ...materialized, creationResultUrls } : materialized;
            } catch (error) {
                return { ...task, creationError: error instanceof Error ? error.message : t("canvas:failed-to-persist-generation-results") };
            }
        }),
    );
}

function reconcileCreationTaskMessages(conversations: CreationConversation[], tasks: PersistedCreationTask[]) {
    const { t } = useTranslation("canvas");
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
                completedAt = matches.reduce((latest, task) => (conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest), completedAt);
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
            completedAt = matches.reduce((latest, task) => (conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest), completedAt);
            conversationChanged = true;
            changed = true;

            if (resultUrls.length) {
                const content = message.mode === "video" ? t("canvas:video-generated") : failedCount ? t("canvas:param-images-generated-param-failed-2", { length: resultUrls.length, failedCount: failedCount }) : t("canvas:image-generated");
                return { ...message, status: "done" as const, content, resultUrls, error: undefined, taskIds: nextTaskIds };
            }
            if (matches.every((task) => task.status === "cancelled")) {
                const localOnly = matches.find(isLocalDreaminaWaitStopped);
                return { ...message, status: "cancelled" as const, content: localOnly ? localDreaminaCancellationMessage(localOnly) : t("canvas:stopped"), error: undefined, taskIds: nextTaskIds };
            }
            const failed = matches.find((task) => task.status === "failed" || task.creationError);
            return {
                ...message,
                status: "error" as const,
                content: t("canvas:generation-failed"),
                error: generationErrorMessage(failed?.creationError || failed?.error || t("canvas:the-task-finished-but-results-cannot-be-read-right-now")),
                taskIds: nextTaskIds,
            };
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
    const { t } = useTranslation("canvas");
    const timestamp = conversationTimestamp(value);
    if (!timestamp) return t("canvas:unknown-time");
    return conversationTimeFormatter().format(timestamp);
}

function ratioPreviewStyle(value: string) {
    const [width, height] = value.replace("x", ":").split(":").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 10, height: 10 };
    // 画幅容器的可用空间是 14×10；同时计算宽高，避免 CSS 的 max-width/max-height 把宽银幕比例压扁。
    const scale = Math.min(14 / width, 10 / height);
    return { width: Math.max(4, Math.round(width * scale)), height: Math.max(4, Math.round(height * scale)) };
}
