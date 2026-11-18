import { App, Button, Popover, Tooltip } from "antd";
import { BookOpen, Download, FileImage, LoaderCircle, Pencil, RefreshCw, RotateCcw, Sparkles, Trash2, TriangleAlert, UserRoundPlus, X } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { GenerationImagePreview } from "@/components/ai/generation-image-preview";
import { CreationMediaPending } from "@/pages/create/creation-workspace-messages";
import { generationErrorMessage } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { resourceFileUrl } from "@/services/api/resources";
import type { EcommercePlanImage } from "@/services/api/ecommerce";
import type { GenerationTask } from "@/services/api/task-center";

import { startEcommerceDownload } from "../export";
import { TryOnFunctionDemo, TRYON_EMPTY_TIPS } from "./tryon-demos";
import { TryOnGlyph } from "./tryon-glyphs";
import { TryOnImageViewer } from "./tryon-image-viewer";
import { tryOnFunction, type TryOnFunction, type TryOnSlotKey } from "./tryon-kinds";
import { downloadPrintPng } from "./tryon-print";
import { outputResourceId } from "./tryon-runtime";
import type { TryOnBatch, TryOnJob } from "./tryon-store";
import type { TryOnState } from "./use-tryon";

type Filter = "all" | "running" | "done" | "failed";
type JobStatus = "waiting" | "submitting" | "running" | "done" | "failed";
type JobView = { status: JobStatus; progress?: number; stage?: string; error?: string; resourceId?: string };

function jobView(job: TryOnJob, tasks: Record<string, GenerationTask>): JobView {
    if (job.state === "failed" && !job.taskId) return { status: "failed", error: job.error };
    if (job.state === "waiting") return { status: "waiting" };
    if (job.state === "submitting") return { status: "submitting" };
    const task = job.taskId ? tasks[job.taskId] : undefined;
    if (!task) return { status: "running", stage: "正在读取任务状态" };
    if (task.status === "succeeded") {
        const resourceId = outputResourceId(task);
        return resourceId ? { status: "done", resourceId } : { status: "running", stage: "正在保存成片" };
    }
    if (task.status === "failed" || task.status === "cancelled") return { status: "failed", error: task.status === "cancelled" ? "任务已取消" : generationErrorMessage(task.error) || "生成失败" };
    // 进度为 0–100；保存成片等阶段不显示进度条，只显示阶段文案。
    return { status: "running", progress: generationTaskShowsProgress(task) && typeof task.progress === "number" ? task.progress : undefined, stage: generationTaskStageLabel(task) };
}

function batchCounts(batch: TryOnBatch, tasks: Record<string, GenerationTask>) {
    const result = { total: 0, running: 0, done: 0, failed: 0 };
    for (const job of batch.jobs) {
        if (job.hidden) continue;
        result.total += 1;
        const status = jobView(job, tasks).status;
        if (status === "done") result.done += 1;
        else if (status === "failed") result.failed += 1;
        else result.running += 1;
    }
    if (batch.planning?.state === "running") result.running += 1;
    return result;
}

function timeLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return date.toDateString() === new Date().toDateString() ? `今天 ${time}` : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function aspectOf(value?: string) {
    const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(value || "");
    return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? `${match[1]} / ${match[2]}` : "3 / 4";
}

function jobStyle(aspect: string, index: number): CSSProperties {
    const [width, height] = aspect.split(" / ").map(Number);
    return { "--i": index, "--ect-aspect": width / height } as CSSProperties;
}

