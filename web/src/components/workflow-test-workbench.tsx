import { App, Button, Empty, Input, InputNumber, Progress, Select, Switch } from "antd";
import { FileAudio, FileImage, Film, Grip, Play, RotateCcw, Square, Upload, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { generationErrorMessage } from "@/lib/generation-error";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { runBackendGenerationTask, type BackendGenerationResult } from "@/services/api/generation-task";
import { useConfigStore, type AiConfig, type RunningHubCapability, type WorkflowFieldMapping } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type WorkflowProvider = "runninghub" | "comfyui";
type MediaKind = "image" | "video" | "audio";
type Point = { x: number; y: number };
type NodePositionMap = Record<string, Point>;
type TestFile = { id: string; file: File; url: string };

type WorkflowTestWorkbenchProps = {
    provider: WorkflowProvider;
    workflowId: string;
    workflowKind?: "workflow" | "app";
    title: string;
    capability: RunningHubCapability;
    fields: WorkflowFieldMapping[];
    disabled?: boolean;
    disabledReason?: string;
};

const initialPositions: NodePositionMap = {
    prompt: { x: 36, y: 46 },
    image: { x: 36, y: 244 },
    video: { x: 36, y: 410 },
    audio: { x: 36, y: 576 },
    workflow: { x: 382, y: 132 },
    output: { x: 758, y: 188 },
};

export function WorkflowTestWorkbench({ provider, workflowId, workflowKind = "workflow", title, capability, fields, disabled = false, disabledReason }: WorkflowTestWorkbenchProps) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const [prompt, setPrompt] = useState("");
    const [files, setFiles] = useState<Record<MediaKind, TestFile[]>>({ image: [], video: [], audio: [] });
    const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => initialFieldValues(fields, config));
    const [positions, setPositions] = useState<NodePositionMap>(initialPositions);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [stage, setStage] = useState("等待运行");
    const [result, setResult] = useState<BackendGenerationResult | null>(null);
    const [error, setError] = useState("");
    const canvasRef = useRef<HTMLDivElement>(null);
    const autoOutputXRef = useRef(initialPositions.output.x);
    const [canvasWidth, setCanvasWidth] = useState(1040);
    const abortRef = useRef<AbortController | null>(null);
    const filesRef = useRef(files);

    const activeFields = useMemo(() => fields.filter((field) => field.enabled !== false), [fields]);
    const slots = useMemo(() => mediaSlotCounts(activeFields), [activeFields]);
    const imageReferenceCount = useMemo(() => referenceImageSlotCount(activeFields), [activeFields]);
    const maskEnabled = useMemo(() => activeFields.some((field) => field.source === "mask"), [activeFields]);
    const parameterFields = useMemo(() => uniqueParameterFields(activeFields), [activeFields]);
    const visibleMediaKinds = (Object.keys(slots) as MediaKind[]).filter((kind) => slots[kind] > 0);
    const resultUrls = generationResultUrls(result, capability);

    useEffect(() => {
        setFieldValues(initialFieldValues(fields, config));
        setResult(null);
        setError("");
        setProgress(0);
        setStage("等待运行");
    }, [workflowId, workflowKind, fields, config.size, config.quality, config.vquality]);

    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const scroll = canvas?.parentElement;
        if (!scroll) return;
        const measure = () => setCanvasWidth(Math.max(1040, scroll.clientWidth));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scroll);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const nextOutputX = Math.max(758, canvasWidth - 324 - 36);
        setPositions((current) => {
            // 用户手动拖动过输出节点后尊重其位置，不再被窗口尺寸变化覆盖。
            if (current.output.x !== autoOutputXRef.current || current.output.x === nextOutputX) return current;
            autoOutputXRef.current = nextOutputX;
            return { ...current, output: { ...current.output, x: nextOutputX } };
        });
    }, [canvasWidth]);

    useEffect(
        () => () => {
            abortRef.current?.abort();
            Object.values(filesRef.current)
                .flat()
                .forEach((item) => URL.revokeObjectURL(item.url));
        },
        [],
    );

    const replaceFiles = (kind: MediaKind, selected: FileList | null) => {
        if (!selected?.length) return;
        const limit = Math.max(1, slots[kind]);
        const next = Array.from(selected)
            .slice(0, limit)
            .map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
        setFiles((current) => {
            current[kind].forEach((item) => URL.revokeObjectURL(item.url));
            return { ...current, [kind]: next };
        });
    };

    const resetTest = () => {
        Object.values(files)
            .flat()
            .forEach((item) => URL.revokeObjectURL(item.url));
        setFiles({ image: [], video: [], audio: [] });
        setPrompt("");
        setFieldValues(initialFieldValues(fields, config));
        const nextOutputX = Math.max(758, canvasWidth - 324 - 36);
        autoOutputXRef.current = nextOutputX;
        setPositions({ ...initialPositions, output: { ...initialPositions.output, x: nextOutputX } });
        setResult(null);
        setError("");
        setProgress(0);
        setStage("等待运行");
    };

    const runTest = async () => {
        if (disabled) return message.warning(disabledReason || "请先完成工作流配置");
        const missing = missingRequiredInput(activeFields, prompt, files, fieldValues);
        if (missing) return message.warning(missing);
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setResult(null);
        setError("");
        setProgress(0);
        setStage("正在提交任务");
        try {
            const testConfig = buildTestConfig(config, provider, workflowId, workflowKind, activeFields, fieldValues);
            const response = await runBackendGenerationTask({
                mode: capability,
                prompt,
                config: testConfig,
                referenceImages: files.image.slice(0, imageReferenceCount).map(toReferenceImage),
                referenceVideos: files.video.map(toReferenceVideo),
                referenceAudios: files.audio.map(toReferenceAudio),
                mask: maskEnabled && files.image[imageReferenceCount] ? toReferenceImage(files.image[imageReferenceCount]) : undefined,
                signal: controller.signal,
                metadata: { source: "workflow_settings_test", workflowProvider: provider, workflowId },
                onTaskUpdate: (task) => {
                    setProgress(Math.max(0, Math.min(100, Number(task.progress) || 0)));
                    setStage(taskStageLabel(task.status, task.stage));
                },
            });
            setResult(response);
            setProgress(100);
            setStage("测试完成");
            message.success("工作流测试完成");
        } catch (reason) {
            if (controller.signal.aborted) {
                setStage("已停止等待");
                return;
            }
            const detail = generationErrorMessage(reason);
            setError(detail);
            setStage("测试失败");
            message.error(detail);
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
        }
    };

    const stopTest = () => {
        abortRef.current?.abort();
        setStage("正在停止等待");
    };

    return (
        <div className="workflow-test-workbench">
            <div className="workflow-test-toolbar">
                <div className="min-w-0">
                    <strong>{title || workflowId || "未选择工作流"}</strong>
                    <span>
                        {provider === "runninghub" ? "RunningHub" : "ComfyUI Bridge"} · {capabilityName(capability)}工作流 · 测试值不会覆盖保存配置
                    </span>
                </div>
                <div className="workflow-test-toolbar-actions">
                    <Button icon={<RotateCcw className="size-4" />} disabled={running} onClick={resetTest}>
                        重置测试
                    </Button>
                    {running ? (
                        <Button danger icon={<Square className="size-4" />} onClick={stopTest}>
                            停止等待
                        </Button>
                    ) : (
                        <Button type="primary" icon={<Play className="size-4" />} disabled={disabled} onClick={() => void runTest()}>
                            运行测试
                        </Button>
                    )}
                </div>
            </div>
            {disabled && disabledReason ? <div className="workflow-test-notice">{disabledReason}</div> : null}
            <div className="workflow-test-canvas-scroll">
                <div ref={canvasRef} className="workflow-test-canvas" data-canvas-no-zoom>
                    <svg className="workflow-test-lines" aria-hidden="true" viewBox={`0 0 ${canvasWidth} 760`} preserveAspectRatio="none">
                        <WorkflowLine from={positions.prompt} to={positions.workflow} fromWidth={284} toOffsetY={74} />
                        {visibleMediaKinds.map((kind, index) => (
                            <WorkflowLine key={kind} from={positions[kind]} to={positions.workflow} fromWidth={284} fromOffsetY={64} toOffsetY={112 + index * 26} />
                        ))}
                        <WorkflowLine from={positions.workflow} to={positions.output} fromWidth={324} fromOffsetY={84} toOffsetY={70} />
                    </svg>

                    <WorkflowNode id="prompt" title="提示词" icon={<WandSparkles />} position={positions.prompt} onMove={(point) => setPositions((current) => ({ ...current, prompt: point }))}>
                        <Input.TextArea value={prompt} autoSize={{ minRows: 4, maxRows: 7 }} placeholder="输入本次测试提示词" onChange={(event) => setPrompt(event.target.value)} />
                    </WorkflowNode>

                    {visibleMediaKinds.map((kind) => (
                        <WorkflowNode
                            key={kind}
                            id={kind}
                            title={`${kind === "image" && maskEnabled ? "图片 / 蒙版" : mediaName(kind)}素材 · ${slots[kind]} 个槽位`}
                            icon={mediaIcon(kind)}
                            position={positions[kind]}
                            onMove={(point) => setPositions((current) => ({ ...current, [kind]: point }))}
                        >
                            <MediaPicker kind={kind} limit={slots[kind]} files={files[kind]} maskIndex={kind === "image" && maskEnabled ? imageReferenceCount : undefined} onChange={(selected) => replaceFiles(kind, selected)} />
                        </WorkflowNode>
                    ))}

                    <WorkflowNode id="workflow" title={title || "工作流动态参数"} icon={<Grip />} position={positions.workflow} wide onMove={(point) => setPositions((current) => ({ ...current, workflow: point }))}>
                        <div className="workflow-test-parameters">
                            {parameterFields.length ? (
                                parameterFields.map((field) => {
                                    const key = testFieldKey(field);
                                    return <WorkflowParameter key={key} field={field} value={fieldValues[key]} onChange={(value) => setFieldValues((current) => ({ ...current, [key]: value }))} />;
                                })
                            ) : (
                                <span className="workflow-test-empty-text">此工作流没有额外动态参数</span>
                            )}
                        </div>
                    </WorkflowNode>

                    <WorkflowNode
                        id="output"
                        title={`${capabilityName(capability)}输出`}
                        icon={capability === "image" ? <FileImage /> : capability === "video" ? <Film /> : <FileAudio />}
                        position={positions.output}
                        onMove={(point) => setPositions((current) => ({ ...current, output: point }))}
                    >
                        <div className="workflow-test-output">{resultUrls.length ? <ResultPreview capability={capability} urls={resultUrls} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error || stage} />}</div>
                        <Progress percent={progress} size="small" status={error ? "exception" : running ? "active" : undefined} showInfo={running || progress > 0} />
                    </WorkflowNode>
                </div>
            </div>
        </div>
    );
}

