import { useCallback, useEffect, useMemo, useRef } from "react";
import { App, Tooltip } from "antd";
import { BookText, ChevronLeft, ChevronRight, ClipboardList, Code2, ImageIcon, LineChart, Logs, MessageSquareText, PencilSparkles, Sheet, Sparkles, Undo2 } from "lucide-react";
import type { ArtifactBlock, ArtifactFooterAction, ArtifactKind, ArtifactToolbarAction } from "./types";
import { ArtifactCodeBlock } from "./code-block";
import { ArtifactSheetBlock } from "./sheet-block";
import { ArtifactImageBlock } from "./image-block";
import { ArtifactTextBlock } from "./text-block";
import { describeLanguage, markdownTableToCsv, sanitizeResourceUrl, tryExtractMarkdownTable } from "./utils";

const kindMeta: Record<ArtifactKind, { label: string; description: string; Icon: typeof Sparkles }> = {
    text: { label: "文本", description: "起草文案、剧本、分镜说明", Icon: BookText },
    code: { label: "代码", description: "代码片段与脚本", Icon: Code2 },
    image: { label: "图像", description: "图片生成与处理说明", Icon: ImageIcon },
    sheet: { label: "表格", description: "角色表、分镜表、数据清单", Icon: Sheet },
};

type BlockHeaderProps = {
    kind: ArtifactKind;
    title: string;
    status: "streaming" | "idle";
};