/** 换脸读图面板：识别原图发型 → 裁出五官 → 出图。 */
function FaceReadPanel({ batch, task }: { batch: TryOnBatch; task?: GenerationTask }) {
    const planning = batch.planning!;
    const step = planning.state !== "running" ? 3 : !planning.taskId || !task || task.status === "queued" ? 0 : task.status === "succeeded" ? 2 : 1;
    const steps = ["准备读图", "识别原图发型与脸部五官区域", "裁出五官，生成只换脸的提示词"];
    return (
        <div className={`ect-planning is-${planning.state}`} role="status" aria-live="polite">
            <header>
                <span className="ecv-glyph-tile is-replace ect-planning-mark">
                    <Sparkles size={16} />
                </span>
                <span>
                    <strong>{planning.state === "running" ? "Agent 正在识别原图发型" : planning.state === "done" ? "已锁定原图发型，只换五官" : "读图未完成，已直接按提示词换脸"}</strong>
                    <small>{planning.state === "failed" ? planning.error : "原图头发写成文字锁定，脸部图只保留五官区域"}</small>
                </span>
            </header>
            {planning.state === "running" ? (
                <ol className="ect-planning-steps">
                    {steps.map((label, index) => (
                        <li key={label} data-state={index < step ? "done" : index === step ? "active" : "todo"}>
                            {index < step ? <span className="ect-step-dot is-done">✓</span> : index === step ? <LoaderCircle size={13} className="commerce-planning-spin" /> : <span className="ect-step-dot" />}
                            {label}
                        </li>
                    ))}
                </ol>
            ) : null}
        </div>
    );
}

/** Agent 规划面板：分析服装 → 检索后台知识库 → 规划每张场景。 */
function PlanningPanel({ batch, task }: { batch: TryOnBatch; task?: GenerationTask }) {
    const planning = batch.planning!;
    const face = batch.fn === "face-swap" || batch.fn === "smart-face";
    if (face) return <FaceReadPanel batch={batch} task={task} />;
    const step = planning.state !== "running" ? 3 : !planning.knowledgeSource ? 0 : !planning.taskId || !task || task.status === "queued" ? 1 : 2;
    const pose = batch.fn === "pose";
    const steps = pose ? ["检索姿势与人体知识", "识别主体、动作与拍摄角度", `逐张理解 ${batch.source.count} 张姿势与用户要求`] : ["检索后台电商知识库", "识别服装品类、风格与季节", `规划 ${batch.source.count} 张的场景、姿势与机位`];
    const garment = planning.garment;
    return (
        <div className={`ect-planning is-${planning.state}`} role="status" aria-live="polite">
            <header>
                <span className="ecv-glyph-tile is-replace ect-planning-mark">
                    <Sparkles size={16} />
                </span>
                <span>
                    <strong>
                        {pose
                            ? planning.state === "running"
                                ? "Agent 正在理解姿势与视角"
                                : planning.state === "done"
                                  ? "Agent 已完成姿势理解"
                                  : "姿势分析未完成，已暂停出图"
                            : planning.state === "running"
                              ? "Agent 正在规划多场景"
                              : planning.state === "done"
                                ? "Agent 已完成多场景规划"
                                : "Agent 规划未完成，已按内置场景库出图"}
                    </strong>
                    <small>
                        {planning.state === "failed"
                            ? planning.error
                            : planning.knowledgeSource === "backend"
                              ? `参考后台知识库 ${planning.knowledgeEntries?.length || 0} 条与内置服饰知识`
                              : planning.knowledgeSource === "builtin"
                                ? "后台知识库暂不可用，已使用内置服饰知识"
                                : "正在准备知识库"}
                    </small>
                </span>
            </header>
            {planning.state === "running" ? (
                <ol className="ect-planning-steps">
                    {steps.map((label, index) => (
                        <li key={label} data-state={index < step ? "done" : index === step ? "active" : "todo"}>
                            {index < step ? <span className="ect-step-dot is-done">✓</span> : index === step ? <LoaderCircle size={13} className="commerce-planning-spin" /> : <span className="ect-step-dot" />}
                            {label}
                        </li>
                    ))}
                </ol>
            ) : null}
            {garment && (garment.category || garment.style) ? (
                <p className="ect-planning-garment">
                    {[garment.category, garment.style, garment.season, garment.colors].filter(Boolean).join(" · ")}
                    {garment.details ? <small>{garment.details}</small> : null}
                </p>
            ) : null}
            {planning.knowledgeEntries?.length ? (
                <Popover
                    trigger={["hover", "click"]}
                    placement="bottomLeft"
                    arrow={false}
                    classNames={{ root: "ect-knowledge-popover" }}
                    content={
                        <ul className="ect-knowledge-list">
                            {planning.knowledgeEntries.map((entry) => (
                                <li key={entry.id}>{entry.title}</li>
                            ))}
                        </ul>
                    }
                >
                    <button type="button" className="ect-knowledge-chip">
                        <BookOpen size={12} /> 查看参考的知识条目
                    </button>
                </Popover>
            ) : null}
        </div>
    );
}

