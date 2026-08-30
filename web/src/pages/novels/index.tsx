import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Input, InputNumber, Segmented, Select, Tooltip } from "antd";
import { ArrowUpRight, BookOpenText, Clapperboard, Pause, Play, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { ModelPicker } from "@/components/model-picker";
import { settingsPath } from "@/lib/settings-navigation";
import { backendProviderConfig } from "@/services/api/generation-task";
import {
    listNovelWorkbenchRuns,
    pauseNovelWorkbench,
	 rebuildNovelWorkbench,
    resumeNovelWorkbench,
    startNovelWorkbench,
    type NovelWorkbenchMode,
    type NovelWorkbenchRunSummary,
    type StartNovelWorkbenchInput,
} from "@/services/api/novel-workbench";
import { logicalModelIDForConfig, modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

type WorkbenchDraft = {
    projectName: string;
    premise: string;
    outputMode: NovelWorkbenchMode;
    genre: string[];
    audience: string[];
    targetUnitCount: number;
    targetUnitLength: number;
    unitDurationSeconds: number;
    tone: string;
    endingDirection: string;
    structurePreference: string;
    customRequirements: string;
};

const initialDraft: WorkbenchDraft = {
    projectName: "",
    premise: "",
    outputMode: "screenplay",
    genre: [],
    audience: [],
    targetUnitCount: 80,
    targetUnitLength: 900,
    unitDurationSeconds: 90,
    tone: "",
    endingDirection: "",
    structurePreference: "",
    customRequirements: "",
};

// 保留一个清晰的主类型，再补充少量卖点，避免作品承诺过于分散。
const GENRE_SELECTION_LIMIT = 3;
const AUDIENCE_SELECTION_LIMIT = 2;

const genreOptions = [
    "古装", "都市", "年代", "校园", "家庭伦理", "悬疑", "奇幻", "重生逆袭", "复仇反杀", "甜宠爱情", "豪门恩怨", "职场成长", "轻喜剧",
].map((value) => ({ label: value, value }));

const audienceOptions = [
    "女性情感向", "女性爽感向", "男性逆袭向", "年轻都市人群", "成熟情感人群", "家庭共看人群", "悬疑反转偏好", "轻松解压偏好",
].map((value) => ({ label: value, value }));

const endingDirectionOptions = [
    "圆满反杀", "苦尽甘来", "携手成长", "开放式代价", "悲剧余韵", "悬念留白",
].map((value) => ({ label: value, value }));

const statusStyle: Record<string, string> = {
    queued: "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    running: "border-sky-400/30 bg-sky-400/10 text-sky-700 dark:text-sky-300",
    paused: "border-foreground/15 bg-foreground/5 text-foreground/65",
    completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
    failed: "border-rose-400/30 bg-rose-400/10 text-rose-700 dark:text-rose-300",
    archived: "border-foreground/15 bg-foreground/5 text-foreground/55",
};

function statusLabel(status: string) {
    return ({ queued: "排队中", running: "创作中", paused: "已暂停", completed: "已完成", failed: "等待恢复", archived: "只读快照" } as Record<string, string>)[status] || status;
}

function modeLabel(mode: string) {
    return mode === "novel" ? "小说正文" : "短剧剧本";
}

function unitLabel(mode: string) {
    return mode === "novel" ? "章" : "集";
}

function isActive(run: NovelWorkbenchRunSummary) {
    return run.run.status === "queued" || run.run.status === "running";
}

export default function NovelsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const [composerOpen, setComposerOpen] = useState(false);
    const [draft, setDraft] = useState<WorkbenchDraft>(initialDraft);
    const [selectedModel, setSelectedModel] = useState("");

    const runsQuery = useQuery({
        queryKey: ["novel-workbench", "runs"],
        queryFn: listNovelWorkbenchRuns,
        refetchInterval: (query) => query.state.data?.runs.some(isActive) ? 2_500 : false,
    });
    const runs = runsQuery.data?.runs || [];

    const createRuntimeConfig = () => {
        const textModel = selectedModel || effectiveConfig.textModel;
        if (!textModel || !effectiveConfig.textModels.includes(textModel)) {
            throw new Error(textModel ? `模型 ${textModel} 未在文本模型列表中` : "请先选择可用的文本模型");
        }
        const runtimeConfig = { ...effectiveConfig, model: textModel, textModel };
        return {
            config: backendProviderConfig(runtimeConfig, "text") as Record<string, unknown>,
            logicalModelId: logicalModelIDForConfig(runtimeConfig),
        };
    };

    const createMutation = useMutation({
        mutationFn: (input: StartNovelWorkbenchInput) => startNovelWorkbench(input),
        onSuccess: ({ project }) => {
            setComposerOpen(false);
            setDraft((current) => ({ ...initialDraft, outputMode: current.outputMode }));
            void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] });
            message.success(`已建立《${project.name}》的总控任务`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "创建创作任务失败"),
    });
    const pauseMutation = useMutation({
        mutationFn: pauseNovelWorkbench,
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] }),
        onError: (error) => message.error(error instanceof Error ? error.message : "暂停失败"),
    });
    const resumeMutation = useMutation({
        mutationFn: (projectId: string) => {
            const runtime = createRuntimeConfig();
            return resumeNovelWorkbench(projectId, runtime);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] });
            message.success("已恢复创作队列");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "恢复失败"),
    });
	const rebuildMutation = useMutation({
		mutationFn: (projectId: string) => {
			const runtime = createRuntimeConfig();
			return rebuildNovelWorkbench(projectId, runtime);
		},
		onSuccess: ({ project }) => {
			void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] });
			message.success(`已建立《${project.name}》的强控制版本`);
			navigate(`/novels/${project.id}/control`);
		},
		onError: (error) => message.error(error instanceof Error ? error.message : "重建失败"),
	});

    const textModel = selectedModel || effectiveConfig.textModel;
    const selectedModelName = textModel ? modelDisplayName(effectiveConfig, textModel) : "未选择文本模型";
    const activeCount = useMemo(() => runs.filter(isActive).length, [runs]);
    const updateDraft = <Key extends keyof WorkbenchDraft>(key: Key, value: WorkbenchDraft[Key]) => setDraft((current) => ({ ...current, [key]: value }));

    const start = () => {
        if (!draft.premise.trim()) {
            message.warning("先写下故事起点");
            return;
        }
        let runtime: { config: Record<string, unknown>; logicalModelId: string };
        try {
            runtime = createRuntimeConfig();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "文本模型不可用");
            return;
        }
        createMutation.mutate({
            ...draft,
            projectName: draft.projectName.trim(),
            premise: draft.premise.trim(),
            tone: draft.tone.trim(),
            endingDirection: draft.endingDirection.trim(),
            structurePreference: draft.structurePreference.trim(),
            customRequirements: draft.customRequirements.trim(),
            aspectRatio: "9:16",
            ...runtime,
        });
    };

    return (
        <WorkspacePage className="library-page" grid>
            <PageHeader
                title="小说工作台"
                description="小说正文与短剧剧本"
                meta={activeCount ? <span className="rounded-md border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">{activeCount} 个进行中</span> : undefined}
                actions={<Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setComposerOpen(true)}>新建创作</Button>}
            />

            {runsQuery.isPending ? <WorkspaceLoadingState label="正在载入创作项目" rows={2} /> : null}
            {runsQuery.isError ? <WorkspaceErrorState description={runsQuery.error instanceof Error ? runsQuery.error.message : "无法读取小说工作台"} onRetry={() => void runsQuery.refetch()} /> : null}
            {!runsQuery.isPending && !runsQuery.isError && !runs.length ? (
                <section className="mt-4 flex min-h-72 flex-col items-center justify-center border border-dashed border-foreground/15 px-5 text-center">
                    <span className="grid size-11 place-items-center rounded-md bg-foreground/5 text-foreground/65"><BookOpenText className="size-5" /></span>
                    <h2 className="mt-4 text-base font-semibold">开始一个作品</h2>
                    <Button className="mt-4" type="primary" icon={<Sparkles className="size-3.5" />} onClick={() => setComposerOpen(true)}>建立总控档案</Button>
                </section>
            ) : null}
            {runs.length ? <section className="mt-4 grid gap-3 xl:grid-cols-2" aria-label="创作项目列表">
				{runs.map((item) => <RunCard key={item.run.id} item={item} onOpen={() => navigate(`/novels/${item.project.id}/control`)} onPause={() => pauseMutation.mutate(item.project.id)} onResume={() => resumeMutation.mutate(item.project.id)} onRebuild={() => rebuildMutation.mutate(item.project.id)} pausing={pauseMutation.isPending && pauseMutation.variables === item.project.id} resuming={resumeMutation.isPending && resumeMutation.variables === item.project.id} rebuilding={rebuildMutation.isPending && rebuildMutation.variables === item.project.id} />)}
            </section> : null}

            <Drawer title="新建创作" size="large" open={composerOpen} onClose={() => !createMutation.isPending && setComposerOpen(false)} extra={<Button type="primary" icon={<Play className="size-3.5" />} loading={createMutation.isPending} onClick={start}>开始创作</Button>}>
                <div className="space-y-5 pb-8">
                    <Segmented
                        block
                        value={draft.outputMode}
                        onChange={(value) => updateDraft("outputMode", value as NovelWorkbenchMode)}
                        options={[
                            { value: "screenplay", label: <span className="inline-flex items-center gap-1.5"><Clapperboard className="size-3.5" />短剧剧本</span> },
                            { value: "novel", label: <span className="inline-flex items-center gap-1.5"><BookOpenText className="size-3.5" />小说正文</span> },
                        ]}
                    />
                    <Field label="作品名"><Input value={draft.projectName} maxLength={60} placeholder="可留空，由故事起点生成" onChange={(event) => updateDraft("projectName", event.target.value)} /></Field>
                    <Field label="故事起点" required><Input.TextArea value={draft.premise} autoSize={{ minRows: 5, maxRows: 10 }} placeholder="人物、想得到什么、阻力和最重要的秘密。" onChange={(event) => updateDraft("premise", event.target.value)} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={`题材（最多 ${GENRE_SELECTION_LIMIT} 项）`}><Select className="w-full" mode="multiple" maxCount={GENRE_SELECTION_LIMIT} value={draft.genre} placeholder="选一个主类型，再补充一到两个卖点" options={genreOptions} onChange={(values) => updateDraft("genre", values as string[])} /></Field>
                        <Field label={`目标${unitLabel(draft.outputMode)}数`}><InputNumber className="w-full" min={1} max={500} value={draft.targetUnitCount} onChange={(value) => updateDraft("targetUnitCount", Number(value || 1))} /></Field>
                        <Field label={`单${unitLabel(draft.outputMode)}目标字数`}><InputNumber className="w-full" min={200} max={12_000} step={100} value={draft.targetUnitLength} onChange={(value) => updateDraft("targetUnitLength", Number(value || 200))} /></Field>
                        {draft.outputMode === "screenplay" ? <Field label="单集目标时长"><InputNumber className="w-full" min={15} max={1_800} step={15} addonAfter="秒" value={draft.unitDurationSeconds} onChange={(value) => updateDraft("unitDurationSeconds", Number(value || 15))} /></Field> : null}
                        <Field label={`受众（最多 ${AUDIENCE_SELECTION_LIMIT} 项）`}><Select className="w-full" mode="multiple" maxCount={AUDIENCE_SELECTION_LIMIT} value={draft.audience} placeholder="先选核心受众，必要时再选次受众" options={audienceOptions} onChange={(values) => updateDraft("audience", values as string[])} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="叙事结构"><Select className="w-full" value={draft.structurePreference || undefined} placeholder="选择或留空" allowClear onChange={(value) => updateDraft("structurePreference", value || "")} options={["单线推进", "双线并行", "多线群像", "悬念反转"].map((value) => ({ label: value, value }))} /></Field>
                        <Field label="整体基调"><Select className="w-full" value={draft.tone || undefined} placeholder="选择或留空" allowClear onChange={(value) => updateDraft("tone", value || "")} options={["强情绪", "甜宠治愈", "紧张悬疑", "轻喜剧", "现实向"].map((value) => ({ label: value, value }))} /></Field>
                    </div>
                    <Field label="结局方向"><Select className="w-full" value={draft.endingDirection || undefined} placeholder="选择或留空" allowClear options={endingDirectionOptions} onChange={(value) => updateDraft("endingDirection", value || "")} /></Field>
                    <Field label="额外要求"><Input.TextArea value={draft.customRequirements} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="人物关系、禁忌、节奏或其他不能违背的设定。" onChange={(event) => updateDraft("customRequirements", event.target.value)} /></Field>
                    <div className="border-t border-foreground/10 pt-4">
                        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium">文本模型</span><button type="button" className="text-xs text-foreground/55 underline-offset-2 hover:underline" onClick={() => navigate(settingsPath("models"))}>模型设置</button></div>
                        <ModelPicker config={effectiveConfig} value={textModel} onChange={setSelectedModel} capability="text" variant="creation" placeholder="选择文本模型" showSelectedPrice={false} />
                        <p className="mt-2 text-xs text-foreground/50">当前：{selectedModelName}</p>
                    </div>
                </div>
            </Drawer>
        </WorkspacePage>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
    return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required ? <span className="ml-0.5 text-rose-500">*</span> : null}</span>{children}</label>;
}

