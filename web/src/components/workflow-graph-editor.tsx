import { Button, Empty, Select } from "antd";
import { Maximize, Power, PowerOff, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { WorkflowFieldMappingEditor } from "@/components/workflow-field-mapping-editor";
import type { WorkflowFieldMapping, WorkflowGraphPreview } from "@/stores/use-config-store";

type WorkflowNode = {
    id: string;
    title: string;
    classType: string;
    category: string;
    inputs: Record<string, unknown>;
};

type GraphNode = WorkflowNode & { x: number; y: number };
type GraphEdge = { from: string; to: string };
type WorkflowGraph = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number };

type WorkflowGraphEditorProps = {
    workflowJson?: Record<string, unknown>;
    workflowGraph?: WorkflowGraphPreview;
    fields: WorkflowFieldMapping[];
    onChange: (fields: WorkflowFieldMapping[]) => void;
    disabled?: boolean;
    emptyDescription?: string;
};

const nodeWidth = 156;
const nodeHeight = 58;
const columnGap = 58;
const rowGap = 20;
const graphPadding = 24;
const allEnabledFieldsNodeId = "__all_enabled_fields__";

export function WorkflowGraphEditor({ workflowJson, workflowGraph, fields, onChange, disabled = false, emptyDescription = "尚未读取到工作流拓扑" }: WorkflowGraphEditorProps) {
    const graph = useMemo(() => buildWorkflowGraph(workflowJson, workflowGraph), [workflowGraph, workflowJson]);
    const [selectedNodeId, setSelectedNodeId] = useState("");
    const [scale, setScale] = useState(1);
    const viewportRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
    const nodesWithFields = useMemo(() => new Set(fields.map((field) => String(field.nodeId))), [fields]);
    const enabledFields = useMemo(() => fields.filter((field) => field.enabled !== false), [fields]);
    const controllableFields = useMemo(() => fields.filter((field) => field.safeToOverride !== false), [fields]);
    const enabledControllableCount = useMemo(() => controllableFields.filter((field) => field.enabled !== false).length, [controllableFields]);
    const selectedFields = selectedNodeId === allEnabledFieldsNodeId ? enabledFields : selectedNodeId ? fields.filter((field) => String(field.nodeId) === selectedNodeId) : fields;
    const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);

    useEffect(() => {
        const firstMapped = graph.nodes.find((node) => nodesWithFields.has(node.id));
        setSelectedNodeId((current) => (current === allEnabledFieldsNodeId || graph.nodes.some((node) => node.id === current) ? current : firstMapped?.id || graph.nodes[0]?.id || ""));
    }, [graph.nodes, nodesWithFields]);

    const updateSelectedFields = (nextSelected: WorkflowFieldMapping[]) => {
        const replacements = new Map(nextSelected.map((field) => [fieldKey(field), field]));
        onChange(fields.map((field) => replacements.get(fieldKey(field)) || field));
    };

    const updateAllFields = (enabled: boolean) => {
        onChange(fields.map((field) => (field.safeToOverride === false ? field : { ...field, enabled })));
    };

    const fitGraph = useCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport || !graph.width || !graph.height) return;
        const next = Math.max(0.3, Math.min(1.6, Math.min((viewport.clientWidth - 32) / graph.width, (viewport.clientHeight - 32) / graph.height)));
        setScale(next);
        requestAnimationFrame(() => {
            viewport.scrollLeft = Math.max(0, (graph.width * next - viewport.clientWidth) / 2);
            viewport.scrollTop = Math.max(0, (graph.height * next - viewport.clientHeight) / 2);
        });
    }, [graph.height, graph.width]);

    useEffect(() => {
        if (!graph.nodes.length) return;
        // 工作流切换后自动适配一次；用户后续缩放不应被普通重渲染重置。
        const frame = requestAnimationFrame(fitGraph);
        return () => cancelAnimationFrame(frame);
    }, [fitGraph, graph.nodes.length]);

    const zoom = (direction: number) => setScale((current) => Math.max(0.3, Math.min(2.4, current * (direction > 0 ? 1.2 : 1 / 1.2))));

    const handleViewportWheel = useCallback(
        (event: WheelEvent) => {
            if (!graph.nodes.length) return;
            event.preventDefault();
            const viewport = viewportRef.current;
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            const contentX = viewport.scrollLeft + pointerX;
            const contentY = viewport.scrollTop + pointerY;
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            setScale((current) => {
                const next = Math.max(0.3, Math.min(2.4, current * factor));
                if (next === current) return current;
                const ratio = next / current;
                requestAnimationFrame(() => {
                    if (viewportRef.current !== viewport) return;
                    viewport.scrollLeft = contentX * ratio - pointerX;
                    viewport.scrollTop = contentY * ratio - pointerY;
                });
                return next;
            });
        },
        [graph.nodes.length],
    );

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        // React 的 wheel 事件在部分浏览器中可能被注册为 passive，使用原生监听确保能阻止外层页面滚动。
        viewport.addEventListener("wheel", handleViewportWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", handleViewportWheel);
    }, [handleViewportWheel]);

    const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target as Element).closest("[data-workflow-node]")) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = panRef.current;
        const viewport = viewportRef.current;
        if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
        viewport.scrollLeft = pan.left - (event.clientX - pan.x);
        viewport.scrollTop = pan.top - (event.clientY - pan.y);
    };

    return (
        <div className="workflow-graph-editor">
            <aside className="workflow-graph-sidebar">
                <div className="workflow-graph-summary">
                    <span>
                        <small>节点</small>
                        <strong>{graph.nodes.length}</strong>
                    </span>
                    <span>
                        <small>字段</small>
                        <strong>
                            {enabledFields.length} / {fields.length}
                        </strong>
                    </span>
                    <span>
                        <small>素材</small>
                        <strong>{mediaFieldCount(enabledFields)}</strong>
                    </span>
                </div>
                <div className="flex flex-wrap gap-1">
                    <Button size="small" type="text" icon={<PowerOff className="size-3.5" />} danger disabled={disabled || enabledControllableCount === 0} onClick={() => updateAllFields(false)}>
                        关闭全部开关
                    </Button>
                    <Button size="small" type="text" icon={<Power className="size-3.5" />} disabled={disabled || enabledControllableCount === controllableFields.length} onClick={() => updateAllFields(true)}>
                        开启全部开关
                    </Button>
                </div>
                <label className="workflow-graph-node-select">
                    <span>正在设置的节点</span>
                    <Select
                        showSearch
                        value={selectedNodeId || undefined}
                        placeholder="选择节点"
                        optionFilterProp="label"
                        options={[{ label: `全部已开启字段 · ${enabledFields.length}`, value: allEnabledFieldsNodeId }, ...graph.nodes.map((node) => ({ label: `${node.title} · #${node.id}`, value: node.id }))]}
                        onChange={setSelectedNodeId}
                    />
                </label>
                <div className="workflow-graph-selected-heading">
                    <strong>{selectedNodeId === allEnabledFieldsNodeId ? "全部已开启字段" : selectedNode?.title || "工作流字段"}</strong>
                    <span>{selectedNodeId === allEnabledFieldsNodeId ? `${enabledFields.length} 个字段` : selectedNode ? `${selectedNode.classType} · #${selectedNode.id}` : "选择右侧节点进行设置"}</span>
                </div>
                <WorkflowFieldMappingEditor fields={selectedFields} disabled={disabled} onChange={updateSelectedFields} />
            </aside>

            <section className="workflow-graph-stage">
                <div className="workflow-graph-controls">
                    <Button size="small" type="text" icon={<ZoomOut />} aria-label="缩小工作流" onClick={() => zoom(-1)} />
                    <span>{Math.round(scale * 100)}%</span>
                    <Button size="small" type="text" icon={<ZoomIn />} aria-label="放大工作流" onClick={() => zoom(1)} />
                    <Button size="small" type="text" icon={<Maximize />} aria-label="适应窗口" onClick={fitGraph} />
                </div>
                <div
                    ref={viewportRef}
                    className="workflow-graph-viewport"
                    onPointerDown={startPan}
                    onPointerMove={movePan}
                    onPointerUp={(event) => {
                        panRef.current = null;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onPointerCancel={() => {
                        panRef.current = null;
                    }}
                >
                    {graph.nodes.length ? (
                        <svg className="workflow-graph-svg" width={graph.width * scale} height={graph.height * scale} viewBox={`0 0 ${graph.width} ${graph.height}`}>
                            <g>
                                {graph.edges.map((edge) => {
                                    const from = graph.nodes.find((node) => node.id === edge.from)!;
                                    const to = graph.nodes.find((node) => node.id === edge.to)!;
                                    const x1 = from.x + nodeWidth;
                                    const y1 = from.y + nodeHeight / 2;
                                    const x2 = to.x;
                                    const y2 = to.y + nodeHeight / 2;
                                    const curve = Math.max(36, (x2 - x1) / 2);
                                    return <path key={`${edge.from}:${edge.to}`} className="workflow-graph-edge" d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`} />;
                                })}
                                {graph.nodes.map((node) => {
                                    const fieldCount = fields.filter((field) => String(field.nodeId) === node.id && field.enabled !== false).length;
                                    return (
                                        <g
                                            key={node.id}
                                            data-workflow-node
                                            className={`workflow-graph-node is-${node.category}${fieldCount ? " has-fields" : ""}${selectedNodeId === node.id ? " is-selected" : ""}`}
                                            transform={`translate(${node.x},${node.y})`}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedNodeId(node.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    setSelectedNodeId(node.id);
                                                }
                                            }}
                                        >
                                            <rect width={nodeWidth} height={nodeHeight} rx="10" />
                                            <text className="workflow-graph-node-title" x="11" y="22">
                                                {truncate(node.title, 18)}
                                            </text>
                                            <text className="workflow-graph-node-type" x="11" y="40">
                                                {truncate(node.classType, 21)}
                                            </text>
                                            <text className="workflow-graph-node-id" x={nodeWidth - 9} y="20" textAnchor="end">
                                                #{node.id}
                                            </text>
                                            {fieldCount ? (
                                                <text className="workflow-graph-node-count" x={nodeWidth - 9} y="43" textAnchor="end">
                                                    {fieldCount}
                                                </text>
                                            ) : null}
                                            <title>
                                                {node.title} · {node.classType} · #{node.id}
                                            </title>
                                        </g>
                                    );
                                })}
                            </g>
                        </svg>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
                    )}
                </div>
            </section>
        </div>
    );
}

function buildWorkflowGraph(rawWorkflow?: Record<string, unknown>, preview?: WorkflowGraphPreview): WorkflowGraph {
    const workflow = unwrapWorkflow(rawWorkflow);
    const apiNodes: WorkflowNode[] = Object.entries(workflow).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const raw = value as Record<string, unknown>;
        const meta = raw._meta && typeof raw._meta === "object" && !Array.isArray(raw._meta) ? (raw._meta as Record<string, unknown>) : {};
        const classType = String(raw.class_type || raw.classType || "Unknown");
        return [{ id, title: String(meta.title || raw.title || classType), classType, category: nodeCategory(classType), inputs: raw.inputs && typeof raw.inputs === "object" && !Array.isArray(raw.inputs) ? (raw.inputs as Record<string, unknown>) : {} }];
    });
    const canvas = canvasWorkflowGraph(workflow);
    const nodes = apiNodes.length
        ? apiNodes
        : (preview?.nodes || canvas?.nodes || []).map((node) => {
              const classType = String(node.classType || "Unknown");
              return { id: String(node.id), title: String(node.title || classType), classType, category: nodeCategory(classType), inputs: {} };
          });
    const edges = apiNodes.length ? workflowEdges(nodes) : preview?.edges || canvas?.edges || [];
    const positions = layoutWorkflowNodes(nodes, edges);
    const graphNodes = nodes.map((node) => ({ ...node, ...(positions.get(node.id) || { x: graphPadding, y: graphPadding }) }));
    const width = Math.max(640, ...graphNodes.map((node) => node.x + nodeWidth + graphPadding));
    const height = Math.max(420, ...graphNodes.map((node) => node.y + nodeHeight + graphPadding));
    return { nodes: graphNodes, edges, width, height };
}

function workflowEdges(nodes: WorkflowNode[]): GraphEdge[] {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();
    nodes.forEach((node) =>
        Object.values(node.inputs).forEach((input) => {
            if (!Array.isArray(input) || input.length !== 2) return;
            const from = String(input[0]);
            const key = `${from}:${node.id}`;
            if (!nodeIds.has(from) || edgeKeys.has(key)) return;
            edgeKeys.add(key);
            edges.push({ from, to: node.id });
        }),
    );
    return edges;
}

function canvasWorkflowGraph(workflow: Record<string, unknown>): WorkflowGraphPreview | undefined {
    if (!Array.isArray(workflow.nodes)) return undefined;
    const nodes = workflow.nodes.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const raw = value as Record<string, unknown>;
        const id = String(raw.id ?? "").trim();
        if (!id) return [];
        const properties = raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties) ? (raw.properties as Record<string, unknown>) : {};
        const classType = String(raw.type || raw.class_type || "Unknown");
        return [{ id, title: String(raw.title || properties["Node name for S&R"] || classType), classType }];
    });
    if (!nodes.length) return undefined;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges: Array<{ from: string; to: string }> = [];
    const edgeKeys = new Set<string>();
    if (Array.isArray(workflow.links)) {
        workflow.links.forEach((value) => {
            if (!Array.isArray(value) || value.length < 4) return;
            const from = String(value[1]);
            const to = String(value[3]);
            const key = `${from}:${to}`;
            if (!nodeIds.has(from) || !nodeIds.has(to) || from === to || edgeKeys.has(key)) return;
            edgeKeys.add(key);
            edges.push({ from, to });
        });
    }
    return { nodes, edges };
}

function layoutWorkflowNodes(nodes: WorkflowNode[], edges: GraphEdge[]) {
    const inbound = new Map(nodes.map((node) => [node.id, 0]));
    const outbound = new Map(nodes.map((node) => [node.id, [] as string[]]));
    edges.forEach((edge) => {
        inbound.set(edge.to, (inbound.get(edge.to) || 0) + 1);
        outbound.get(edge.from)?.push(edge.to);
    });
    const queue = nodes.filter((node) => !inbound.get(node.id)).map((node) => node.id);
    const layer = new Map(queue.map((id) => [id, 0]));
    while (queue.length) {
        const id = queue.shift()!;
        outbound.get(id)?.forEach((target) => {
            layer.set(target, Math.max(layer.get(target) || 0, (layer.get(id) || 0) + 1));
            inbound.set(target, (inbound.get(target) || 1) - 1);
            if (!inbound.get(target)) queue.push(target);
        });
    }
    nodes.forEach((node) => {
        if (!layer.has(node.id)) layer.set(node.id, 0);
    });
    const columns = new Map<number, WorkflowNode[]>();
    nodes.forEach((node) => {
        const value = layer.get(node.id) || 0;
        columns.set(value, [...(columns.get(value) || []), node]);
    });
    const positions = new Map<string, { x: number; y: number }>();
    [...columns.keys()]
        .sort((left, right) => left - right)
        .forEach((column) => {
            const items = columns.get(column)!.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
            items.forEach((node, row) => positions.set(node.id, { x: graphPadding + column * (nodeWidth + columnGap), y: graphPadding + row * (nodeHeight + rowGap) }));
        });
    return positions;
}

function unwrapWorkflow(value?: Record<string, unknown>) {
    let current = value || {};
    for (let index = 0; index < 3; index += 1) {
        const nested = current.prompt ?? current.workflow;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            current = nested as Record<string, unknown>;
            continue;
        }
        if (typeof nested === "string" && nested.trim()) {
            try {
                const parsed = JSON.parse(nested);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    current = parsed;
                    continue;
                }
            } catch {
                return current;
            }
        }
        break;
    }
    return current;
}

function fieldKey(field: WorkflowFieldMapping) {
    return field.id || `${field.nodeId}::${field.fieldName}`;
}
function mediaFieldCount(fields: WorkflowFieldMapping[]) {
    return fields.filter((field) => ["referenceImage", "referenceVideo", "referenceAudio", "mask"].includes(String(field.source || ""))).length;
}
function truncate(value: string, length: number) {
    return Array.from(value).length > length ? `${Array.from(value).slice(0, length).join("")}…` : value;
}
function nodeCategory(classType: string) {
    const value = classType.toLowerCase();
    if (value.includes("load") || value.includes("loader")) return "loader";
    if (value.includes("save") || value.includes("preview") || value.includes("output")) return "output";
    if (value.includes("sampler") || value.includes("scheduler") || value.includes("guide")) return "sampler";
    if (value.includes("image") || value.includes("vae")) return "image";
    if (value.includes("video")) return "video";
    return "default";
}