function JobCard({ batch, job, view, state, onOpen, onUseAsInput }: { batch: TryOnBatch; job: TryOnJob; view: JobView; state: TryOnState; onOpen: () => void; onUseAsInput?: (resourceId: string) => void }) {
    const { message } = App.useApp();
    const [exporting, setExporting] = useState(false);
    const [loadedAspect, setLoadedAspect] = useState<{ resourceId: string; ratio: string } | null>(null);
    const aspect = loadedAspect && loadedAspect.resourceId === view.resourceId ? loadedAspect.ratio : aspectOf(job.size && job.size !== "auto" ? job.size : batch.ratio !== "auto" ? batch.ratio : undefined);
    const print = batch.fn === "print";
    const name = `${tryOnFunction(batch.fn).label}-${job.title}`;
    const task = job.taskId ? state.tasks[job.taskId] : undefined;
    const pending = (
        <div className="generation-pending-host">
            <CreationMediaPending
                item={{
                    id: job.key,
                    role: "assistant",
                    mode: "image",
                    content: "",
                    createdAt: task?.createdAt || batch.createdAt,
                    taskIds: job.taskId ? [job.taskId] : undefined,
                    generationStatus: task?.status,
                    generationStage: task?.stage,
                    generationMediaStage: task?.mediaStage,
                    generationProgress: task?.progress,
                    settings: { ratio: aspect.replace(" / ", ":"), seconds: "", quality: "", videoQuality: "", count: "1" },
                }}
                refreshing={false}
                onRefresh={() => {}}
                onRetry={() => {}}
            />
        </div>
    );
    // 单独图案在浏览器里去掉纯白底导出透明 PNG；平铺展开与四方连续直接下载模型原图。
    const transparentPrint = print && (batch.printMode || "motif") === "motif";
    const exportPrint = () => {
        if (!view.resourceId) return;
        setExporting(true);
        void downloadPrintPng(view.resourceId, "motif", name)
            .then((transparent) => message.success(transparent ? "已导出透明底 PNG" : "已导出 PNG（未识别到纯色底，保留原背景）"))
            .catch((cause) => message.error(cause instanceof Error ? cause.message : "导出失败"))
            .finally(() => setExporting(false));
    };
    return (
        <article className={`ect-job is-${view.status}`} style={jobStyle(aspect, job.index)}>
            <div className="ect-job-media" style={{ aspectRatio: aspect }}>
                {view.status === "done" && view.resourceId ? (
                    <button type="button" className="ect-job-open" onClick={onOpen} aria-label={`查看 ${job.title}`}>
                        <img
                            src={resourceFileUrl(view.resourceId)}
                            alt={job.title}
                            loading="lazy"
                            decoding="async"
                            onLoad={(event) => {
                                const image = event.currentTarget;
                                if (image.naturalWidth > 0 && image.naturalHeight > 0) setLoadedAspect({ resourceId: view.resourceId!, ratio: `${image.naturalWidth} / ${image.naturalHeight}` });
                            }}
                        />
                    </button>
                ) : view.status !== "failed" ? (
                    task?.previewUrl ? (
                        <GenerationImagePreview src={task.previewUrl} alt={job.title}>
                            {pending}
                        </GenerationImagePreview>
                    ) : (
                        pending
                    )
                ) : (
                    <div className="ect-job-pending">
                        <TriangleAlert size={20} />
                        <span>生成失败</span>
                    </div>
                )}
                {view.status === "failed" ? (
                    <div className="ecv-result-banner is-failed">
                        <span>{view.error || "生成失败"}</span>
                        <Button size="small" type="primary" icon={<RotateCcw size={12} />} onClick={() => void state.retry(batch.id, job.key)}>
                            重试
                        </Button>
                    </div>
                ) : null}
                {view.status === "done" && view.resourceId ? (
                    <div className="ect-job-actions">
                        {transparentPrint ? (
                            <Tooltip title="下载透明底 PNG">
                                <button type="button" disabled={exporting} onClick={exportPrint}>
                                    {exporting ? <LoaderCircle size={13} className="commerce-planning-spin" /> : <FileImage size={13} />}
                                    PNG
                                </button>
                            </Tooltip>
                        ) : (
                            <Tooltip title={print ? "下载印花图（模型原图）" : "下载原图"}>
                                <a href={`${resourceFileUrl(view.resourceId)}?download=1`} download aria-label="下载原图">
                                    <Download size={13} />
                                </a>
                            </Tooltip>
                        )}
                        {onUseAsInput && !print ? (
                            <Tooltip title="用这张继续换装（放进模特位）">
                                <button type="button" aria-label="用作模特" onClick={() => onUseAsInput(view.resourceId!)}>
                                    <UserRoundPlus size={13} />
                                </button>
                            </Tooltip>
                        ) : null}
                        {!batch.remote ? (
                            <Tooltip title="再生成一版">
                                <button type="button" aria-label="再生成一版" onClick={() => state.regenerate(batch.id, job.key)}>
                                    <RefreshCw size={13} />
                                </button>
                            </Tooltip>
                        ) : null}
                        <Tooltip title="从作品区移除（资产库保留）">
                            <button type="button" aria-label="移除" onClick={() => state.hideJob(batch.id, job.key)}>
                                <X size={13} />
                            </button>
                        </Tooltip>
                    </div>
                ) : null}
            </div>
            <footer>
                <strong>{job.title}</strong>
                {job.caption ? <small title={job.caption}>{job.caption}</small> : null}
            </footer>
        </article>
    );
}

