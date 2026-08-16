import type { ComponentProps } from "react";
import { parseCsv, parseMarkdownPipeTable } from "./utils";

type Props = {
    content: string;
    status: "streaming" | "idle";
};

export function ArtifactSheetBlock({ content, status }: Props) {
    const rows = parseSheetContent(content);
    if (!rows.length) return <div className="artifact-sheet-empty">{status === "streaming" ? "正在生成…" : "暂无数据"}</div>;
    const [header, ...dataRows] = rows;
    const tableProps: ComponentProps<"table"> = { className: "artifact-sheet-table" };
    const dataRowLen = dataRows.length;
    const colLen = header.length;
    return (
        <div className="artifact-sheet-scroll">
            <div className="artifact-sheet-info">
                <span>{dataRowLen} 行 × {colLen} 列</span>
                {status === "streaming" ? (
                    <span className="artifact-streaming-tag">
                        <span className="artifact-status-dot is-streaming" aria-hidden />
                        流式更新中…
                    </span>
                ) : null}
            </div>
            <div className="artifact-sheet-table-wrap">
                <table {...tableProps}>
                    <thead>
                        <tr>
                            {header.map((cell, i) => <th key={`h-${i}`}>{cell}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {dataRows.map((row, r) => (
                            <tr key={`r-${r}`}>
                                {header.map((_, c) => <td key={`c-${c}`}>{row[c] ?? ""}</td>)}
                            </tr>
                        ))}
                        {status === "streaming" && dataRows.length > 0 ? (
                            <tr className="artifact-sheet-stream-row" aria-hidden>
                                {header.map((_, c) => (
                                    <td key={`stream-${c}`}>
                                        <span className="artifact-sheet-stream-cell" />
                                    </td>
                                ))}
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function parseSheetContent(raw: string): string[][] {
    const cleaned = raw.trim();
    if (!cleaned) return [];
    if (/^\s*\|/.test(cleaned)) return parseMarkdownPipeTable(cleaned);
    return parseCsv(cleaned);
}
