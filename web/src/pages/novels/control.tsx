import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Collapse, Descriptions, Empty, Segmented, Spin, Tag, Tooltip } from "antd";
import { ArrowLeft, BookOpenText, Clapperboard, FileCheck2, ListChecks, Pause, Play, RefreshCcw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { backendProviderConfig } from "@/services/api/generation-task";
import {
    getNovelWorkbenchRun,
    pauseNovelWorkbench,
    rebuildNovelWorkbench,
    resumeNovelWorkbench,
    type NovelWorkbenchArtifact,
    type NovelWorkbenchControl,
    type NovelWorkbenchControlDocuments,
    type NovelWorkbenchDynamicState,
} from "@/services/api/novel-workbench";
import { logicalModelIDForConfig, modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

type ControlView = "canon" | "roadmap" | "ledger" | "units" | "audit";

type ControlCardAuditEntry = {
    artifact: NovelWorkbenchArtifact;
    audit: Record<string, unknown>;
};

type RepairPacketEntry = {
    artifact: NovelWorkbenchArtifact;
    packet: Record<string, unknown>;
};

const viewOptions = [
    {
        value: "canon",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <BookOpenText className="size-3.5" />
                控制档案
            </span>
        ),
    },
    {
        value: "roadmap",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ListChecks className="size-3.5" />
                路线图
            </span>
        ),
    },
    {
        value: "ledger",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ScrollText className="size-3.5" />
                承诺与伏笔
            </span>
        ),
    },
    {
        value: "units",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <FileCheck2 className="size-3.5" />
                单元质检
            </span>
        ),
    },
    {
        value: "audit",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                创作审计
            </span>
        ),
    },
];

export default function NovelControlPage() {
    const { projectId = "" } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [view, setView] = useState<ControlView>("canon");
    const textModel = config.textModel;
    const detailQuery = useQuery({
        queryKey: ["novel-workbench", "run", projectId],
        queryFn: () => getNovelWorkbenchRun(projectId),
        enabled: Boolean(projectId),
        refetchInterval: (query) => {
            const status = query.state.data?.run.status;
            return status === "queued" || status === "running" ? 2_500 : false;
        },
    });
    const runtime = () => {
        if (!textModel || !config.textModels.includes(textModel)) throw new Error("请先在模型设置中选择可用的文本模型");
        const effective = { ...config, model: textModel, textModel };
        return { config: backendProviderConfig(effective, "text") as Record<string, unknown>, logicalModelId: logicalModelIDForConfig(effective) };
    };
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "run", projectId] });
    const pause = useMutation({ mutationFn: () => pauseNovelWorkbench(projectId), onSuccess: refresh, onError: (error) => message.error(error instanceof Error ? error.message : "暂停失败") });
    const resume = useMutation({ mutationFn: () => resumeNovelWorkbench(projectId, runtime()), onSuccess: refresh, onError: (error) => message.error(error instanceof Error ? error.message : "恢复失败") });
    const rebuild = useMutation({
        mutationFn: () => rebuildNovelWorkbench(projectId, runtime()),
        onSuccess: ({ project }) => {
            message.success("已进入强控制重建流程");
            navigate(`/novels/${project.id}/control`, { replace: true });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "重建失败"),
    });

    if (detailQuery.isPending)
        return (
            <WorkspacePage>
                <div className="grid min-h-80 place-items-center">
                    <Spin tip="正在读取创作控制档案" />
                </div>
            </WorkspacePage>
        );
    if (detailQuery.isError || !detailQuery.data)
        return (
            <WorkspacePage>
                <WorkspaceErrorState description={detailQuery.error instanceof Error ? detailQuery.error.message : "无法读取创作控制档案"} onRetry={() => void detailQuery.refetch()} />
            </WorkspacePage>
        );

    const { run, project, control, dynamicState, artifacts } = detailQuery.data;
    const v2 = (run.engineVersion || 0) >= 2;
    const active = run.status === "queued" || run.status === "running";
    const qualityBlocked = run.status === "failed" && run.pipelineStage === "quality_blocked";
    const compiledControl = run.qualityPolicy?.startsWith("compiled-control") === true;
    const docs = control.documents;
    return (
        <WorkspacePage className="library-page" grid>
            <PageHeader
                title={control.title || project.name}
                description={v2 ? "创作控制台：所有正文均在控制档案、独立审稿与硬规则通过后提交" : "旧版工作流项目，可重建为强控制版本"}
                meta={v2 ? <Tag color={qualityBlocked ? "error" : "success"}>{qualityBlocked ? "质量拦截" : compiledControl ? "编译式强控" : `V${run.engineVersion} 强控制`}</Tag> : <Tag color="warning">旧版</Tag>}
                actions={
                    <>
                        <Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/novels")}>
                            小说工作台
                        </Button>
                        {!v2 ? (
                            <Button type="primary" icon={<RefreshCcw className="size-3.5" />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
                                强控重建
                            </Button>
                        ) : null}
                        {active ? (
                            <Button icon={<Pause className="size-3.5" />} loading={pause.isPending} onClick={() => pause.mutate()}>
                                暂停
                            </Button>
                        ) : null}
                        {v2 && (run.status === "paused" || run.status === "failed") ? (
                            <Button type="primary" icon={<Play className="size-3.5" />} loading={resume.isPending} onClick={() => resume.mutate()}>
                                恢复
                            </Button>
                        ) : null}
                    </>
                }
            />
            <section className="mt-4 rounded-lg border border-foreground/10 bg-surface p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Stat label="创作进度" value={`${run.completedUnitCount}/${run.targetUnitCount}`} />
                    <Stat label="当前阶段" value={run.stage || "准备中"} />
                    <Stat label="当前路线" value={currentRoadmap(dynamicState) || "建立档案中"} />
                    <Stat label="文本模型" value={textModel ? modelDisplayName(config, textModel) : "未选择"} />
                </div>
                {qualityBlocked && run.qualityBlockReason ? (
                    <div className="mt-4 flex items-start gap-2 border-t border-rose-400/20 pt-3 text-sm text-rose-600 dark:text-rose-300">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                        <span>{run.qualityBlockReason}</span>
                    </div>
                ) : null}
            </section>

            {v2 ? (
                <>
                    <Segmented className="mt-4 max-w-full" block value={view} options={viewOptions} onChange={(value) => setView(value as ControlView)} />
                    {view === "canon" ? <CanonView control={control} docs={docs} /> : null}
                    {view === "roadmap" ? <RoadmapView docs={docs} artifacts={artifacts} /> : null}
                    {view === "ledger" ? <LedgerView docs={docs} state={dynamicState} /> : null}
                    {view === "units" ? <UnitReviewView artifacts={artifacts} /> : null}
                    {view === "audit" ? <ControlAuditView artifacts={artifacts} /> : null}
                </>
            ) : (
                <LegacyView control={control} />
            )}
        </WorkspacePage>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border-l-2 border-foreground/10 pl-3 first:border-l-0 first:pl-0">
            <div className="text-[11px] text-foreground/48">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold" title={value}>
                {value}
            </div>
        </div>
    );
}