function BatchCard({ batch, state, onOpen, onUseAsInput, onEdit }: { batch: TryOnBatch; state: TryOnState; onOpen: (batch: TryOnBatch, index: number) => void; onUseAsInput?: (resourceId: string) => void; onEdit: (batch: TryOnBatch) => void }) {
    const { modal, message } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const confirmDelete = () =>
        modal.confirm({
            title: "删除这批作品？",
            content: "这批作品及资产库中对应的生成资产将永久删除，刷新后也不会恢复。上传的原图和参考素材保留。",
            okText: "删除批次及资产",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setDeleting(true);
                try {
                    await state.removeBatch(batch.id);
                } catch (cause) {
                    void message.error(cause instanceof Error ? cause.message : "删除未完成，请重试");
                    throw cause;
                } finally {
                    setDeleting(false);
                }
            },
        });
    const counts = batchCounts(batch, state.tasks);
    const notice = state.notices[batch.id];
    const visible = batch.jobs.filter((job) => !job.hidden);
    const views = visible.map((job) => jobView(job, state.tasks));
    const doneIds = views.flatMap((view) => (view.status === "done" && view.resourceId ? [view.resourceId] : []));
    const config = tryOnFunction(batch.fn);
    const planningTask = batch.planning?.taskId ? state.tasks[batch.planning.taskId] : undefined;
    const downloadAll = () => startEcommerceDownload(doneIds.map((resourceId, index) => ({ image: { imageType: "single" } as EcommercePlanImage, assetId: "", index, resourceId })));
    return (
        <article className="ect-batch" data-fn={batch.fn}>
            <header className="ect-batch-head">
                <span className={`ecv-kind-icon is-${batch.fn} ect-batch-icon`} aria-hidden="true">
                    <TryOnGlyph id={batch.fn} />
                </span>
                <span className="ect-batch-title">
                    <strong>{batch.summary || config.label}</strong>
                    <small>
                        {[batch.modelLabel, batch.ratio === "auto" ? "比例跟随原图" : batch.ratio, batch.resolution?.toUpperCase()].filter(Boolean).join(" · ")}
                        {counts.total ? ` · ${counts.done}/${counts.total} 张` : ""}
                    </small>
                </span>
                <time>{timeLabel(batch.createdAt)}</time>
                <span className="ect-batch-tools">
                    {!batch.remote ? (
                        <Tooltip title="用这批的设置重新编辑">
                            <Button size="small" type="text" icon={<Pencil size={13} />} onClick={() => onEdit(batch)} />
                        </Tooltip>
                    ) : null}
                    {doneIds.length > 1 ? (
                        <Tooltip title={`下载已完成的 ${doneIds.length} 张`}>
                            <Button size="small" type="text" icon={<Download size={13} />} onClick={downloadAll} />
                        </Tooltip>
                    ) : null}
                    <Tooltip title={counts.running ? "仍有图片在生成，完成后可删除" : "删除这批作品及对应资产"}>
                        <Button size="small" type="text" danger aria-label="删除批次" icon={<Trash2 size={13} />} loading={deleting} disabled={counts.running > 0} onClick={confirmDelete} />
                    </Tooltip>
                </span>
            </header>
            {batch.planning ? <PlanningPanel batch={batch} task={planningTask} /> : null}
            {batch.fn === "pose" && batch.planning?.state === "failed" ? (
                <Button onClick={() => onEdit(batch)} icon={<Pencil size={14} />}>
                    调整素材后重新分析
                </Button>
            ) : null}
            {notice ? (
                <div className={`ect-batch-notice${notice.paused ? " is-paused" : ""}`} role="status">
                    <span>{notice.text}</span>
                    {notice.paused ? (
                        <Button size="small" type="primary" onClick={() => state.continueBatch(batch.id)}>
                            继续提交
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {visible.length ? (
                <div className="ect-job-grid" data-multiple={visible.length > 1 || undefined}>
                    {visible.map((job, index) => (
                        <JobCard key={job.key} batch={batch} job={job} view={views[index]} state={state} onUseAsInput={onUseAsInput} onOpen={() => onOpen(batch, index)} />
                    ))}
                </div>
            ) : batch.planning?.state === "running" ? (
                <div className="ect-job-grid" data-multiple={batch.source.count > 1 || undefined}>
                    {Array.from({ length: Math.min(batch.source.count, 6) }, (_, index) => (
                        <article key={index} className="ect-job is-waiting is-ghost" style={jobStyle(aspectOf(batch.ratio), index)}>
                            <div className="ect-job-media" style={{ aspectRatio: aspectOf(batch.ratio) }}>
                                <div className="generation-pending-host">
                                    <CreationMediaPending
                                        item={{
                                            id: `${batch.id}-${index}`,
                                            role: "assistant",
                                            mode: "image",
                                            content: "",
                                            createdAt: batch.createdAt,
                                            settings: { ratio: aspectOf(batch.ratio).replace(" / ", ":"), seconds: "", quality: "", videoQuality: "", count: "1" },
                                        }}
                                        refreshing={false}
                                        onRefresh={() => {}}
                                        onRetry={() => {}}
                                    />
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            ) : null}
        </article>
    );
}

export function TryOnResults({
    state,
    onPickFunction,
    onUseAsInput,
    onEdit,
    activeSlot,
}: {
    state: TryOnState;
    onPickFunction: (id: TryOnFunction) => void;
    onUseAsInput: (resourceId: string, slot: TryOnSlotKey) => void;
    onEdit: (batch: TryOnBatch) => void;
    activeSlot: TryOnSlotKey | null;
}) {
    const [filter, setFilter] = useState<Filter>("all");
    const [viewer, setViewer] = useState<{ batchId: string; index: number } | null>(null);
    const totals = useMemo(() => {
        const result = { done: 0, running: 0, failed: 0 };
        for (const batch of state.shown) {
            const counts = batchCounts(batch, state.tasks);
            result.done += counts.done;
            result.running += counts.running;
            result.failed += counts.failed;
        }
        return result;
    }, [state.shown, state.tasks]);
    const visible = state.shown.filter((batch) => {
        if (filter === "all") return true;
        const counts = batchCounts(batch, state.tasks);
        return filter === "running" ? counts.running > 0 : filter === "done" ? counts.done > 0 : counts.failed > 0;
    });
    const viewerBatch = viewer ? state.batches.find((batch) => batch.id === viewer.batchId) : undefined;
    const viewerItems = viewerBatch
        ? viewerBatch.jobs
              .filter((job) => !job.hidden)
              .flatMap((job) => {
                  const view = jobView(job, state.tasks);
                  return view.status === "done" && view.resourceId ? [{ resourceId: view.resourceId, title: job.title, caption: job.caption, key: job.key }] : [];
              })
        : [];
    const tabs: Array<{ value: Filter; label: string }> = [
        { value: "all", label: "全部" },
        { value: "running", label: totals.running ? `进行中 · ${totals.running}` : "进行中" },
        { value: "done", label: totals.done ? `已完成 · ${totals.done}` : "已完成" },
        { value: "failed", label: "失败" },
    ];
    return (
        <section className="commerce-output-gallery ecv-results ect-results" aria-label="换装作品">
            <header className="ecv-results-head">
                <h2>
                    换装作品 <small>已完成 {totals.done} 张</small>
                </h2>
                <nav className="ecv-filter" aria-label="筛选换装作品">
                    {tabs.map((tab) => (
                        <button key={tab.value} type="button" aria-pressed={filter === tab.value} onClick={() => setFilter(tab.value)}>
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </header>
            <div className="ecv-results-scroll" data-canvas-wheel-scroll>
                {!state.batchesLoaded ? (
                    <p className="ecv-empty">正在读取换装作品…</p>
                ) : visible.length ? (
                    <div className="ect-batches">
                        {visible.map((batch) => (
                            <BatchCard
                                key={batch.id}
                                batch={batch}
                                state={state}
                                onEdit={onEdit}
                                onUseAsInput={activeSlot ? (resourceId) => onUseAsInput(resourceId, activeSlot) : undefined}
                                onOpen={(item, index) => {
                                    const doneBefore = item.jobs
                                        .filter((job) => !job.hidden)
                                        .slice(0, index + 1)
                                        .filter((job) => jobView(job, state.tasks).status === "done").length;
                                    setViewer({ batchId: item.id, index: Math.max(0, doneBefore - 1) });
                                }}
                            />
                        ))}
                        {state.hasMoreBatches && filter === "all" ? (
                            <Button className="ect-more" onClick={state.showMoreBatches}>
                                加载更早的作品
                            </Button>
                        ) : null}
                    </div>
                ) : filter !== "all" ? (
                    <div className="ecv-empty">
                        <strong>没有符合条件的作品</strong>
                    </div>
                ) : (
                    <div className="ect-empty">
                        <div className="commerce-output-empty-mark">
                            <Sparkles size={20} />
                        </div>
                        <strong>还没有换装作品</strong>
                        <span>选一个功能、上传素材后点「开始生成」，作品会按批次出现在这里，可直接下载或继续换装。</span>
                        <div className="ect-empty-grid">
                            {TRYON_EMPTY_TIPS.map((item, index) => (
                                <button key={item.id} type="button" className="ect-empty-card" style={{ "--i": index } as CSSProperties} onClick={() => onPickFunction(item.id)}>
                                    <TryOnFunctionDemo id={item.id} />
                                    <strong>{tryOnFunction(item.id).label}</strong>
                                    <small>{item.tip}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {viewer && viewerItems.length ? <TryOnImageViewer items={viewerItems} index={Math.min(viewer.index, viewerItems.length - 1)} onClose={() => setViewer(null)} onIndex={(index) => setViewer({ ...viewer, index })} /> : null}
        </section>
    );
}