function RunCard({ item, onOpen, onPause, onResume, onRebuild, pausing, resuming, rebuilding }: { item: NovelWorkbenchRunSummary; onOpen: () => void; onPause: () => void; onResume: () => void; onRebuild: () => void; pausing: boolean; resuming: boolean; rebuilding: boolean }) {
    const { run, project, title, logline, currentArc } = item;
    const label = unitLabel(run.outputMode);
    const nextUnit = Math.min(run.targetUnitCount, Math.max(1, run.completedUnitCount + 1));
    const primaryTitle = title || project.name;
    const active = isActive(item);
    const qualityBlocked = run.status === "failed" && run.pipelineStage === "quality_blocked";
    const statusNote = active ? run.stage : qualityBlocked ? run.qualityBlockReason : run.lastError || run.stage;
    return (
        <article className="rounded-lg border border-foreground/10 bg-surface p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/70">{run.outputMode === "novel" ? <BookOpenText className="size-4" /> : <Clapperboard className="size-4" />}</span>
                    <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{primaryTitle}</h2><p className="mt-0.5 text-xs text-foreground/50">{modeLabel(run.outputMode)}</p></div>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusStyle[run.status] || statusStyle.paused}`}>{statusLabel(run.status)}</span>
            </div>
            {logline ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-foreground/65">{logline}</p> : <p className="mt-3 line-clamp-2 text-sm leading-6 text-foreground/65">{project.description}</p>}
            <div className="mt-4 grid grid-cols-3 divide-x divide-foreground/10 border-y border-foreground/10 py-2.5 text-center">
                <div><div className="text-sm font-semibold">{run.completedUnitCount}/{run.targetUnitCount}</div><div className="mt-0.5 text-[11px] text-foreground/48">已完成{label}</div></div>
                <div><div className="truncate px-2 text-sm font-semibold">{run.status === "completed" ? "完成" : `第 ${nextUnit} ${label}`}</div><div className="mt-0.5 text-[11px] text-foreground/48">当前进度</div></div>
                <Tooltip title={currentArc || "总控档案生成后显示"}><div><div className="truncate px-2 text-sm font-semibold">{currentArc || "准备中"}</div><div className="mt-0.5 text-[11px] text-foreground/48">当前分部</div></div></Tooltip>
            </div>
			<div className="mt-3 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs text-foreground/48">{statusNote}</span><div className="flex shrink-0 items-center gap-1.5"><Button size="small" type="text" icon={<ArrowUpRight className="size-3.5" />} onClick={onOpen}>控制台</Button>{run.engineVersion && run.engineVersion >= 2 ? <Tooltip title="强控制系统：档案、账本、审稿与提交记录已启用"><ShieldCheck className="size-4 text-emerald-500" /></Tooltip> : run.status === "archived" ? <Tooltip title="重建前快照仅供查看"><ShieldCheck className="size-4 text-foreground/40" /></Tooltip> : <Button size="small" type="text" icon={<ShieldCheck className="size-3.5" />} loading={rebuilding} onClick={onRebuild}>强控重建</Button>}{active ? <Button size="small" icon={<Pause className="size-3.5" />} loading={pausing} onClick={onPause}>暂停</Button> : null}{run.status === "paused" || run.status === "failed" ? <Button size="small" type="primary" icon={<Play className="size-3.5" />} loading={resuming} onClick={onResume}>恢复</Button> : null}</div></div>
        </article>
    );
}