function WorkflowNode({ id, title, icon, position, onMove, wide = false, children }: { id: string; title: string; icon: ReactNode; position: Point; onMove: (point: Point) => void; wide?: boolean; children: ReactNode }) {
    const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const target = event.currentTarget.parentElement;
        const canvas = target?.parentElement;
        if (!target || !canvas) return;
        const rect = target.getBoundingClientRect();
        dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        const canvas = event.currentTarget.parentElement?.parentElement;
        const node = event.currentTarget.parentElement;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const width = wide ? 324 : 284;
        const height = node?.offsetHeight || 92;
        onMove({ x: Math.max(12, Math.min(rect.width - width - 12, event.clientX - rect.left - dragRef.current.offsetX)), y: Math.max(12, Math.min(rect.height - height - 12, event.clientY - rect.top - dragRef.current.offsetY)) });
    };
    const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    return (
        <section className={`workflow-test-node${wide ? " is-wide" : ""}`} style={{ transform: `translate(${position.x}px, ${position.y}px)` }} data-node-id={id}>
            <div className="workflow-test-node-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
                <span>{icon}</span>
                <strong title={title}>{title}</strong>
                <Grip className="workflow-test-node-grip" />
            </div>
            <div className="workflow-test-node-body">{children}</div>
            <i className="workflow-test-port is-input" />
            <i className="workflow-test-port is-output" />
        </section>
    );
}

