import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Collapse, Descriptions, Empty, Segmented, Spin, Tag } from "antd";
import { ArrowLeft, BookOpenText, FileCheck2, ListChecks, Pause, Play, RefreshCcw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { backendProviderConfig } from "@/services/api/generation-task";
import { getNovelWorkbenchRun, pauseNovelWorkbench, rebuildNovelWorkbench, resumeNovelWorkbench, type NovelWorkbenchArtifact, type NovelWorkbenchControl, type NovelWorkbenchDynamicState } from "@/services/api/novel-workbench";
import { logicalModelIDForConfig, modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

type ControlView = "canon" | "roadmap" | "ledger" | "units" | "audit";

const viewOptions = [
    {
        value: "canon",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <BookOpenText className="size-3.5" />
                正史
            </span>
        ),
    },
    {
        value: "roadmap",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ListChecks className="size-3.5" />
                故事弧
            </span>
        ),
    },
    {
        value: "ledger",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ScrollText className="size-3.5" />
                连续性
            </span>
        ),
    },
    {
        value: "units",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <FileCheck2 className="size-3.5" />
                单元回执
            </span>
        ),
    },
    {
        value: "audit",
        label: (
            <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                运行审计
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
    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "run", projectId] });
        void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] });
    };
    const pause = useMutation({ mutationFn: () => pauseNovelWorkbench(projectId), onSuccess: refresh, onError: (error) => message.error(error instanceof Error ? error.message : "暂停失败") });
    const resume = useMutation({ mutationFn: () => resumeNovelWorkbench(projectId, runtime()), onSuccess: refresh, onError: (error) => message.error(error instanceof Error ? error.message : "恢复失败") });
    const rebuild = useMutation({
        mutationFn: () => rebuildNovelWorkbench(projectId, runtime()),
        onSuccess: ({ project }) => {
            message.success("已进入新的弧级创作流程");
            void queryClient.invalidateQueries({ queryKey: ["novel-workbench", "runs"] });
            navigate(`/novels/${project.id}/control`, { replace: true });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "重建失败"),
    });

    if (detailQuery.isPending) {
        return (
            <WorkspacePage>
                <div className="grid min-h-80 place-items-center">
                    <Spin tip="正在读取弧级创作档案" />
                </div>
            </WorkspacePage>
        );
    }
    if (detailQuery.isError || !detailQuery.data) {
        return (
            <WorkspacePage>
                <WorkspaceErrorState description={detailQuery.error instanceof Error ? detailQuery.error.message : "无法读取弧级创作档案"} onRetry={() => void detailQuery.refetch()} />
            </WorkspacePage>
        );
    }

    const { run, project, control, dynamicState, artifacts } = detailQuery.data;
    const active = run.status === "queued" || run.status === "running";
    const qualityBlocked = run.status === "failed" && run.pipelineStage === "quality_blocked";
    const archived = run.status === "archived";
    return (
        <WorkspacePage className="library-page" grid>
            <PageHeader
                title={control.title || project.name}
                description="弧级创作控制台：全书导航冻结，当前故事弧封存后再逐单元起草、审稿与原子提交"
                meta={<Tag color={qualityBlocked ? "error" : "success"}>{qualityBlocked ? "质量拦截" : "V3 弧级封存"}</Tag>}
                actions={
                    <>
                        <Button icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate("/novels")}>
                            小说工作台
                        </Button>
                        {!archived ? (
                            <Button icon={<RefreshCcw className="size-3.5" />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
                                重建本作品
                            </Button>
                        ) : null}
                        {active ? (
                            <Button icon={<Pause className="size-3.5" />} loading={pause.isPending} onClick={() => pause.mutate()}>
                                暂停
                            </Button>
                        ) : null}
                        {!archived && (run.status === "paused" || run.status === "failed") ? (
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
                    <Stat label="当前故事弧" value={currentArcTitle(dynamicState) || "建立档案中"} />
                    <Stat label="文本模型" value={textModel ? modelDisplayName(config, textModel) : "未选择"} />
                </div>
                {qualityBlocked && run.qualityBlockReason ? (
                    <div className="mt-4 flex items-start gap-2 border-t border-rose-400/20 pt-3 text-sm text-rose-600 dark:text-rose-300">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                        <span>{run.qualityBlockReason}</span>
                    </div>
                ) : null}
            </section>
            <Segmented className="mt-4 max-w-full" block value={view} options={viewOptions} onChange={(value) => setView(value as ControlView)} />
            {view === "canon" ? <ArcSealedCanonView control={control} /> : null}
            {view === "roadmap" ? <ArcSealedStoryMapView control={control} state={dynamicState} /> : null}
            {view === "ledger" ? <ArcSealedContinuityView control={control} state={dynamicState} /> : null}
            {view === "units" ? <ArcSealedUnitView artifacts={artifacts} /> : null}
            {view === "audit" ? <ArcSealedAuditView artifacts={artifacts} /> : null}
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

function ArcSealedCanonView({ control }: { control: NovelWorkbenchControl }) {
    const bible = control.bible || {};
    const style = control.style || {};
    const characters = bible.characters || [];
    return (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <ControlSection title="全书正史" icon={<ShieldCheck className="size-4" />}>
                <Descriptions size="small" column={1} items={objectEntries({ 一句话卖点: control.logline, 创作前提: bible.premise, 结局承诺: bible.endingPromise, 主题: bible.theme, 世界规则: listValue(bible.worldRules) })} />
            </ControlSection>
            <ControlSection title="风格边界" icon={<ScrollText className="size-4" />}>
                <Descriptions size="small" column={1} items={objectEntries({ 叙事声音: style.narrativeVoice, 节奏规则: listValue(style.pacingRules), 禁止漂移: listValue(style.forbiddenDrift) })} />
            </ControlSection>
            <ControlSection title={`角色正史（${characters.length}）`} icon={<BookOpenText className="size-4" />}>
                {characters.length ? (
                    <Collapse
                        size="small"
                        items={characters.map((character) => ({
                            key: character.id,
                            label: `${character.name} · ${character.role}`,
                            children: <Descriptions size="small" column={1} items={objectEntries({ ID: character.id, 欲望: character.desire, 恐惧: character.fear, 声线: character.voice, 初始状态: character.initialState })} />,
                        }))}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在建立角色正史" />
                )}
            </ControlSection>
            <ControlSection title="引擎原则" icon={<ListChecks className="size-4" />}>
                <p className="text-sm leading-6 text-foreground/65">全书方向先冻结；进入一个故事弧前才制作并审阅该弧的执行包。正文只执行已封存的单元包，提交时由系统推导角色、账本与知识状态，正文不能自行写回状态。</p>
            </ControlSection>
        </div>
    );
}

function ArcSealedStoryMapView({ control, state }: { control: NovelWorkbenchControl; state: NovelWorkbenchDynamicState }) {
    const arcs = control.storyMap || [];
    const currentArc = state.currentArc || undefined;
    return (
        <div className="mt-4 grid gap-4">
            <ControlSection title={`全书故事弧（${arcs.length} 段）`} icon={<ListChecks className="size-4" />}>
                {arcs.length ? (
                    <div className="divide-y divide-foreground/10">
                        {arcs.map((arc) => (
                            <div className="grid gap-2 py-3 md:grid-cols-[108px_minmax(0,1fr)]" key={arc.id}>
                                <div className="text-sm font-semibold text-foreground/70">
                                    {arc.startUnit} - {arc.endUnit}
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2 font-medium">
                                        {arc.title}
                                        {currentArc?.arcId === arc.id ? <Tag color="cyan">当前已封存</Tag> : null}
                                    </div>
                                    <p className="mt-1 text-sm leading-6 text-foreground/65">{arc.mission}</p>
                                    <div className="mt-2 grid gap-1 text-xs text-foreground/50 sm:grid-cols-2">
                                        <span>转折：{arc.turningPoint}</span>
                                        <span>离场承诺：{arc.exitPromise}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在建立全书故事弧" />
                )}
            </ControlSection>
            <ControlSection title="当前封存执行包" icon={<FileCheck2 className="size-4" />}>
                {currentArc ? (
                    <Collapse
                        items={currentArc.packets.map((packet) => ({
                            key: String(packet.unit),
                            label: `第 ${packet.unit} 单元 · ${packet.title}`,
                            children: (
                                <Descriptions
                                    size="small"
                                    column={1}
                                    items={objectEntries({
                                        入口接力: packet.entryBridge,
                                        目标: packet.goal,
                                        压力: packet.pressure,
                                        选择: packet.choice,
                                        转折: packet.turn,
                                        离场债务: packet.exitDebt,
                                        必现事件: listValue(packet.requiredEvents),
                                        可确认上限: packet.allowedConclusion,
                                        禁止越界: listValue(packet.forbiddenConclusions),
                                    })}
                                />
                            ),
                        }))}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有封存中的故事弧；下一单元开始前会先完成弧级计划与审阅" />
                )}
            </ControlSection>
        </div>
    );
}

function ArcSealedContinuityView({ control, state }: { control: NovelWorkbenchControl; state: NovelWorkbenchDynamicState }) {
    const facts = control.bible?.facts || [];
    const factStates = state.factStates || {};
    const characters = control.bible?.characters || [];
    const characterStates = state.characterStates || {};
    return (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <ControlSection title={`正史账本（${facts.length}）`} icon={<ScrollText className="size-4" />}>
                {facts.length ? (
                    <div className="divide-y divide-foreground/10">
                        {facts.map((fact) => (
                            <div className="py-3" key={fact.id}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <code className="text-xs text-foreground/55">{fact.id}</code>
                                    <Tag color={arcFactColor(factStates[fact.id])}>{factStates[fact.id] || "planned"}</Tag>
                                    <Tag>{arcFactKindLabel(fact.kind)}</Tag>
                                    {fact.introducedByUnit ? <span className="text-xs text-foreground/48">第 {fact.introducedByUnit} 单元引入</span> : null}
                                    {fact.resolveByUnit ? <span className="text-xs text-foreground/48">第 {fact.resolveByUnit} 单元回收</span> : null}
                                </div>
                                <p className="mt-1.5 text-sm leading-6 text-foreground/70">{fact.statement}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在建立正史账本" />
                )}
            </ControlSection>
            <ControlSection title="当前角色状态" icon={<BookOpenText className="size-4" />}>
                <Collapse
                    size="small"
                    items={characters.map((character) => {
                        const display = arcCharacterState(characterStates[character.id]);
                        return {
                            key: character.id,
                            label: `${character.name} · ${display.status || "未触发"}${display.location ? ` · ${display.location}` : ""}`,
                            children: <Descriptions size="small" column={1} items={objectEntries({ 状态: display.status, 地点: display.location, 已知正史: listValue(display.knownFactIds) })} />,
                        };
                    })}
                />
            </ControlSection>
            <ControlSection title="开放问题" icon={<ShieldCheck className="size-4" />}>
                {state.openQuestions?.length ? (
                    <div className="divide-y divide-foreground/10">
                        {state.openQuestions.map((question) => (
                            <div className="py-3" key={question.id}>
                                <code className="text-xs text-foreground/55">{question.id}</code>
                                <p className="mt-1 text-sm leading-6 text-foreground/70">{question.text}</p>
                                <span className="text-xs text-foreground/48">第 {question.openedUnit} 单元开启</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有未收束的读者问题" />
                )}
            </ControlSection>
            <ControlSection title="最近提交摘要" icon={<FileCheck2 className="size-4" />}>
                {state.recentSummaries?.length ? (
                    <div className="divide-y divide-foreground/10">
                        {state.recentSummaries.map((summary) => (
                            <div className="py-3" key={summary.unit}>
                                <div className="text-sm font-medium">
                                    第 {summary.unit} 单元 · {summary.title}
                                </div>
                                <p className="mt-1 text-sm leading-6 text-foreground/65">{summary.summary}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正文提交后会保留最近摘要" />
                )}
            </ControlSection>
        </div>
    );
}

function ArcSealedUnitView({ artifacts }: { artifacts: NovelWorkbenchArtifact[] }) {
    const unitArtifacts = artifacts.filter(
        (item) => item.unit > 0 && ["arc_plan", "arc_review", "arc_seal", "prose_attempt", "prose_recovery", "draft_accepted", "render_review", "render_review_attempt", "draft_rejected", "quality_block", "commit_record"].includes(item.kind),
    );
    const units = Array.from(new Set(unitArtifacts.map((item) => item.unit))).sort((left, right) => left - right);
    return (
        <section className="mt-4">
            <ControlSection title="封弧、正文、审稿与提交回执" icon={<FileCheck2 className="size-4" />}>
                {units.length ? (
                    <Collapse
                        items={units.map((unit) => {
                            const entries = unitArtifacts.filter((item) => item.unit === unit);
                            const committed = entries.some((item) => item.kind === "commit_record");
                            const blocked = entries.some((item) => item.kind === "quality_block");
                            return {
                                key: String(unit),
                                label: (
                                    <span className="inline-flex items-center gap-2">
                                        第 {unit} 单元<Tag color={blocked ? "red" : committed ? "green" : "blue"}>{blocked ? "已拦截" : committed ? "已提交" : "处理中"}</Tag>
                                    </span>
                                ),
                                children: (
                                    <div className="grid gap-4 xl:grid-cols-2">
                                        {entries.map((item) => (
                                            <ArtifactObject key={item.id} title={`${artifactLabel(item.kind)} · 第 ${item.attempt || 1} 轮`} value={parseArtifact(item)} />
                                        ))}
                                    </div>
                                ),
                            };
                        })}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="首个故事弧开始后会在这里留下封存与提交回执" />
                )}
            </ControlSection>
        </section>
    );
}

function ArcSealedAuditView({ artifacts }: { artifacts: NovelWorkbenchArtifact[] }) {
    const prompts = artifacts.filter((item) => item.prompt?.trim());
    const planning = artifacts.filter((item) =>
        ["book_canon", "bootstrap_rejected", "arc_plan", "arc_plan_rejected", "arc_review", "arc_review_rejected", "arc_seal", "prose_attempt", "prose_recovery", "render_review_attempt", "quality_block", "source_snapshot"].includes(item.kind),
    );
    return (
        <div className="mt-4 grid gap-4">
            <ControlSection title="弧级决策记录" icon={<ShieldCheck className="size-4" />}>
                {planning.length ? (
                    <Collapse items={planning.map((item) => ({ key: item.id, label: `${artifactLabel(item.kind)} · 第 ${item.unit || "总控"} 单元 · 第 ${item.attempt || 1} 轮`, children: <ArtifactObject title="记录" value={parseArtifact(item)} /> }))} />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="第一个故事弧封存后会显示计划与审稿记录" />
                )}
            </ControlSection>
            <ControlSection title="提示词审计" icon={<ShieldCheck className="size-4" />}>
                {prompts.length ? (
                    <Collapse
                        items={prompts.map((item) => ({
                            key: item.id,
                            label: `${artifactLabel(item.kind)} · 第 ${item.unit || "总控"} 单元 · 第 ${item.attempt || 1} 轮`,
                            children: <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.035] p-3 text-xs leading-6 text-foreground/70">{item.prompt}</pre>,
                        }))}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成后会保存规划、写手、审稿与返修提示词" />
                )}
            </ControlSection>
        </div>
    );
}

function ControlSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
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

function arcCharacterState(value: NonNullable<NovelWorkbenchDynamicState["characterStates"]>[string] | undefined) {
    return { status: value?.status || "", location: value?.location || "", knownFactIds: value?.knownFactIds || [] };
}

function arcFactColor(status: string | undefined) {
    return status === "resolved" ? "green" : status === "active" ? "cyan" : status === "seeded" ? "blue" : "default";
}

function arcFactKindLabel(kind: string) {
    return ({ fact: "正史", promise: "读者承诺", question: "读者问题" } as Record<string, string>)[kind] || kind;
}

function currentArcTitle(state: NovelWorkbenchDynamicState) {
    return state.currentArc?.title || state.currentArcId || "";
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

function artifactLabel(kind: string) {
    return (
        (
            {
                book_canon: "全书正史",
                bootstrap_rejected: "全书导航修复",
                arc_plan: "故事弧执行包",
                arc_plan_rejected: "故事弧重编",
                arc_review: "故事弧审阅",
                arc_review_rejected: "故事弧审阅修复",
                arc_seal: "故事弧封存",
                prose_attempt: "正文候选稿",
                prose_recovery: "定向修复方案",
                render_review: "正文审稿",
                render_review_attempt: "正文审稿尝试",
                draft_rejected: "写手返修",
                draft_accepted: "通过正文",
                quality_block: "质量拦截",
                commit_record: "提交记录",
                source_snapshot: "重建前快照",
            } as Record<string, string>
        )[kind] || kind
    );
}
