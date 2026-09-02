import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Collapse, Empty, Form, Input, InputNumber, Select, Switch, Tag, Tooltip } from "antd";
import { CheckCircle2, FlaskConical, Plus, Sparkles, Trash2, WandSparkles, XCircle } from "lucide-react";
import { useNavigate } from "react-router";

import { getProjectUnitWorkspace, replaceProjectUnitShots, saveProjectShot, type ProjectDetail, type ShotRevisionInput } from "@/services/api/projects";
import { nxfHealth, nxfSceneCompile, type NxfCompileResult, type NxfSceneSpec, type NxfShotContract } from "@/services/api/nxf";
import "./brew.css";

type Props = {
    detail: ProjectDetail;
    projectId: string;
    refreshProject: () => void;
};

type BrewFormValues = {
    goal: string;
    location?: string;
    time?: string;
    mood?: string;
    characters?: Array<{ role?: string; identity?: string; state?: string }>;
    style?: string;
    camera?: string;
    lighting?: string;
    beats?: Array<{ start?: number | null; end?: number | null; action?: string }>;
    identityLock?: boolean;
    continuityLock?: boolean;
    positiveOnly?: boolean;
    platform?: string;
    totalSeconds?: number;
    aspect?: string;
    useCase?: string;
};

const CAMERA_OPTIONS = [
    "static", "push in", "pull out", "zoom in", "zoom out",
    "pan left", "pan right", "tilt up", "tilt down",
    "tracking", "handheld", "arc", "pov",
];

const PLATFORM_OPTIONS = ["seedance", "douyin", "shipinhao", "xhs", "bilibili", "kuaishou"];

const ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "21:9"];

const USE_CASE_OPTIONS = [
    { value: "short_drama", label: "短剧" },
    { value: "ecommerce", label: "电商广告" },
    { value: "podcast", label: "播客叙事" },
    { value: "xhs", label: "小红书图文" },
];

const TIME_OPTIONS = [
    { value: "day", label: "白天" },
    { value: "night", label: "夜晚" },
    { value: "dawn", label: "清晨" },
    { value: "dusk", label: "黄昏" },
    { value: "golden hour", label: "黄金时刻" },
];