function CanonView({ control, docs }: { control: NovelWorkbenchControl; docs?: NovelWorkbenchControlDocuments }) {
    const overview = docs?.projectOverview || {};
    const theme = docs?.themeAndProposition || {};
    const world = docs?.worldbuilding || {};
    const style = docs?.styleGuide || {};
    const cast = docs?.castBible || [];
    const relationships = docs?.relationshipMap || [];
    const plots = docs?.mainPlotlines || [];
    return (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ControlSection title="项目总控" icon={<ShieldCheck className="size-4" />}>
                <Descriptions
                    size="small"
                    column={1}
                    items={objectEntries({
                        一句话卖点: control.logline,
                        核心承诺: overview.corePromise,
                        核心冲突: overview.centralConflict,
                        结局回报: overview.endingResolution,
                        受众回报: overview.audiencePayoff,
                        主题: theme.theme,
                        命题: theme.proposition,
                        主题代价: theme.price,
                    })}
                />
            </ControlSection>
            <ControlSection title="世界与风格" icon={<ScrollText className="size-4" />}>
                <Descriptions
                    size="small"
                    column={1}
                    items={objectEntries({
                        世界规则: listValue(world.rules),
                        场景锚点: listValue(world.locations),
                        不可突破的边界: listValue(world.constraints),
                        叙事声音: style.narrativeVoice,
                        节奏规则: listValue(style.pacingRules),
                        禁止漂移: listValue(style.forbiddenDrift),
                    })}
                />
            </ControlSection>
            <ControlSection title={`角色卡（${cast.length}）`} icon={<BookOpenText className="size-4" />}>
                <Collapse
                    size="small"
                    items={cast.map((item, index) => ({
                        key: String(index),
                        label: `${String(item.name || item.id || "未命名")} · ${String(item.role || "")}`,
                        children: <Descriptions size="small" column={1} items={objectEntries({ ID: item.id, 欲望: item.desire, 恐惧: item.fear, 缺口: item.blindSpot, 声线: item.voice, 弧光: item.arc, 初始状态: item.initialState })} />,
                    }))}
                />
            </ControlSection>
            <ControlSection title={`关系与主线（${relationships.length + plots.length}）`} icon={<ListChecks className="size-4" />}>
                <Collapse
                    size="small"
                    items={[
                        ...relationships.map((item, index) => ({
                            key: `r-${index}`,
                            label: `${String(item.id || "关系")}：${String(item.description || "")}`,
                            children: <Descriptions size="small" column={1} items={objectEntries({ 双方: `${String(item.fromId || "")} → ${String(item.toId || "")}`, 初始状态: item.initialState })} />,
                        })),
                        ...plots.map((item, index) => ({
                            key: `p-${index}`,
                            label: `${String(item.title || item.id || "主线")} · 第 ${String(item.resolutionByUnit || "?")} 单元收束`,
                            children: <Descriptions size="small" column={1} items={objectEntries({ ID: item.id, 目标: item.goal, 初始状态: item.initialState })} />,
                        })),
                    ]}
                />
            </ControlSection>
        </div>
    );
}

