import { ChartColumn } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

type ChartNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

type ChartRow = Record<string, string | number>;
type ParsedChart = { rows: ChartRow[]; xKey: string; series: string[] };

/**
 * 把一段文本解析成图表数据；解析不出来返回 null，由调用方显示错误态。
 *
 * 这个函数**必须不抛**：数据来自模型输出，非法 JSON 是常态而不是异常，
 * 抛出来会连带整个画布白屏。
 */
export function parseChartSource(text: string): ParsedChart | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const rows = parseJsonRows(trimmed) ?? parseCsvRows(trimmed);
    if (!rows?.length) return null;

    const keys = Object.keys(rows[0]);
    if (!keys.length) return null;
    // 数值列作为系列，其余第一列作为横轴；全是数值时用行号当横轴。
    const series = keys.filter((key) => rows.every((row) => typeof row[key] === "number"));
    const xKey = keys.find((key) => !series.includes(key)) || "__index";
    if (!series.length) return null;
    if (xKey === "__index") rows.forEach((row, index) => { row.__index = index + 1; });
    return { rows, xKey, series };
}

function parseJsonRows(text: string): ChartRow[] | null {
    try {
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) return null;
        const rows = parsed.filter((item): item is ChartRow => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        return rows.length ? rows.map(normalizeRow) : null;
    } catch {
        return null;
    }
}

function parseCsvRows(text: string): ChartRow[] | null {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const header = lines[0].split(",").map((cell) => cell.trim());
    if (header.length < 2) return null;
    return lines.slice(1).map((line) => {
        const cells = line.split(",").map((cell) => cell.trim());
        return normalizeRow(Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])));
    });
}

/** 把看起来是数字的值转成数字，否则 recharts 会把 "12" 当类别处理。 */
function normalizeRow(row: Record<string, unknown>): ChartRow {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
        if (typeof value === "number") return [key, value];
        const text = String(value ?? "").trim();
        const numeric = text !== "" && Number.isFinite(Number(text));
        return [key, numeric ? Number(text) : text];
    }));
}

const SERIES_COLORS = ["#f59e0b", "#22c55e", "#06b6d4", "#a855f7", "#ef4444"];

/**
 * 图表节点：把上游文本（JSON 数组或 CSV）渲染成柱状图/折线图。
 * metadata.chartKind 为 "line" 时画折线，缺省柱状。
 */
export function ChartNodeContent({ node, theme }: ChartNodeContentProps) {
    const upstream = useUpstreamNodes(node.id);
    const inherited = upstream.find((item) => getNodeResourceKind(item) === "text");
    const source = node.metadata?.content || inherited?.metadata?.content || inherited?.metadata?.prompt || "";
    const parsed = parseChartSource(source);
    const asLine = node.metadata?.chartKind === "line";

    if (!parsed) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <ChartColumn className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>{source.trim() ? "无法解析为图表数据（需要 JSON 数组或 CSV）" : "连接输出 JSON 数组或 CSV 的文本节点"}</span>
            </div>
        );
    }

    return (
        <div
            className="h-full w-full px-2 py-2"
            data-canvas-no-zoom
            style={{ color: theme.node.text }}
            onWheel={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <ResponsiveContainer width="100%" height="100%">
                {asLine ? (
                    <LineChart data={parsed.rows}>
                        <CartesianGrid stroke={theme.node.stroke} strokeDasharray="3 3" />
                        <XAxis dataKey={parsed.xKey} tick={{ fill: theme.node.muted, fontSize: 11 }} />
                        <YAxis tick={{ fill: theme.node.muted, fontSize: 11 }} />
                        <Tooltip />
                        {parsed.series.length > 1 ? <Legend /> : null}
                        {parsed.series.map((key, index) => <Line key={key} type="monotone" dataKey={key} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} dot={false} />)}
                    </LineChart>
                ) : (
                    <BarChart data={parsed.rows}>
                        <CartesianGrid stroke={theme.node.stroke} strokeDasharray="3 3" />
                        <XAxis dataKey={parsed.xKey} tick={{ fill: theme.node.muted, fontSize: 11 }} />
                        <YAxis tick={{ fill: theme.node.muted, fontSize: 11 }} />
                        <Tooltip />
                        {parsed.series.length > 1 ? <Legend /> : null}
                        {parsed.series.map((key, index) => <Bar key={key} dataKey={key} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />)}
                    </BarChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}