function BlockHeader({ kind, title, status }: BlockHeaderProps) {
    const meta = kindMeta[kind];
    const Icon = meta.Icon;
    return (
        <div className="artifact-block-header">
            <div className="artifact-block-title">
                <div className="artifact-block-title-main">
                    <Icon className="artifact-block-icon" />
                    <span className="artifact-block-label">{meta.label}</span>
                    <span className="artifact-block-divider" aria-hidden>·</span>
                    <strong className="artifact-block-name">{title}</strong>
                </div>
                <div className="artifact-block-status">
                    {status === "streaming" ? (
                        <>
                            <span className="artifact-status-dot is-streaming" aria-hidden />
                            <span className="artifact-block-streaming">生成中</span>
                        </>
                    ) : (
                        <>
                            <span className="artifact-status-dot is-idle" aria-hidden />
                            <span className="artifact-block-version" title="版本 v1">v1</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

type ArtifactToolbarProps = {
    actions: ArtifactToolbarAction[];
};

function ArtifactToolbar({ actions }: ArtifactToolbarProps) {
    if (!actions.length) return null;
    return (
        <div className="artifact-block-toolbar">
            {actions.map((action, i) => (
                <Tooltip key={i} title={action.description} placement="top">
                    <button
                        type="button"
                        className="artifact-toolbar-btn"
                        onClick={action.onClick}
                        aria-label={action.description}
                    >
                        {action.icon}
                    </button>
                </Tooltip>
            ))}
        </div>
    );
}

type ArtifactFooterProps = {
    actions: ArtifactFooterAction[];
};

function ArtifactFooter({ actions }: ArtifactFooterProps) {
    if (!actions.length) return null;
    return (
        <div className="artifact-block-footer">
            {actions.map((action, i) => (
                <Tooltip key={i} title={action.description} placement="bottom">
                    <button
                        type="button"
                        className="artifact-footer-btn"
                        onClick={action.onClick}
                        disabled={action.isDisabled}
                        aria-label={action.description}
                    >
                        {action.icon}
                        {action.label ? <span>{action.label}</span> : null}
                    </button>
                </Tooltip>
            ))}
        </div>
    );
}

function useAutoScrollOnStream<T extends HTMLElement>(status: "streaming" | "idle", content: string) {
    const ref = useRef<T | null>(null);
    const userScrolled = useRef(false);

    useEffect(() => {
        if (status !== "streaming") {
            userScrolled.current = false;
            return;
        }
        if (userScrolled.current) return;
        const el = ref.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [status, content]);

    const onScroll = () => {
        const el = ref.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        userScrolled.current = !atBottom;
    };

    return { ref, onScroll };
}

type ArtifactBlockCardProps = {
    block: ArtifactBlock;
    index: number;
};

function ArtifactBlockCard({ block, index }: ArtifactBlockCardProps) {
    // antd App.useApp 必须在 <App /> 树内使用，不可安全地 optional chain；
    // 退化到全局 message API 避免在 Provider 外调用时报错。
    const app = App.useApp?.();
    const message = app?.message ?? fallbackMessage;
    const contentRef = useAutoScrollOnStream<HTMLDivElement>(block.status, block.content);

    const handleCopy = useSafeCopy(message);
    const toolbarActions = useMemo<ArtifactToolbarAction[]>(() => buildToolbarActions(block, message), [block, message]);
    const footerActions = useMemo<ArtifactFooterAction[]>(() => buildFooterActions(block, message, index, handleCopy), [block, message, index, handleCopy]);

    return (
        <div className={`artifact-block-card is-${block.kind}`}>
            <BlockHeader kind={block.kind} title={block.title} status={block.status} />
            {toolbarActions.length ? <ArtifactToolbar actions={toolbarActions} /> : null}
            <div className="artifact-block-body" ref={contentRef.ref} onScroll={contentRef.onScroll}>
                {block.kind === "text" ? <ArtifactTextBlock content={block.content} status={block.status} /> : null}
                {block.kind === "code" ? <ArtifactCodeBlock content={block.content} language={block.metadata?.language || ""} status={block.status} /> : null}
                {block.kind === "sheet" ? <ArtifactSheetBlock content={block.content} status={block.status} /> : null}
                {block.kind === "image" ? <ArtifactImageBlock content={block.content} status={block.status} /> : null}
            </div>
            {footerActions.length ? <ArtifactFooter actions={footerActions} /> : null}
        </div>
    );
}

type MessageArtifactsProps = {
    content: string;
    isStreaming?: boolean;
};

export function MessageArtifacts({ content, isStreaming = false }: MessageArtifactsProps) {
    const blocks = useMemo<ArtifactBlock[]>(() => extractArtifactBlocks(content, isStreaming ? "streaming" : "idle"), [content, isStreaming]);
    if (!blocks.length) return null;
    return (
        <div className="artifact-blocks">
            {blocks.map((block, i) => <ArtifactBlockCard key={`${block.kind}-${i}`} block={block} index={i} />)}
        </div>
    );
}

type LiteMessageApi = {
    info: (s: string) => void;
    success: (s: string) => void;
    warning: (s: string) => void;
    error: (s: string) => void;
};

const noop = () => {};

// antd App.useApp 的安全降级：当组件不在 <App /> Provider 内时不崩溃。
const fallbackMessage: LiteMessageApi = {
    info: noop, success: noop, warning: noop, error: noop,
};

function useSafeCopy(message: LiteMessageApi) {
    return useCallback(async (text: string, successLabel: string) => {
        if (!text) {
            message.warning("内容为空，无法复制");
            return;
        }
        try {
            // 优先 Clipboard API，失败时退化到 textarea 兜底
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            message.success(successLabel);
        } catch (err) {
            message.error(`复制失败：${err instanceof Error ? err.message : "未知错误"}`);
        }
    }, [message]);
}

function buildToolbarActions(block: ArtifactBlock, message: LiteMessageApi): ArtifactToolbarAction[] {
    const actions: ArtifactToolbarAction[] = [];
    if (block.status === "streaming") return actions;
    switch (block.kind) {
        case "text":
            actions.push(
                { description: "润色文案，优化表达", icon: <PencilSparkles size={14} />, onClick: () => message.info("提示：在对话中输入「帮我润色上面的文案」即可获得优化版本") },
                { description: "请求结构与表达建议", icon: <MessageSquareText size={14} />, onClick: () => message.info("提示：在对话中输入「给我一些改进建议」即可获得 AI 建议") },
            );
            break;
        case "code":
            actions.push(
                { description: "为代码添加注释", icon: <ClipboardList size={14} />, onClick: () => message.info("提示：在对话中输入「给这段代码添加注释」即可") },
                { description: "补充调试日志", icon: <Logs size={14} />, onClick: () => message.info("提示：在对话中输入「添加日志辅助调试」即可") },
            );
            break;
        case "sheet":
            actions.push(
                { description: "格式化与清洗数据", icon: <Sparkles size={14} />, onClick: () => message.info("提示：在对话中输入「帮我清洗并格式化这张表」即可") },
                { description: "分析并可视化数据", icon: <LineChart size={14} />, onClick: () => message.info("提示：在对话中输入「帮我分析这张表并生成可视化图表」即可") },
            );
            break;
        default:
            break;
    }
    return actions;
}

function buildFooterActions(block: ArtifactBlock, message: LiteMessageApi, index: number, copy: ReturnType<typeof useSafeCopy>): ArtifactFooterAction[] {
    const actions: ArtifactFooterAction[] = [];
    if (block.status === "streaming") return actions;

    actions.push({
        icon: <Undo2 size={14} />,
        label: "上一版",
        description: "查看上一版本（本地仅 v1）",
        onClick: () => message.info("当前为初始版本 v1，后续编辑会自动保存新版本"),
        isDisabled: true,
    });
    actions.push({
        icon: <ChevronLeft size={14} />,
        description: "回到上一版本",
        onClick: () => message.info("当前为初始版本 v1"),
        isDisabled: true,
    });
    actions.push({
        icon: <ChevronRight size={14} />,
        description: "查看下一版本",
        onClick: () => message.info("已是最新版本 v1"),
        isDisabled: true,
    });

    switch (block.kind) {
        case "text":
            actions.push({
                icon: <Sparkles size={14} />,
                label: "复制",
                description: "复制文本内容",
                onClick: () => {
                    const plain = block.content.replace(/^\s*#{1,6}\s+/gm, "").trim();
                    void copy(plain, "文本已复制到剪贴板");
                },
            });
            break;
        case "code":
            actions.push({
                icon: <Sparkles size={14} />,
                label: "复制代码",
                description: "复制代码到剪贴板",
                onClick: () => void copy(block.content, "代码已复制到剪贴板"),
            });
            break;
        case "sheet":
            actions.push({
                icon: <Sparkles size={14} />,
                label: "复制 CSV",
                description: "复制表格为 CSV 格式",
                onClick: () => {
                    const csv = markdownTableToCsv(block.content);
                    void copy(csv, "CSV 已复制到剪贴板");
                },
            });
            break;
        case "image":
            if (block.content) {
                actions.push({
                    icon: <Sparkles size={14} />,
                    label: "打开图片",
                    description: "在新标签页打开图片",
                    onClick: () => {
                        const safe = sanitizeResourceUrl(block.content);
                        if (safe) window.open(safe, "_blank", "noopener,noreferrer");
                    },
                });
            }
            break;
    }
    void index;
    return actions;
}

export function extractArtifactBlocks(content: string, status: "streaming" | "idle"): ArtifactBlock[] {
    const blocks: ArtifactBlock[] = [];
    const lines = content.split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fenceMatch = line.match(/^```([\w+-]*)\s*(.*)$/);

        if (fenceMatch) {
            const language = fenceMatch[1] || "";
            const title = fenceMatch[2]?.trim() || describeLanguage(language);
            const codeLines: string[] = [];
            let j = i + 1;
            while (j < lines.length && !/^```\s*$/.test(lines[j])) {
                codeLines.push(lines[j]);
                j += 1;
            }
            blocks.push({
                kind: "code",
                title,
                content: codeLines.join("\n"),
                status,
                metadata: { language },
            });
            i = j + 1;
            continue;
        }

        if (/^---\s*CSV\s*---\s*$/i.test(line) || /^---\s*SHEET\s*---\s*$/i.test(line)) {
            const csvLines: string[] = [];
            let j = i + 1;
            while (j < lines.length && !/^---\s*(CSV|SHEET)\s*---\s*$/i.test(lines[j])) {
                csvLines.push(lines[j]);
                j += 1;
            }
            const rows = csvLines.filter((r) => r.trim().length).length;
            blocks.push({
                kind: "sheet",
                title: "数据表",
                content: csvLines.join("\n"),
                status,
                metadata: { rows },
            });
            i = j + 1;
            continue;
        }

        const mdTable = tryExtractMarkdownTable(lines, i);
        if (mdTable) {
            blocks.push({
                kind: "sheet",
                title: mdTable.title || "表格",
                content: mdTable.text,
                status,
                metadata: { rows: mdTable.rows, cols: mdTable.cols },
            });
            i = mdTable.nextLine;
            continue;
        }

        const imageLineMatch = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
        if (imageLineMatch) {
            blocks.push({
                kind: "image",
                title: imageLineMatch[1] || "图像",
                content: imageLineMatch[2],
                status,
                metadata: { mime: "image/*" },
            });
            i += 1;
            continue;
        }

        const headingMatch = line.match(/^(#{2,4})\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            const title = headingMatch[2].trim();
            const textLines: string[] = [];
            let j = i + 1;
            while (
                j < lines.length &&
                !/^#{2,4}\s+/.test(lines[j]) &&
                !/^```/.test(lines[j]) &&
                !/^---\s*(CSV|SHEET)\s*---\s*$/i.test(lines[j]) &&
                !/^\s*!\[/.test(lines[j]) &&
                !/^\s*\|[^|]*\|\s*$/.test(lines[j])
            ) {
                textLines.push(lines[j]);
                j += 1;
            }
            const hasMeaningfulText = textLines.some((ln) => ln.trim().length > 0);
            if (hasMeaningfulText) {
                blocks.push({
                    kind: "text",
                    title,
                    content: textLines.join("\n").trim(),
                    status,
                });
            }
            i = j;
            continue;
        }

        i += 1;
    }

    return blocks;
}