function RoadmapView({ docs, artifacts }: { docs?: NovelWorkbenchControlDocuments; artifacts: NovelWorkbenchArtifact[] }) {
    const roadmap = docs?.chapterRoadmap || [];
    const plan = parseArtifact(artifacts.find((item) => item.kind === "plan_preview"));
    const planUnits = Array.isArray(plan?.units) ? (plan.units as Array<Record<string, unknown>>) : [];
    return (
        <div className="mt-4 grid gap-4">
            <ControlSection title={`分集路线图（${roadmap.length} 段）`} icon={<ListChecks className="size-4" />}>
                <div className="divide-y divide-foreground/10">
                    {roadmap.map((item) => (
                        <div className="grid gap-2 py-3 md:grid-cols-[104px_minmax(0,1fr)]" key={item.id}>
                            <div className="text-sm font-semibold text-foreground/70">
                                {item.startUnit} - {item.endUnit}
                            </div>
                            <div className="min-w-0">
                                <div className="font-medium">{item.title}</div>
                                <p className="mt-1 text-sm leading-6 text-foreground/65">{item.mission}</p>
                                <div className="mt-2 grid gap-1 text-xs text-foreground/50 sm:grid-cols-3">
                                    <span>升级：{item.escalation}</span>
                                    <span>转折：{item.keyTurn}</span>
                                    <span>债务：{item.exitDebt}</span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {item.plannedIntroductions.map((id) => (
                                        <Tag key={`i-${id}`} color="blue">
                                            引入 {id}
                                        </Tag>
                                    ))}
                                    {item.plannedPayoffs.map((id) => (
                                        <Tag key={`p-${id}`} color="green">
                                            回收 {id}
                                        </Tag>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ControlSection>
            {plan ? (
                <ControlSection title="计划预演" icon={<ShieldCheck className="size-4" />}>
                    <div className="mb-3 text-xs text-foreground/48">在建档时由账本期限编译，用于提前发现遗漏、冲突和单集负载过高。</div>
                    {planUnits.length ? (
                        <div className="divide-y divide-foreground/10">
                            {planUnits.map((item) => (
                                <div className="grid gap-2 py-3 md:grid-cols-[104px_minmax(0,1fr)]" key={String(item.unit)}>
                                    <div className="text-sm font-semibold text-foreground/70">第 {String(item.unit)} 单元</div>
                                    <div className="flex flex-wrap gap-1">
                                        <span className="mr-2 text-xs text-foreground/48">{String(item.roadmapId || "")}</span>
                                        {arrayStringValue(item.introductions).map((id) => (
                                            <Tag key={`pi-${id}`} color="blue">
                                                引入 {id}
                                            </Tag>
                                        ))}
                                        {arrayStringValue(item.payoffs).map((id) => (
                                            <Tag key={`pp-${id}`} color="green">
                                                回收 {id}
                                            </Tag>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前档案没有账本动作" />
                    )}
                </ControlSection>
            ) : null}
        </div>
    );
}

function LedgerView({ docs, state }: { docs?: NovelWorkbenchControlDocuments; state: NovelWorkbenchDynamicState }) {
    return (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <LedgerPanel title="伏笔账本" items={docs?.foreshadowLedger || []} states={state.foreshadowStates || {}} />
            <LedgerPanel title="读者承诺账本" items={docs?.readerPromiseLedger || []} states={state.promiseStates || {}} />
        </div>
    );
}

function LedgerPanel({ title, items, states }: { title: string; items: NonNullable<NovelWorkbenchControlDocuments["foreshadowLedger"]>; states: Record<string, string> }) {
    return (
        <ControlSection title={title} icon={<ScrollText className="size-4" />}>
            {items.length ? (
                <div className="divide-y divide-foreground/10">
                    {items.map((item) => (
                        <div className="py-3" key={item.id}>
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="text-xs text-foreground/55">{item.id}</code>
                                <Tag color={ledgerColor(states[item.id])}>{states[item.id] || "planned"}</Tag>
                                <span className="text-xs text-foreground/48">
                                    第 {item.introducedByUnit} 集引入 / 第 {item.payoffByUnit} 集回收
                                </span>
                            </div>
                            <p className="mt-1.5 text-sm leading-6 text-foreground/70">{item.description}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待建立档案" />
            )}
        </ControlSection>
    );
}

function UnitReviewView({ artifacts }: { artifacts: NovelWorkbenchArtifact[] }) {
    const reviews = artifacts.filter((item) => item.kind === "review_report");
    const cards = artifacts.filter((item) => item.kind === "control_card");
    const contracts = artifacts.filter((item) => item.kind === "episode_contract");
    const specs = artifacts.filter((item) => item.kind === "episode_spec");
    const deltas = artifacts.filter((item) => item.kind === "creative_delta");
    const committed = artifacts.filter((item) => item.kind === "commit_record");
    const blocks = artifacts.filter((item) => item.kind === "quality_block");
    const audits = controlCardAuditEntries(artifacts);
    const repairs = repairPacketEntries(artifacts);
    const units = Array.from(new Set([...reviews, ...cards, ...contracts, ...specs, ...deltas, ...committed, ...blocks, ...audits.map((item) => item.artifact), ...repairs.map((item) => item.artifact)].map((item) => item.unit)))
        .filter((unit) => unit > 0)
        .sort((a, b) => a - b);
    return (
        <section className="mt-4">
            <ControlSection title="逐集创作契约、控制卡、审稿与提交" icon={<FileCheck2 className="size-4" />}>
                {units.length ? (
                    <Collapse
                        items={units.map((unit) => ({
                            key: String(unit),
                            label: `第 ${unit} 单元 · ${reviewStatus(reviews.filter((item) => item.unit === unit))}`,
                            children: <UnitArtifacts unit={unit} contracts={contracts} specs={specs} deltas={deltas} cards={cards} reviews={reviews} commits={committed} blocks={blocks} audits={audits} repairs={repairs} />,
                        }))}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="首个单元开始后会在这里留下完整记录" />
                )}
            </ControlSection>
        </section>
    );
}

function UnitArtifacts({
    unit,
    contracts,
    specs,
    deltas,
    cards,
    reviews,
    commits,
    blocks,
    audits,
    repairs,
}: {
    unit: number;
    contracts: NovelWorkbenchArtifact[];
    specs: NovelWorkbenchArtifact[];
    deltas: NovelWorkbenchArtifact[];
    cards: NovelWorkbenchArtifact[];
    reviews: NovelWorkbenchArtifact[];
    commits: NovelWorkbenchArtifact[];
    blocks: NovelWorkbenchArtifact[];
    audits: ControlCardAuditEntry[];
    repairs: RepairPacketEntry[];
}) {
    const contract = parseArtifact(contracts.find((item) => item.unit === unit));
    const spec = parseArtifact(specs.find((item) => item.unit === unit));
    const delta = parseArtifact(deltas.find((item) => item.unit === unit));
    const card = parseArtifact(cards.find((item) => item.unit === unit));
    const reviewData = parseArtifact(reviews.filter((item) => item.unit === unit).at(-1));
    const review = reviewData?.review || reviewData;
    const commit = parseArtifact(commits.find((item) => item.unit === unit));
    const block = parseArtifact(blocks.filter((item) => item.unit === unit).at(-1));
    const unitAudits = audits.filter((item) => item.artifact.unit === unit);
    const unitRepairs = repairs.filter((item) => item.artifact.unit === unit);
    return (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
            <ArtifactObject title="创作契约" value={contract} />
            {spec ? <ArtifactObject title="编译单元规格" value={spec} /> : null}
            {delta ? <ArtifactObject title="创意增量" value={delta} /> : null}
            <ArtifactObject title="控制卡" value={card} />
            <ArtifactObject title="审稿报告" value={review} />
            <ArtifactObject title="提交记录" value={commit} />
            {block ? <ArtifactObject title="质量拦截记录" value={block} /> : null}
            {unitAudits.length ? <ControlCardAuditDetails entries={unitAudits} /> : null}
            {unitRepairs.length ? <RepairPacketDetails entries={unitRepairs} /> : null}
        </div>
    );
}

function ControlAuditView({ artifacts }: { artifacts: NovelWorkbenchArtifact[] }) {
    const controlCardAudits = controlCardAuditEntries(artifacts);
    const repairs = repairPacketEntries(artifacts);
    const promptArtifacts = artifacts.filter((item) => item.prompt?.trim());
    return (
        <div className="mt-4 grid gap-4">
            <ControlSection title="控制卡决策审计" icon={<ShieldCheck className="size-4" />}>
                <p className="mb-4 text-sm leading-6 text-foreground/65">每轮控制卡都会记录冻结契约、证据声明的分类与处理、验证链和响应指纹。被拒绝的轮次保留原始输出；通过后若移除了纯背景重复声明，也会明确显示。</p>
                {controlCardAudits.length ? <ControlCardAuditDetails entries={controlCardAudits} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="首个控制卡生成后会显示验证与规范化记录" />}
            </ControlSection>
            <ControlSection title="定向返修单" icon={<FileCheck2 className="size-4" />}>
                <p className="mb-4 text-sm leading-6 text-foreground/65">每次自动返修都会先固定失败规则、受影响 ID、必须修复项和不可改项。模型只会收到对应单据，不会重新猜测状态机。</p>
                {repairs.length ? <RepairPacketDetails entries={repairs} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未发生需要返修的单元" />}
            </ControlSection>
            <ControlSection title="提示词审计" icon={<ShieldCheck className="size-4" />}>
                {promptArtifacts.length ? (
                    <Collapse
                        items={promptArtifacts.map((item) => ({
                            key: item.id,
                            label: `${artifactLabel(item.kind)} · 第 ${item.unit || "总控"} 单元 · 第 ${item.attempt || 1} 轮`,
                            children: <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.035] p-3 text-xs leading-6 text-foreground/70">{item.prompt}</pre>,
                        }))}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成后会保存写手、审稿与返修提示词" />
                )}
            </ControlSection>
        </div>
    );
}

function ControlCardAuditDetails({ entries }: { entries: ControlCardAuditEntry[] }) {
    return (
        <div className="min-w-0 xl:col-span-2 2xl:col-span-4">
            <Collapse
                items={entries.map(({ artifact, audit }) => {
                    const outcome = textValue(audit.outcome) || (artifact.kind === "control_card_rejected" ? "rejected" : "accepted");
                    const attempt = numberValue(audit.attempt) || artifact.attempt || 1;
                    const validationError = textValue(audit.validationError);
                    return {
                        key: artifact.id,
                        label: (
                            <span className="inline-flex max-w-full flex-wrap items-center gap-2">
                                <span>
                                    第 {artifact.unit} 单元 · 第 {attempt} 轮
                                </span>
                                <Tag color={controlCardAuditOutcomeColor(outcome)}>{controlCardAuditOutcomeLabel(outcome)}</Tag>
                                {validationError ? <span className="max-w-full text-xs text-rose-600 dark:text-rose-300">{validationError}</span> : null}
                            </span>
                        ),
                        children: <ControlCardAuditDetail audit={audit} />,
                    };
                })}
            />
        </div>
    );
}

function RepairPacketDetails({ entries }: { entries: RepairPacketEntry[] }) {
    return (
        <div className="min-w-0 xl:col-span-2 2xl:col-span-4">
            <Collapse
                items={entries.map(({ artifact, packet }) => {
                    const stage = textValue(packet.stage) || artifact.kind;
                    const attempt = numberValue(packet.attempt) || artifact.attempt || 1;
                    const failure = textValue(packet.failure) || "未记录具体失败原因";
                    return {
                        key: artifact.id,
                        label: (
                            <span className="inline-flex max-w-full flex-wrap items-center gap-2">
                                <span>
                                    第 {artifact.unit} 单元 · 第 {attempt} 轮
                                </span>
                                <Tag color={repairFailureColor(textValue(packet.failureClass))}>{repairStageLabel(stage)}</Tag>
                                <span className="max-w-full text-xs text-rose-600 dark:text-rose-300">{failure}</span>
                            </span>
                        ),
                        children: <RepairPacketDetail packet={packet} />,
                    };
                })}
            />
        </div>
    );
}

function RepairPacketDetail({ packet }: { packet: Record<string, unknown> }) {
    const affectedIDs = arrayStringValue(packet.affectedIds);
    const requiredFix = arrayStringValue(packet.requiredFix);
    const warnings = arrayStringValue(packet.warnings);
    const preserve = arrayStringValue(packet.preserve);
    return (
        <div className="space-y-4">
            <div className="grid gap-3 text-xs sm:grid-cols-3">
                <AuditFact label="失败类型" value={repairFailureLabel(textValue(packet.failureClass))} />
                <AuditFact label="失败代码" value={textValue(packet.failureCode) || "未分类"} />
                <AuditFact label="失败阶段" value={repairStageLabel(textValue(packet.stage))} />
            </div>
            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">本次失败</h3>
                <p className="rounded-md border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs leading-6 text-rose-700 dark:text-rose-200">{textValue(packet.failure) || "未记录具体失败原因"}</p>
            </div>
            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">受影响 ID</h3>
                <div className="flex flex-wrap gap-1">
                    {affectedIDs.map((id) => (
                        <Tag key={id} color="blue">
                            {id}
                        </Tag>
                    ))}
                    {!affectedIDs.length ? <span className="text-xs text-foreground/45">本次为格式或整体叙事问题，没有特定 ID</span> : null}
                </div>
            </div>
            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">必须修复</h3>
                <ul className="space-y-1 text-xs leading-6 text-foreground/70">
                    {requiredFix.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                    ))}
                </ul>
            </div>
            {warnings.length ? (
                <div>
                    <h3 className="mb-2 text-xs font-medium text-foreground/55">审稿提示（不触发返修）</h3>
                    <ul className="space-y-1 text-xs leading-6 text-foreground/55">
                        {warnings.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">不可改动</h3>
                <ul className="space-y-1 text-xs leading-6 text-foreground/55">
                    {preserve.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

function ControlCardAuditDetail({ audit }: { audit: Record<string, unknown> }) {
    const validations = recordArrayValue(audit.validations);
    const decisions = recordArrayValue(audit.evidenceDecisions);
    const contract = recordValue(audit.contract);
    const fingerprint = textValue(audit.rawResponseSha256);
    const relevantLedgerIDs = arrayStringValue(contract?.relevantLedgerIds);
    const requiredIntroductions = arrayStringValue(contract?.requiredIntroductionIds);
    const requiredPayoffs = arrayStringValue(contract?.requiredPayoffIds);
    return (
        <div className="space-y-4">
            <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                <AuditFact label="审计规则" value={textValue(audit.ruleset) || "未记录"} />
                <AuditFact label="响应指纹" value={fingerprint ? `${fingerprint.slice(0, 16)}...` : "未记录"} title={fingerprint} />
                <AuditFact label="证据声明" value={`${numberValue(audit.inputEvidenceClaimCount)} → ${numberValue(audit.outputEvidenceClaimCount)}`} />
                <AuditFact label="路线" value={textValue(contract?.roadmapId) || "未记录"} />
            </div>

            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">冻结契约上下文</h3>
                <div className="flex flex-wrap gap-1">
                    {requiredIntroductions.map((id) => (
                        <Tag key={`intro-${id}`} color="blue">
                            引入 {id}
                        </Tag>
                    ))}
                    {requiredPayoffs.map((id) => (
                        <Tag key={`payoff-${id}`} color="green">
                            回收 {id}
                        </Tag>
                    ))}
                    {relevantLedgerIDs.map((id) => (
                        <Tag key={`relevant-${id}`}>{id}</Tag>
                    ))}
                    {!requiredIntroductions.length && !requiredPayoffs.length && !relevantLedgerIDs.length ? <span className="text-xs text-foreground/45">本轮未记录账本上下文</span> : null}
                </div>
            </div>

            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">验证链</h3>
                {validations.length ? (
                    <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
                        {validations.map((validation, index) => {
                            const passed = validation.passed === true;
                            const detail = textValue(validation.detail);
                            return (
                                <div className="flex flex-wrap items-start gap-2 p-3 text-xs" key={`${textValue(validation.stage)}-${index}`}>
                                    <Tag color={passed ? "green" : "red"}>{passed ? "通过" : "拦截"}</Tag>
                                    <span className="font-medium text-foreground/75">{controlCardAuditStageLabel(textValue(validation.stage))}</span>
                                    {detail ? <span className={passed ? "text-foreground/55" : "text-rose-600 dark:text-rose-300"}>{detail}</span> : null}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <span className="text-xs text-foreground/45">该记录来自旧版，未保存分阶段验证结果</span>
                )}
            </div>

            <div>
                <h3 className="mb-2 text-xs font-medium text-foreground/55">证据声明决策</h3>
                {decisions.length ? (
                    <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
                        {decisions.map((decision, index) => {
                            const action = textValue(decision.action) || "retained";
                            const requestedLevel = textValue(decision.requestedLevel);
                            const priorLevel = textValue(decision.priorLevel);
                            return (
                                <div className="p-3 text-xs" key={`${textValue(decision.evidenceId)}-${index}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <code className="text-foreground/70">{textValue(decision.evidenceId) || "缺失 ID"}</code>
                                        <Tag color={controlCardAuditActionColor(action)}>{controlCardAuditActionLabel(action)}</Tag>
                                        <Tag>{controlCardAuditClassificationLabel(textValue(decision.classification))}</Tag>
                                        {requestedLevel || priorLevel ? (
                                            <span className="text-foreground/50">
                                                等级：{priorLevel || "未知"} → {requestedLevel || "未知"}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-2 leading-5 text-foreground/65">{textValue(decision.reason) || "未记录处理原因"}</p>
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-foreground/45">
                                        <span>账本存在：{booleanLabel(decision.knownLedger)}</span>
                                        <span>账本锚点：{booleanLabel(decision.requiredAnchor)}</span>
                                        <span>知情使用：{booleanLabel(decision.usedByKnowledge)}</span>
                                        <span>本集相关：{booleanLabel(decision.relevantToUnit)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <span className="text-xs text-foreground/45">本轮没有证据声明，或该记录来自旧版</span>
                )}
            </div>

            <ArtifactObject title="审计原始记录" value={audit} />
        </div>
    );
}

function AuditFact({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div className="min-w-0 rounded-md bg-foreground/[0.035] px-3 py-2">
            <div className="text-[11px] text-foreground/48">{label}</div>
            <div className="mt-1 truncate font-medium text-foreground/75" title={title || value}>
                {value}
            </div>
        </div>
    );
}

function LegacyView({ control }: { control: NovelWorkbenchControl }) {
    return (
        <section className="mt-4">
            <ControlSection title="旧版总控档案" icon={<ShieldAlert className="size-4" />}>
                <p className="mb-4 text-sm leading-6 text-foreground/65">旧版只保存分部弧线与摘要，尚未启用固定 ID、承诺账本、独立审稿和提交门禁。点击上方“强控重建”会保留旧内容为快照并建立 V2 项目。</p>
                <Collapse
                    items={(control.arcs || []).map((arc) => ({
                        key: String(arc.index),
                        label: `${arc.startUnit} - ${arc.endUnit} · ${arc.title}`,
                        children: <Descriptions size="small" column={1} items={objectEntries({ 任务: arc.mission, 升级: arc.escalation, 冲突: arc.keyConflict, 转折: arc.turn, 离场债务: arc.exitDebt })} />,
                    }))}
                />
            </ControlSection>
        </section>
    );
}

function ControlSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-foreground/10 bg-surface p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {icon}
                {title}
            </h2>
            {children}
        </section>
    );
}

function ArtifactObject({ title, value }: { title: string; value: unknown }) {
    return (
        <div className="min-w-0">
            <h3 className="mb-2 text-xs font-medium text-foreground/55">{title}</h3>
            {value ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.035] p-3 text-xs leading-6 text-foreground/70">{JSON.stringify(value, null, 2)}</pre>
            ) : (
                <span className="text-xs text-foreground/45">尚无记录</span>
            )}
        </div>
    );
}

function controlCardAuditEntries(artifacts: NovelWorkbenchArtifact[]) {
    const entries = artifacts.flatMap((artifact): ControlCardAuditEntry[] => {
        const payload = parseArtifact(artifact);
        if (!payload) return [];
        if (artifact.kind === "control_card_audit") return [{ artifact, audit: payload }];
        if (artifact.kind === "control_card_rejected") {
            const audit = recordValue(payload.audit);
            return audit ? [{ artifact, audit }] : [];
        }
        if (artifact.kind !== "control_card_normalized") return [];

        const removedEvidenceIDs = arrayStringValue(payload.removedEvidenceIds);
        return [
            {
                artifact,
                audit: {
                    schemaVersion: 0,
                    unit: artifact.unit,
                    attempt: artifact.attempt,
                    outcome: "accepted_with_normalization",
                    ruleset: "legacy-normalization",
                    inputEvidenceClaimCount: removedEvidenceIDs.length,
                    outputEvidenceClaimCount: 0,
                    evidenceDecisions: removedEvidenceIDs.map((evidenceId) => ({
                        evidenceId,
                        classification: "unused_stable_context",
                        action: "removed",
                        reason: textValue(payload.reason) || "旧版已移除冗余背景证据声明。",
                    })),
                    validations: [{ stage: "legacy_normalization", passed: true, detail: "旧版记录未保存完整验证链。" }],
                },
            },
        ];
    });
    return entries.sort((left, right) => {
        const unitDifference = left.artifact.unit - right.artifact.unit;
        if (unitDifference !== 0) return unitDifference;
        const attemptDifference = (numberValue(left.audit.attempt) || left.artifact.attempt) - (numberValue(right.audit.attempt) || right.artifact.attempt);
        if (attemptDifference !== 0) return attemptDifference;
        return left.artifact.createdAt.localeCompare(right.artifact.createdAt);
    });
}

function repairPacketEntries(artifacts: NovelWorkbenchArtifact[]) {
    return artifacts
        .flatMap((artifact): RepairPacketEntry[] => {
            const payload = parseArtifact(artifact);
            const packet = recordValue(payload?.repairPacket);
            return packet ? [{ artifact, packet }] : [];
        })
        .sort((left, right) => {
            const unitDifference = left.artifact.unit - right.artifact.unit;
            if (unitDifference !== 0) return unitDifference;
            const attemptDifference = (numberValue(left.packet.attempt) || left.artifact.attempt) - (numberValue(right.packet.attempt) || right.artifact.attempt);
            if (attemptDifference !== 0) return attemptDifference;
            return left.artifact.createdAt.localeCompare(right.artifact.createdAt);
        });
}

function recordValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordArrayValue(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(recordValue(item))) : [];
}

function textValue(value: unknown) {
    return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanLabel(value: unknown) {
    return value === true ? "是" : "否";
}

function controlCardAuditOutcomeLabel(outcome: string) {
    return (
        (
            {
                accepted: "通过",
                accepted_with_normalization: "规范化后通过",
                compiled: "系统编译通过",
                rejected: "已拦截",
            } as Record<string, string>
        )[outcome] || outcome
    );
}

function controlCardAuditOutcomeColor(outcome: string) {
    return outcome === "accepted" || outcome === "compiled" ? "green" : outcome === "accepted_with_normalization" ? "gold" : "red";
}

function controlCardAuditActionLabel(action: string) {
    return action === "removed" ? "自动移除" : "保留校验";
}

function controlCardAuditActionColor(action: string) {
    return action === "removed" ? "gold" : "blue";
}

function controlCardAuditClassificationLabel(classification: string) {
    return (
        (
            {
                required_anchor: "账本锚点",
                knowledge_backed_context: "知情背景",
                unused_stable_context: "冗余背景",
                out_of_scope: "超出本集范围",
                unknown_ledger: "未知账本",
                unestablished_context: "未成立事实",
                background_progression: "背景越级",
                missing_id: "缺少 ID",
                normalization_unavailable: "规范化不可用",
            } as Record<string, string>
        )[classification] ||
        classification ||
        "未分类"
    );
}

function controlCardAuditStageLabel(stage: string) {
    return (
        (
            {
                json_decode: "JSON 解析",
                compiled_episode_spec: "编译单元规格",
                creative_delta: "创意增量",
                evidence_scope_normalization: "证据范围规范化",
                control_card: "控制卡结构",
                episode_contract: "创作契约",
                fact_contract: "事实契约",
                legacy_normalization: "旧版规范化",
            } as Record<string, string>
        )[stage] ||
        stage ||
        "未命名阶段"
    );
}

function repairStageLabel(stage: string) {
    return (
        (
            {
                creative_delta: "创意增量",
                draft: "正文起草",
                review: "独立审稿",
            } as Record<string, string>
        )[stage] ||
        stage ||
        "返修"
    );
}

function repairFailureLabel(failureClass: string) {
    return (
        (
            {
                format: "格式问题",
                structural: "结构/状态问题",
                narrative: "正文/审稿问题",
            } as Record<string, string>
        )[failureClass] ||
        failureClass ||
        "未分类"
    );
}

function repairFailureColor(failureClass: string) {
    return failureClass === "narrative" ? "gold" : failureClass === "format" ? "blue" : "red";
}

function currentRoadmap(state: NovelWorkbenchDynamicState) {
    return state.currentRoadmapTitle || state.currentArc || "";
}
function listValue(value: unknown) {
    return Array.isArray(value) ? value.join("；") : String(value || "-");
}
function objectEntries(input: Record<string, unknown>) {
    return Object.entries(input)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([label, children]) => ({ key: label, label, children: Array.isArray(children) ? children.join("；") : String(children) }));
}
function parseArtifact(item?: NovelWorkbenchArtifact) {
    if (!item?.contentJson) return null;
    try {
        return JSON.parse(item.contentJson) as Record<string, unknown>;
    } catch {
        return { raw: item.contentJson };
    }
}
function arrayStringValue(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
function artifactLabel(kind: string) {
    return (
        (
            {
                control_canon: "控制档案",
                plan_preview: "计划预演",
                episode_contract: "创作契约",
                episode_spec: "编译单元规格",
                creative_delta: "创意增量",
                creative_delta_rejected: "创意增量返修",
                control_card: "控制卡",
                control_card_audit: "控制卡决策审计",
                control_card_rejected: "控制卡修复",
                control_card_normalized: "控制卡规范化",
                draft_rejected: "写手返修",
                draft_accepted: "通过正文",
                review_report: "独立审稿",
                quality_block: "质量拦截",
                bootstrap_attempt: "总控修复",
            } as Record<string, string>
        )[kind] || kind
    );
}
function ledgerColor(state?: string) {
    return state === "paid" ? "green" : state === "active" ? "gold" : state === "introduced" ? "blue" : "default";
}
function reviewStatus(items: NovelWorkbenchArtifact[]) {
    const data = parseArtifact(items.at(-1));
    const review = data?.review as Record<string, unknown> | undefined;
    return review?.overallPass ? "已通过" : items.length ? "待修复 / 审稿未通过" : "尚未审稿";
}