export default function ProjectBrewView({ detail, projectId, refreshProject }: Props) {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const [form] = Form.useForm<BrewFormValues>();
    const [result, setResult] = useState<NxfCompileResult | null>(null);
    const [targetUnitId, setTargetUnitId] = useState("");
    const [landing, setLanding] = useState(false);

    const healthQuery = useQuery({
        queryKey: ["nxf", "health"],
        queryFn: ({ signal }) => nxfHealth(signal),
        refetchInterval: 30_000,
        retry: false,
    });
    const nxfOnline = healthQuery.isSuccess;
    const units = useMemo(() => detail.units.slice().sort((left, right) => left.position - right.position), [detail.units]);
    const effectiveUnitId = targetUnitId || units[0]?.id || "";
    const workspaceQuery = useQuery({
        queryKey: ["project", projectId, "unit-workspace", effectiveUnitId],
        queryFn: () => getProjectUnitWorkspace(projectId, effectiveUnitId),
        enabled: Boolean(effectiveUnitId),
    });
    const unitShotCount = workspaceQuery.data?.shots.filter((shot) => shot.unitId === effectiveUnitId).length || 0;

    const compileMutation = useMutation({
        mutationFn: async (values: BrewFormValues) => {
            const spec: NxfSceneSpec = {
                scene: { goal: values.goal.trim(), location: values.location?.trim() || "", time: values.time || "day", mood: values.mood?.trim() || "" },
                characters: (values.characters || []).filter((item) => item.identity || item.role),
                visual: { style: values.style?.trim() || "cinematic, live-action", camera: values.camera || "static", lighting: values.lighting?.trim() || "" },
                beats: (values.beats || [])
                    .filter((item) => typeof item.start === "number" && typeof item.end === "number" && item.action?.trim())
                    .map((item) => ({ start: item.start as number, end: item.end as number, action: (item.action || "").trim() })),
                constraints: { identity_lock: Boolean(values.identityLock), continuity_lock: Boolean(values.continuityLock), positive_only: values.positiveOnly !== false },
                brief: { platform: values.platform || "seedance", total_seconds: values.totalSeconds || 15, aspect: values.aspect || "16:9", use_case: values.useCase || "" },
            };
            return nxfSceneCompile(spec, 5);
        },
        onSuccess: (data) => {
            setResult(data);
            message.success(`编译完成：${data.shots.length} 个镜头，Gate ${data.gate.overall === "PASS" ? "全部通过" : "存在不合规项"}`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "编译失败"),
    });

    const landedShotInputs = useMemo(() => (result ? result.shots.map((contract) => toShotInput(contract, effectiveUnitId)) : []), [result, effectiveUnitId]);

    const appendShots = async () => {
        if (!result || !effectiveUnitId) { message.warning("请先编译，并选择要写入的章节"); return; }
        setLanding(true);
        try {
            for (const input of landedShotInputs) {
                await saveProjectShot(projectId, input);
            }
            refreshProject();
            message.success(`已把 ${landedShotInputs.length} 个镜头追加到「${units.find((unit) => unit.id === effectiveUnitId)?.title || "章节"}」`);
            navigate(`/projects/${projectId}/workflow/${effectiveUnitId}/video`);
        } catch (error) {
            message.error(error instanceof Error ? `写入中断：${error.message}` : "写入中断");
        } finally {
            setLanding(false);
        }
    };

    const replaceUnitShots = () => {
        if (!result || !effectiveUnitId) { message.warning("请先编译，并选择要写入的章节"); return; }
        const unit = units.find((item) => item.id === effectiveUnitId);
        const existing = unitShotCount;
        modal.confirm({
            title: "替换本章镜头？",
            content: `将清空「${unit?.title || "当前章节"}」现有 ${existing} 个镜头，写入编译出的 ${landedShotInputs.length} 个镜头。此操作不可撤销。`,
            okText: "替换",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                setLanding(true);
                try {
                    await replaceProjectUnitShots(projectId, effectiveUnitId, landedShotInputs.map(({ unitId: _unitId, ...rest }) => rest));
                    refreshProject();
                    message.success("章节镜头已替换");
                    navigate(`/projects/${projectId}/workflow/${effectiveUnitId}/video`);
                } catch (error) {
                    message.error(error instanceof Error ? `替换失败：${error.message}` : "替换失败");
                } finally {
                    setLanding(false);
                }
            },
        });
    };

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <FlaskConical className="size-4 text-[var(--workspace-accent)]" />
                <span className="text-[var(--fs-body)] font-semibold text-foreground/90">酿造工坊</span>
                <span className="text-[var(--fs-caption)] text-foreground/45">把一句创作意图编译成合规分镜：方法论路由 → 镜头骨架 → H3 官方提示词 → 质量 Gate，一键落进项目章节</span>
                <span className="ml-auto flex items-center gap-1.5 text-[var(--fs-tiny)] text-foreground/45">
                    <span className={`size-1.5 rounded-full ${nxfOnline ? "bg-emerald-500" : "bg-foreground/25"}`} />
                    {nxfOnline ? `酿笑坊能力服务 · ${healthQuery.data?.cards_total || 0} 张配方卡` : "酿笑坊能力服务未启动（影策控制台 → 酿笑坊能力服务）"}
                </span>
            </div>

            {!nxfOnline ? (
                <Alert
                    type="warning"
                    showIcon
                    message="酿笑坊能力服务（端口 8823）没有响应"
                    description="打开影策控制台（启动影策.bat），在面板里启动「酿笑坊能力服务」，然后回到本页刷新。没有它，酿造工坊只能看不能编译。"
                />
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(380px,460px)_1fr]">
                <section className="rounded-lg border border-border bg-surface p-4">
                    <Form
                        form={form}
                        layout="vertical"
                        disabled={!nxfOnline}
                        initialValues={{
                            time: "day",
                            camera: "static",
                            platform: "seedance",
                            aspect: detail.project.aspectRatio || "16:9",
                            totalSeconds: 15,
                            positiveOnly: true,
                            style: "cinematic, live-action",
                        }}
                        onFinish={(values) => compileMutation.mutate(values)}
                    >
                        <div className="mb-2 text-[var(--fs-caption)] font-semibold text-foreground/80">场次意图</div>
                        <Form.Item name="goal" label="这场戏要达成什么（必填）" rules={[{ required: true, message: "先说清这场戏要干什么" }]}>
                            <Input.TextArea rows={2} placeholder="例：社畜下班偶遇前同事，两人尴尬又爆笑地互吹近况" />
                        </Form.Item>
                        <div className="grid grid-cols-2 gap-3">
                            <Form.Item name="location" label="地点"><Input placeholder="例：便利店门口" /></Form.Item>
                            <Form.Item name="mood" label="情绪基调"><Input placeholder="例：awkward comedy" /></Form.Item>
                            <Form.Item name="time" label="时间"><Select options={TIME_OPTIONS} /></Form.Item>
                            <Form.Item name="style" label="视觉风格"><Input placeholder="cinematic, live-action" /></Form.Item>
                        </div>

                        <div className="mb-2 mt-1 text-[var(--fs-caption)] font-semibold text-foreground/80">节拍表（每拍一个镜头）</div>
                        <Form.List name="beats">
                            {(fields, { add, remove }) => (
                                <div className="flex flex-col gap-2">
                                    {fields.map((field) => (
                                        <div key={field.key} className="rounded-md border border-border/70 bg-surface-hover/40 p-2">
                                            <div className="flex items-center gap-2">
                                                <Form.Item name={[field.name, "start"]} noStyle rules={[{ required: true, message: "起点" }]}>
                                                    <InputNumber min={0} max={60} step={0.5} placeholder="起(秒)" className="!w-20" />
                                                </Form.Item>
                                                <span className="text-foreground/35">→</span>
                                                <Form.Item name={[field.name, "end"]} noStyle rules={[{ required: true, message: "终点" }]}>
                                                    <InputNumber min={0} max={60} step={0.5} placeholder="止(秒)" className="!w-20" />
                                                </Form.Item>
                                                <Button type="text" size="small" className="!ml-auto" icon={<Trash2 className="size-3.5" />} onClick={() => remove(field.name)} aria-label="删除节拍" />
                                            </div>
                                            <Form.Item name={[field.name, "action"]} noStyle rules={[{ required: true, message: "动作不能为空" }]}>
                                                <Input.TextArea rows={2} placeholder="English action：The protagonist pushes open the door, eyes glued to his phone（正文须英文，中文对白写在角色区之外由后续处理）" />
                                            </Form.Item>
                                        </div>
                                    ))}
                                    <Button type="dashed" block icon={<Plus className="size-3.5" />} onClick={() => add({ start: 0, end: 4 })}>添加节拍</Button>
                                </div>
                            )}
                        </Form.List>

                        <Collapse
                            ghost
                            size="small"
                            className="brew-advanced-collapse"
                            items={[
                                {
                                    key: "chars",
                                    label: <span className="text-[var(--fs-caption)] text-foreground/70">角色（可选）</span>,
                                    children: (
                                        <Form.List name="characters">
                                            {(fields, { add, remove }) => (
                                                <div className="flex flex-col gap-2">
                                                    {fields.map((field) => (
                                                        <div key={field.key} className="flex items-start gap-1">
                                                            <div className="grid flex-1 grid-cols-3 gap-2">
                                                                <Form.Item name={[field.name, "role"]} noStyle><Input placeholder="角色名" /></Form.Item>
                                                                <Form.Item name={[field.name, "identity"]} noStyle><Input placeholder="身份设定" /></Form.Item>
                                                                <Form.Item name={[field.name, "state"]} noStyle><Input placeholder="此刻状态" /></Form.Item>
                                                            </div>
                                                            <Button type="text" size="small" className="!mt-1" icon={<Trash2 className="size-3.5" />} onClick={() => remove(field.name)} aria-label="删除角色" />
                                                        </div>
                                                    ))}
                                                    <Button type="dashed" size="small" block icon={<Plus className="size-3.5" />} onClick={() => add()}>添加角色</Button>
                                                </div>
                                            )}
                                        </Form.List>
                                    ),
                                },
                                {
                                    key: "visual",
                                    label: <span className="text-[var(--fs-caption)] text-foreground/70">镜头与光线（可选）</span>,
                                    children: (
                                        <div className="grid grid-cols-2 gap-3">
                                            <Form.Item name="camera" label="运镜"><Select options={CAMERA_OPTIONS.map((item) => ({ value: item }))} allowClear /></Form.Item>
                                            <Form.Item name="lighting" label="光线"><Input placeholder="例：night neon glow" /></Form.Item>
                                        </div>
                                    ),
                                },
                                {
                                    key: "brief",
                                    label: <span className="text-[var(--fs-caption)] text-foreground/70">约束与投放（可选）</span>,
                                    children: (
                                        <div className="flex flex-col gap-3">
                                            <div className="flex flex-wrap gap-4">
                                                <Form.Item name="identityLock" label="身份锁定" valuePropName="checked"><Switch size="small" /></Form.Item>
                                                <Form.Item name="continuityLock" label="连贯锁定" valuePropName="checked"><Switch size="small" /></Form.Item>
                                                <Form.Item name="positiveOnly" label="正向表述" valuePropName="checked"><Switch size="small" /></Form.Item>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <Form.Item name="platform" label="投放平台"><Select options={PLATFORM_OPTIONS.map((item) => ({ value: item }))} /></Form.Item>
                                                <Form.Item name="useCase" label="用途"><Select options={USE_CASE_OPTIONS} allowClear /></Form.Item>
                                                <Form.Item name="totalSeconds" label="目标总时长（秒）"><InputNumber min={4} max={60} /></Form.Item>
                                                <Form.Item name="aspect" label="画幅"><Select options={ASPECT_OPTIONS.map((item) => ({ value: item }))} /></Form.Item>
                                            </div>
                                        </div>
                                    ),
                                },
                            ]}
                        />

                        <Button
                            type="primary"
                            block
                            htmlType="submit"
                            className="!mt-3"
                            icon={<WandSparkles className="size-3.5" />}
                            loading={compileMutation.isPending}
                        >
                            编译成镜头与提示词
                        </Button>
                        <div className="mt-1.5 text-center text-[var(--fs-tiny)] text-foreground/38">不填节拍也能编译（出 4 秒占位镜头）；Gate 只报告不拦截，落不落库你拍板</div>
                    </Form>
                </section>

                <section className="flex min-w-0 flex-col gap-3">
                    {!result ? (
                        <div className="grid place-items-center rounded-lg border border-dashed border-border bg-surface/60 py-16">
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={<span className="text-foreground/45">左边填好意图，点「编译」——配方推荐、镜头卡、Gate 报告会出现在这里</span>}
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <Tag color={result.gate.overall === "PASS" ? "green" : "red"} icon={result.gate.overall === "PASS" ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}>
                                    Gate {result.gate.overall}
                                </Tag>
                                <Tag>{result.shots.length} 镜头</Tag>
                                <Tag>节拍覆盖 {result.coverage.beats_mapped}/{result.coverage.beats_total}</Tag>
                                {result.adapter?.platform ? <Tag>平台 {result.adapter.platform}</Tag> : null}
                            </div>

                            {result.warnings.length ? (
                                <Alert type="warning" showIcon message={<ul className="list-disc pl-4">{result.warnings.map((item) => <li key={item}>{item}</li>)}</ul>} />
                            ) : null}

                            {result.selected_recipes.length ? (
                                <div className="rounded-lg border border-border bg-surface p-3">
                                    <div className="mb-2 flex items-center gap-1.5 text-[var(--fs-caption)] font-semibold text-foreground/80"><Sparkles className="size-3.5 text-[var(--workspace-accent)]" />方法论配方推荐</div>
                                    <div className="flex flex-col gap-1.5">
                                        {result.selected_recipes.map((recipe) => (
                                            <div key={recipe.name} className="flex items-start gap-2">
                                                <Tag color="geekblue" className="!m-0 !shrink-0">{recipe.name}</Tag>
                                                <span className="text-[var(--fs-tiny)] leading-5 text-foreground/55">{recipe.why}</span>
                                                <span className="ml-auto shrink-0 text-[var(--fs-tiny)] tabular-nums text-foreground/38">{recipe.score.toFixed(1)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {result.selected_native_skills.length ? (
                                        <div className="mt-2 border-t border-border/60 pt-2">
                                            {result.selected_native_skills.map((skill) => (
                                                <div key={skill.tag} className="flex items-baseline gap-2 text-[var(--fs-tiny)] text-foreground/55">
                                                    <Tag className="!m-0 !shrink-0">{skill.tag}</Tag>
                                                    <span>{skill.suggest} · {skill.reason}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

                            <Collapse
                                className="brew-shots-collapse"
                                items={result.shots.map((contract, index) => ({
                                    key: String(index),
                                    label: (
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <span className="font-medium text-foreground/85">{contract.shot.title}</span>
                                            <span className="text-[var(--fs-tiny)] text-foreground/45">{(contract.shot.duration_ms / 1000).toFixed(1)}s · {contract.shot.shot_size} · {contract.shot.camera_movement}</span>
                                            {contract.gate.verdict === "PASS"
                                                ? <Tag color="green" className="!m-0">PASS</Tag>
                                                : <Tooltip title={contract.gate.failures.join("；")}><Tag color="red" className="!m-0">FAIL ×{contract.gate.failures.length}</Tag></Tooltip>}
                                        </div>
                                    ),
                                    children: (
                                        <div className="flex flex-col gap-2">
                                            {contract.gate.failures.length ? (
                                                <Alert type="error" showIcon message={<ul className="list-disc pl-4">{contract.gate.failures.map((item) => <li key={item}>{item}</li>)}</ul>} />
                                            ) : null}
                                            <PromptBlock label="视频提示词" text={contract.render.video_prompt} />
                                            <PromptBlock label="首帧图提示词" text={contract.render.image_prompt} />
                                            {contract.render.negative_prompt ? <PromptBlock label="负向提示词" text={contract.render.negative_prompt} /> : null}
                                            {contract.shot.continuity_notes ? (
                                                <div className="text-[var(--fs-tiny)] text-foreground/50">连贯性：{contract.shot.continuity_notes}</div>
                                            ) : null}
                                        </div>
                                    ),
                                }))}
                            />

                            <div className="rounded-lg border border-border bg-surface p-3">
                                <div className="mb-2 text-[var(--fs-caption)] font-semibold text-foreground/80">写入项目</div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Select
                                        className="!min-w-48 !flex-1"
                                        placeholder="选择章节"
                                        value={effectiveUnitId || undefined}
                                        onChange={setTargetUnitId}
                                        options={units.map((unit) => ({ value: unit.id, label: unit.title }))}
                                        notFoundContent={<span className="text-foreground/45">项目还没有章节，先到「剧情章节」建一个</span>}
                                    />
                                    <Button type="primary" loading={landing} disabled={!units.length} onClick={() => void appendShots()}>追加到本章</Button>
                                    <Button danger loading={landing} disabled={!units.length} onClick={replaceUnitShots}>替换本章镜头</Button>
                                </div>
                                <div className="mt-1.5 text-[var(--fs-tiny)] text-foreground/38">追加 = 保留现有镜头往后加；替换 = 清空该章节镜头后写入编译结果。写入后跳到分镜制作页。</div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}

function PromptBlock({ label, text }: { label: string; text: string }) {
    if (!text) return null;
    return (
        <div>
            <div className="mb-1 text-[var(--fs-tiny)] font-medium text-foreground/60">{label}</div>
            <pre className="thin-scrollbar max-h-44 overflow-auto rounded-md border border-border/70 bg-surface-hover/50 p-2 text-[var(--fs-tiny)] leading-5 whitespace-pre-wrap text-foreground/75">{text}</pre>
        </div>
    );
}

function toShotInput(contract: NxfShotContract, unitId: string): { unitId: string; title: string; description: string; durationMs: number; revision: Partial<ShotRevisionInput> } {
    const shot = contract.shot;
    const revision: Partial<ShotRevisionInput> = {
        plotDescription: shot.plot_description,
        action: shot.action,
        dialogue: shot.dialogue?.length ? JSON.stringify(shot.dialogue) : "",
        shotSize: shot.shot_size,
        cameraAngle: shot.camera_angle,
        cameraMovement: shot.camera_movement,
        durationMs: shot.duration_ms,
        imagePrompt: contract.render.image_prompt,
        videoPrompt: contract.render.video_prompt,
        negativePrompt: contract.render.negative_prompt,
        continuityNotes: shot.continuity_notes,
        actionBeats: shot.action_beats,
    };
    return {
        unitId,
        title: shot.title,
        description: shot.plot_description || "",
        durationMs: shot.duration_ms,
        revision,
    };
}