function WorkflowLine({ from, to, fromWidth, fromOffsetY = 54, toOffsetY }: { from: Point; to: Point; fromWidth: number; fromOffsetY?: number; toOffsetY: number }) {
    const x1 = from.x + fromWidth;
    const y1 = from.y + fromOffsetY;
    const x2 = to.x;
    const y2 = to.y + toOffsetY;
    const curve = Math.max(52, Math.abs(x2 - x1) * 0.46);
    return <path d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`} />;
}

function MediaPicker({ kind, limit, files, maskIndex, onChange }: { kind: MediaKind; limit: number; files: TestFile[]; maskIndex?: number; onChange: (files: FileList | null) => void }) {
    return (
        <label className="workflow-test-upload">
            <input
                type="file"
                hidden
                multiple={limit > 1}
                accept={kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*"}
                onChange={(event) => {
                    onChange(event.target.files);
                    event.currentTarget.value = "";
                }}
            />
            {files.length ? (
                <div className="workflow-test-file-list">
                    {files.map((item, index) => (
                        <span key={item.id} title={item.file.name}>
                            {kind === "image" ? <img src={item.url} alt="" /> : mediaIcon(kind)}
                            <b>{maskIndex === index ? "蒙版" : index + 1}</b>
                            <em>{item.file.name}</em>
                        </span>
                    ))}
                </div>
            ) : (
                <span>
                    <Upload />
                    选择{mediaName(kind)}（最多 {limit} 个）
                </span>
            )}
        </label>
    );
}

function WorkflowParameter({ field, value, onChange }: { field: WorkflowFieldMapping; value: unknown; onChange: (value: unknown) => void }) {
    const label = field.label || field.fieldName;
    const type = String(field.fieldType || "").toUpperCase();
    if (field.randomEnabled && !field.source)
        return (
            <label>
                <span title={`${field.nodeId}.${field.fieldName}`}>
                    {label}
                    <small>
                        {field.nodeId}.{field.fieldName}
                    </small>
                </span>
                <Input value="每次运行随机生成" disabled />
            </label>
        );
    return (
        <label>
            <span title={`${field.nodeId}.${field.fieldName}`}>
                {label}
                <small>
                    {field.nodeId}.{field.fieldName}
                </small>
            </span>
            {Array.isArray(field.options) && field.options.length ? (
                <Select showSearch value={value} options={field.options.map((option) => ({ label: String(option), value: option }))} onChange={onChange} />
            ) : type === "BOOLEAN" || typeof value === "boolean" ? (
                <Switch checked={value === true || value === "true"} onChange={onChange} />
            ) : type === "NUMBER" || typeof value === "number" ? (
                <InputNumber className="w-full" value={numberValue(value)} min={numberValue(field.min)} max={numberValue(field.max)} step={numberValue(field.step)} onChange={onChange} />
            ) : (
                <Input value={displayValue(value)} onChange={(event) => onChange(event.target.value)} />
            )}
        </label>
    );
}

function ResultPreview({ capability, urls }: { capability: RunningHubCapability; urls: string[] }) {
    if (capability === "video") return <video src={urls[0]} controls playsInline />;
    if (capability === "audio") return <audio src={urls[0]} controls />;
    return (
        <div className="workflow-test-image-results">
            {urls.map((url) => (
                <img key={url} src={url} alt="工作流测试输出" />
            ))}
        </div>
    );
}

// 测试参数只写入本次任务配置副本，正式工作流仍由设置页的显式保存动作维护。
function buildTestConfig(config: AiConfig, provider: WorkflowProvider, workflowId: string, workflowKind: "workflow" | "app", fields: WorkflowFieldMapping[], values: Record<string, unknown>): AiConfig {
    const patchedFields = fields.map((field) => {
        const value = values[testFieldKey(field)];
        return value === undefined ? { ...field } : { ...field, fieldValue: value };
    });
    const next: AiConfig = { ...config, taskWorkflowProvider: provider };
    applySourceValues(next, fields, values);
    if (provider === "runninghub") {
        next.runningHub = {
            ...config.runningHub,
            enabled: true,
            workflowId,
            selectedKind: workflowKind,
            workflows: config.runningHub.workflows.map((item) => (item.workflowId.trim() === workflowId.trim() && (item.kind === "app" ? "app" : "workflow") === workflowKind ? { ...item, fields: patchedFields } : item)),
        };
    } else {
        next.comfyBridge = { ...config.comfyBridge, enabled: true, workflowId, workflows: config.comfyBridge.workflows.map((item) => (item.workflowId.trim() === workflowId.trim() ? { ...item, fields: patchedFields } : item)) };
    }
    return next;
}

function applySourceValues(config: AiConfig, fields: WorkflowFieldMapping[], values: Record<string, unknown>) {
    const assigned = new Set<string>();
    fields.forEach((field) => {
        const source = String(field.source || "");
        if (!source || assigned.has(source) || isPromptOrMediaSource(source)) return;
        assigned.add(source);
        const value = values[testFieldKey(field)];
        if (source === "size" || source === "aspectRatio") config.size = String(value || config.size);
        else if (source === "width" || source === "height") {
            const width = String(values[sourceValueKey(fields, "width")] || dimensionFromSize(config.size, 0));
            const height = String(values[sourceValueKey(fields, "height")] || dimensionFromSize(config.size, 1));
            if (width && height) config.size = `${width}x${height}`;
        } else if (source in config && typeof config[source as keyof AiConfig] === "string") {
            (config as unknown as Record<string, unknown>)[source] = String(value ?? "");
        }
    });
}

function initialFieldValues(fields: WorkflowFieldMapping[], config: AiConfig) {
    const values: Record<string, unknown> = {};
    fields.forEach((field) => {
        if (isPromptOrMediaSource(String(field.source || ""))) return;
        const source = String(field.source || "");
        const workflowValue = field.fieldValue ?? field.value ?? field.defaultValue ?? field.default;
        const configValue = source === "aspectRatio" ? config.size : source === "width" ? dimensionFromSize(config.size, 0) : source === "height" ? dimensionFromSize(config.size, 1) : (config as unknown as Record<string, unknown>)[source];
        values[testFieldKey(field)] = workflowValue !== undefined && workflowValue !== "" ? workflowValue : configValue !== undefined && configValue !== "" ? configValue : "";
    });
    return values;
}

function uniqueParameterFields(fields: WorkflowFieldMapping[]) {
    const keys = new Set<string>();
    return fields.filter((field) => {
        const source = String(field.source || "");
        if (isPromptOrMediaSource(source)) return false;
        const key = testFieldKey(field);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
    });
}

function testFieldKey(field: WorkflowFieldMapping) {
    const source = String(field.source || "");
    return source ? `source:${source}` : `field:${field.nodeId}:${field.fieldName}`;
}

function sourceValueKey(fields: WorkflowFieldMapping[], source: string) {
    const field = fields.find((item) => item.source === source);
    return field ? testFieldKey(field) : `source:${source}`;
}

function mediaSlotCounts(fields: WorkflowFieldMapping[]) {
    const result: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 };
    const imageReferences = referenceImageSlotCount(fields);
    const hasMask = fields.some((field) => field.source === "mask");
    result.image = imageReferences + (hasMask ? 1 : 0);
    fields.forEach((field) => {
        const source = String(field.source || "");
        if (source === "referenceVideo") result.video = Math.max(result.video, Number(field.sourceIndex) + 1 || 1);
        if (source === "referenceAudio") result.audio = Math.max(result.audio, Number(field.sourceIndex) + 1 || 1);
    });
    return result;
}

function missingRequiredInput(fields: WorkflowFieldMapping[], prompt: string, files: Record<MediaKind, TestFile[]>, values: Record<string, unknown>) {
    if (!prompt.trim()) return "请填写测试提示词";
    const imageReferences = referenceImageSlotCount(fields);
    for (const field of fields) {
        if (!field.required) continue;
        const source = String(field.source || "");
        if (source === "prompt" && !prompt.trim()) return "请填写测试提示词";
        const kind = source === "referenceImage" || source === "mask" ? "image" : source === "referenceVideo" ? "video" : source === "referenceAudio" ? "audio" : null;
        const index = source === "mask" ? imageReferences : source === "referenceImage" ? Math.max(0, (Number(field.imageOrder) || 1) - 1) : Math.max(0, Number(field.sourceIndex) || 0);
        if (kind && !files[kind][index]) return `请上传第 ${index + 1} 个${mediaName(kind)}素材`;
        if (!source && !field.randomEnabled && isEmptyTestValue(values[testFieldKey(field)])) return `请填写动态参数：${field.label || field.fieldName}`;
    }
    return "";
}

function referenceImageSlotCount(fields: WorkflowFieldMapping[]) {
    return fields.reduce((count, field) => (field.source === "referenceImage" ? Math.max(count, Number(field.imageOrder) || Number(field.sourceIndex) + 1 || 1) : count), 0);
}

function isPromptOrMediaSource(source: string) {
    return ["prompt", "referenceImage", "referenceVideo", "referenceAudio", "mask"].includes(source);
}

function generationResultUrls(result: BackendGenerationResult | null, capability: RunningHubCapability) {
    const media = capability === "image" ? result?.images || [] : capability === "video" ? (result?.video ? [result.video] : []) : result?.audio ? [result.audio] : [];
    return media
        .map((item) => {
            const resourceId = resourceIdFromStorageKey(item.storageKey);
            return resourceId ? resourceFileUrl(resourceId) : item.dataUrl || "";
        })
        .filter(Boolean);
}

function toReferenceImage(item: TestFile): ReferenceImage {
    return { id: item.id, name: item.file.name, type: item.file.type, dataUrl: item.url, bytes: item.file.size };
}
function toReferenceVideo(item: TestFile): ReferenceVideo {
    return { id: item.id, name: item.file.name, type: item.file.type, url: item.url, bytes: item.file.size };
}
function toReferenceAudio(item: TestFile): ReferenceAudio {
    return { id: item.id, name: item.file.name, type: item.file.type, url: item.url, bytes: item.file.size };
}
function dimensionFromSize(size: string, index: number) {
    const normalized = size.toLowerCase().trim();
    const pixels = normalized.split("x");
    if (pixels.length === 2 && pixels.every((item) => Number(item.trim()) > 0)) return pixels[index]?.trim() || "";
    const ratio = normalized
        .replace(/-(1k|2k|4k)$/, "")
        .split(":")
        .map(Number);
    if (ratio.length !== 2 || ratio.some((item) => !Number.isFinite(item) || item <= 0)) return "";
    const longEdgeTier = normalized.endsWith("-4k") ? 3840 : normalized.endsWith("-2k") ? 2048 : 0;
    const dimensions =
        longEdgeTier > 0
            ? ratio[0] >= ratio[1]
                ? [longEdgeTier, Math.round((longEdgeTier * ratio[1]) / ratio[0])]
                : [Math.round((longEdgeTier * ratio[0]) / ratio[1]), longEdgeTier]
            : ratio[0] >= ratio[1]
              ? [Math.round((1024 * ratio[0]) / ratio[1]), 1024]
              : [1024, Math.round((1024 * ratio[1]) / ratio[0])];
    return String(dimensions[index]);
}
function isEmptyTestValue(value: unknown) {
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
}
function numberValue(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function displayValue(value: unknown) {
    return value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
}
function capabilityName(value: RunningHubCapability) {
    return value === "video" ? "视频" : value === "audio" ? "音频" : "图片";
}
function mediaName(value: MediaKind) {
    return value === "video" ? "视频" : value === "audio" ? "音频" : "图片";
}
function mediaIcon(value: MediaKind) {
    return value === "video" ? <Film /> : value === "audio" ? <FileAudio /> : <FileImage />;
}
function taskStageLabel(status: string, stage?: string) {
    if (status === "queued") return "任务已排队";
    if (status === "succeeded") return "正在读取结果";
    if (status === "failed") return "任务失败";
    return stage ? `运行中 · ${stage}` : "工作流运行中";
}
