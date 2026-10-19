import { useQuery } from "@tanstack/react-query";
import { Alert, Button, message, Spin } from "antd";
import { ArrowLeft, Copy, Eye, FileText, Lightbulb, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { summarizeLibTVImportWarnings } from "@/lib/canvas/libtv-import";
import { collectLibTVStepPrompts, createLatestRequestGuard, ensureRemoteLibTVCanvasDraft, pickLibTVRecommendations, resolveLibTVMakeSame, resolveLibTVReplicationPlan } from "@/lib/libtv-gallery";
import { getLibTVGallery, getLibTVWorkDetail } from "@/services/api/libtv-gallery";
import { createCanvasProjectWithRemoteSync, formatLocalSavedRemotePending, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { LibTVGalleryItem, LibTVWorkStep } from "@/types/libtv-gallery";

import { LibTVStepMediaDialog } from "./step-media-dialog";
import { describeLibTVStepMedia } from "./step-media-preview";

const STEP_TYPE_LABEL: Record<LibTVWorkStep["type"], string> = { image: "图像生成", video: "视频生成", audio: "音频生成", text: "文本" };

/** 直接链接与弹窗共用同一内容体：媒体仍是 LibTV 外链，展开状态在切换作品时随 key 重置。 */
export function WorkDetailPane({
    templateUuid,
    recommended,
    onSelectWork,
    onClose,
}: {
    templateUuid: string;
    recommended: LibTVGalleryItem[];
    onSelectWork: (item: LibTVGalleryItem) => void;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const [messageApi, contextHolder] = message.useMessage();
    const [copyingCanvas, setCopyingCanvas] = useState(false);
    const [previewStepId, setPreviewStepId] = useState<string>();
    const draftProjectIdRef = useRef<string | undefined>(undefined);
    // 异步创建草稿期间作品可能已关闭或切到别的作品：回来先确认这次请求仍是最新且仍是同一条作品。
    const copyGuardRef = useRef(createLatestRequestGuard());
    const processRef = useRef<HTMLElement>(null);
    const mainVideoRef = useRef<HTMLVideoElement>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["libtv-work-detail", templateUuid],
        queryFn: () => getLibTVWorkDetail(templateUuid),
        enabled: Boolean(templateUuid),
    });
    const previewStep = data?.steps.find((step) => step.id === previewStepId);

    // 关闭弹窗或切换作品时作废在途的创建请求，并清掉上一条作品留下的待同步草稿。
    useEffect(() => {
        draftProjectIdRef.current = undefined;
        setPreviewStepId(undefined);
        copyGuardRef.current.invalidate();
        return () => copyGuardRef.current.invalidate();
    }, [templateUuid]);

    const handleCopyToCanvas = async () => {
        if (!templateUuid || !data?.canImport || copyingCanvas) return;

        const guard = copyGuardRef.current.begin();
        setCopyingCanvas(true);
        try {
            const result = await ensureRemoteLibTVCanvasDraft(draftProjectIdRef.current, data.work.title.trim() || "未命名画布", {
                create: (title) => createCanvasProjectWithRemoteSync(title),
                retry: (projectId) => saveRemoteUserDataNow(projectId),
                exists: (projectId) => useCanvasStore.getState().projects.some((project) => project.id === projectId),
            });
            // 作品已被关闭/切换：不写回草稿、不导航，也不弹已经过时的提示。
            if (!copyGuardRef.current.isCurrent(guard)) return;
            draftProjectIdRef.current = result.projectId;
            if (!result.ok) {
                // 只保留本地草稿，不进入需要归属校验的模板导入；创建失败时同步层已排队重试，手动重试失败时在此补排。
                const warning = result.phase === "create" ? formatLocalSavedRemotePending("已创建本地草稿画布", result.error) : localSavedRemotePendingMessage("本地草稿画布已保留", result.error);
                messageApi.warning(`${warning} 云端同步成功前不会导入模板，可再次点击「复制到画布」立即重试。`);
                setCopyingCanvas(false);
                return;
            }
            // 进入画布后由导入弹窗读取预览，用户确认后才写入节点。
            onClose();
            navigate(`/canvas/${result.projectId}?importTemplate=${encodeURIComponent(templateUuid)}`);
        } catch (err) {
            if (!copyGuardRef.current.isCurrent(guard)) return;
            messageApi.error(err instanceof Error ? err.message : "创建画布失败");
            setCopyingCanvas(false);
        }
    };

    const openStep = (stepId: string) => {
        mainVideoRef.current?.pause();
        setPreviewStepId(stepId);
    };

    /** 整片复刻不存在：只在作品有「不含引用且带提示词」的视频步骤时，交给用户明确挑一个再预填。 */
    const handleReplicateVideo = () => {
        if (!data) return;
        const plan = resolveLibTVReplicationPlan(data.steps);
        if (plan.kind === "canvas-only") {
            messageApi.info(
                plan.reason === "no-video-step"
                    ? "这条作品没有可独立复刻的视频步骤，请用「复制到画布」把完整流程带进画布后再生成。"
                    : "视频步骤依赖前序引用，无法单步复刻；请用「复制到画布」保留完整结构后在画布中生成。",
            );
            return;
        }
        openStep(plan.options[0].step.id);
        messageApi.info(`这条作品有 ${plan.options.length} 个可独立复刻的视频步骤，可在步骤详情中点「做同款」。`);
    };

    const handleMakeSame = (step: LibTVWorkStep) => {
        const resolution = resolveLibTVMakeSame(step);
        if (!resolution.ok) {
            if (resolution.reason === "unsupported-type") messageApi.info("仅支持图像和视频步骤");
            else if (resolution.reason === "missing-prompt") messageApi.warning("此步骤没有可用的提示词");
            else messageApi.info("此步骤包含引用或模板标记，请使用「复制到画布」保留完整结构");
            return;
        }
        // 只预填提示词与比例，模型沿用用户当前选择，不自动提交。
        onClose();
        navigate("/", { state: resolution.state });
    };

    const body = () => {
        if (isLoading) {
            return (
                <div className="flex h-full items-center justify-center py-20">
                    <Spin size="large" />
                </div>
            );
        }
        if (error || !data) {
            return (
                <div className="py-20 text-center">
                    <div className="text-sm text-foreground/45">加载失败</div>
                    <Button type="link" onClick={onClose}>
                        关闭
                    </Button>
                </div>
            );
        }

        const stepPrompts = collectLibTVStepPrompts(data.steps);
        const warningGroups = summarizeLibTVImportWarnings(data.warnings ?? []);
        const renderStepPrompt = (item: (typeof stepPrompts)[number]) => (
            <div key={item.id}>
                <div className="mb-1 text-xs text-foreground/45">
                    #{item.index + 1} {item.title} · {STEP_TYPE_LABEL[item.type]}
                </div>
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-sm leading-6 text-foreground/80" style={{ background: "var(--surface-hover)" }}>
                    {item.prompt}
                </div>
            </div>
        );

        return (
            <div className="flex flex-col gap-6 lg:h-full lg:flex-row lg:items-start">
                {/* 左栏：主播放器与作品内容，独立滚动 */}
                <div className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto lg:pr-1">
                    <div className="relative w-full overflow-hidden rounded-xl" style={{ background: "var(--library-surface)" }}>
                        {data.work.mediaType === "video" && data.work.mediaUrl ? (
                            <video ref={mainVideoRef} src={data.work.mediaUrl} poster={data.work.coverUrl || undefined} controls preload="none" playsInline className="aspect-video w-full bg-black" />
                        ) : data.work.coverUrl ? (
                            <img src={data.work.coverUrl} alt={data.work.title} loading="lazy" className="aspect-video w-full object-cover" />
                        ) : (
                            <div className="flex aspect-video w-full items-center justify-center text-sm text-foreground/40">此作品没有可播放的媒体</div>
                        )}
                    </div>

                    <div className="mt-4">
                        <h1 className="min-w-0 text-xl font-semibold leading-7">{data.work.title}</h1>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/50">
                            {data.work.authorName && <span>{data.work.authorName}</span>}
                            {data.work.tags.length > 0 && <span>{data.work.tags.map((tag) => tag.label).join(" · ")}</span>}
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                            icon={<Play className="size-4" />}
                            disabled={data.steps.length === 0}
                            onClick={() => processRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
                        >
                            查看制作过程
                        </Button>
                        <Button type="primary" icon={<Copy className="size-4" />} onClick={handleCopyToCanvas} disabled={!data.canImport} loading={copyingCanvas}>
                            复制到画布
                        </Button>
                        <Button icon={<Sparkles className="size-4" />} onClick={handleReplicateVideo} disabled={!data.canImport}>
                            一键复刻视频
                        </Button>
                    </div>

                    <section className="mt-6 rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                        <h2 className="mb-2 text-sm font-semibold">作品描述</h2>
                        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-foreground/70">{data.work.description?.trim() || "这条作品没有提供描述。"}</p>
                    </section>

                    <section className="mt-4 rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                        <h2 className="mb-2 text-sm font-semibold">提示词</h2>
                        {/* 默认只展示第一条真实步骤提示词，其余按需查看。 */}
                        {stepPrompts.length === 0 ? (
                            <p className="m-0 text-sm text-foreground/45">这条作品没有公开提示词。</p>
                        ) : (
                            <>
                                {stepPrompts.length > 1 && <p className="mt-0 mb-3 text-xs text-foreground/45">共 {stepPrompts.length} 段，来自各自步骤，不是整片模板。</p>}
                                {stepPrompts.slice(0, 1).map(renderStepPrompt)}
                                {stepPrompts.length > 1 && (
                                    <details className="mt-3">
                                        <summary className="cursor-pointer text-xs text-foreground/60">
                                            查看其余 {stepPrompts.length - 1} 段提示词
                                        </summary>
                                        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">{stepPrompts.slice(1).map(renderStepPrompt)}</div>
                                    </details>
                                )}
                            </>
                        )}
                    </section>

                    {data.steps.length > 0 && (
                        <section className="mt-4" ref={processRef}>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold">制作流程</h2>
                                <span className="text-xs text-foreground/45">
                                    {data.nodeCount} 个节点 · {data.connectionCount} 条连线
                                </span>
                            </div>

                            {/* 长流程在摘要列表内滚动；步骤详情只在预览窗口中按需加载。 */}
                            <div aria-label="制作流程步骤" tabIndex={0} className="grid max-h-[min(48dvh,420px)] grid-cols-1 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2 xl:grid-cols-3">
                                {data.steps.map((step, index) => {
                                    const hasMedia = describeLibTVStepMedia(step).kind !== "none";
                                    return (
                                        <button
                                            key={step.id}
                                            type="button"
                                            aria-haspopup="dialog"
                                            title={hasMedia ? "预览媒体" : "查看步骤"}
                                            onClick={() => openStep(step.id)}
                                            className="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
                                            style={{ background: "var(--library-surface)" }}
                                        >
                                            <span className="grid size-6 shrink-0 place-items-center rounded-md text-xs tabular-nums" style={{ background: "var(--surface-hover)" }}>
                                                {index + 1}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm">{step.title?.trim() || `步骤 ${index + 1}`}</span>
                                                <span className="block text-xs text-foreground/45">{STEP_TYPE_LABEL[step.type]}</span>
                                            </span>
                                            {hasMedia ? <Eye className="size-4 shrink-0 text-foreground/40" /> : <FileText className="size-4 shrink-0 text-foreground/40" />}
                                        </button>
                                    );
                                })}
                            </div>

                        </section>
                    )}

                    {/* 导入损失与来源警告不丢弃：与「复制到画布」同一屏可见，导入确认阶段仍会再次提示。 */}
                    {warningGroups.length > 0 && (
                        <Alert
                            type="warning"
                            message="导入提示"
                            description={
                                <ul className="mb-0 list-disc pl-4">
                                    {warningGroups.map((warning) => (
                                        <li key={warning.message}>
                                            {warning.message}{warning.count > 1 ? `（${warning.count} 处）` : ""}
                                        </li>
                                    ))}
                                </ul>
                            }
                            className="mt-4"
                            showIcon
                        />
                    )}
                </div>

                {/* 右栏：独立推荐位，左栏滚动时不动。 */}
                <aside className="w-full shrink-0 border-t border-border pt-4 lg:w-[280px] lg:border-l lg:border-t-0 lg:pt-0 lg:pl-5" style={{ borderColor: "var(--surface-hover)" }}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                            <Lightbulb className="size-4" />
                            精选推荐
                        </span>
                    </div>
                    {recommended.length === 0 ? (
                        <p className="m-0 text-xs text-foreground/45">列表中没有更多作品可推荐。</p>
                    ) : (
                        <div className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                            {recommended.map((item) => (
                                <button
                                    key={item.templateUuid}
                                    type="button"
                                    onClick={() => onSelectWork(item)}
                                    className="group flex w-[220px] shrink-0 items-center gap-3 rounded-lg p-2 text-left transition-colors lg:w-full"
                                    style={{ background: "var(--library-surface)" }}
                                >
                                    <span className="relative size-12 shrink-0 overflow-hidden rounded-md" style={{ background: "var(--surface-hover)" }}>
                                        {item.coverUrl ? <img src={item.coverUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover" /> : null}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm">{item.title}</span>
                                        <span className="block truncate text-xs text-foreground/45">{item.authorName || item.tags[0]?.label || "公开作品"}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </aside>
            </div>
        );
    };

    return (
        <>
            {contextHolder}
            {/* flush 弹窗：内边距由内容自己给，关闭按钮留在右上角，不随内容滚走。 */}
            <div className="px-5 py-4 lg:h-full lg:px-6">{body()}</div>
            {previewStep && data && (
                <LibTVStepMediaDialog
                    key={previewStep.id}
                    step={previewStep}
                    steps={data.steps}
                    index={data.steps.indexOf(previewStep)}
                    onClose={() => setPreviewStepId(undefined)}
                    onMakeSame={() => handleMakeSame(previewStep)}
                />
            )}
        </>
    );
}

/** 直接链接 /inspiration/:templateUuid 仍可用；推荐栏与列表页同源，来自公开列表的前若干条。 */
export default function WorkDetailPage() {
    const { templateUuid } = useParams<{ templateUuid: string }>();
    const navigate = useNavigate();
    const { data, isLoading } = useQuery({
        queryKey: ["libtv-work-detail-recommend", templateUuid],
        queryFn: () => getLibTVGallery({ page: 1, pageSize: 12 }),
        enabled: Boolean(templateUuid),
    });

    if (!templateUuid) return null;
    const recommended = pickLibTVRecommendations(data?.items ?? [], templateUuid, 6);

    return (
        <WorkspacePage>
            <div className="mb-4">
                <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/inspiration")}>
                    返回灵感广场
                </Button>
            </div>
            <PageHeader title="作品详情" />
            <div className="pb-12">
                <WorkDetailPane templateUuid={templateUuid} recommended={recommended} onSelectWork={(item) => navigate(`/inspiration/${item.templateUuid}`)} onClose={() => navigate("/inspiration")} />
            </div>
        </WorkspacePage>
    );
}
