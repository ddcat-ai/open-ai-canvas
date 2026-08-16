import { useMemo, useState } from "react";
import { ChevronDown, Sparkles, Wrench } from "lucide-react";

// ========== 类型 ==========

export type ToolCallStatus = "running" | "completed" | "error" | "denied";

export type ToolCallInput = {
    operation: string;                 // 如 text_to_image / image_to_video / text_to_audio
    mode: "text" | "image" | "video" | "audio";
    prompt: string;                    // 截断显示，避免撑高
    settings?: Record<string, string | number | undefined>; // 如 ratio / model / style
};

// ========== 状态元数据 ==========

const statusMeta: Record<ToolCallStatus, { label: string; className: string }> = {
    running: { label: "执行中", className: "is-running" },
    completed: { label: "已完成", className: "is-completed" },
    error: { label: "执行失败", className: "is-error" },
    denied: { label: "已停止", className: "is-denied" },
};

const operationLabels: Record<string, string> = {
    text_to_image: "文生图",
    image_to_image: "图生图",
    image_to_video: "图生视频",
    text_to_video: "文生视频",
    text_to_audio: "文生语音",
    text: "文本生成",
};

function describeOperation(op: string, mode: string): string {
    if (operationLabels[op]) return operationLabels[op];
    const modeLabel = mode === "image" ? "图像" : mode === "video" ? "视频" : mode === "audio" ? "音频" : "文本";
    return `${modeLabel}生成`;
}

// ========== 组件：StatusBadge ==========

function ToolStatusBadge({ status }: { status: ToolCallStatus }) {
    const meta = statusMeta[status];
    return (
        <span className={`tool-status-badge ${meta.className}`}>
            <span className="tool-status-dot" aria-hidden />
            <span>{meta.label}</span>
        </span>
    );
}

// ========== 组件：Header ==========

export function GenerationToolHeader({
    toolName,
    status,
    isOpen,
    onToggle,
}: {
    toolName: string;
    status: ToolCallStatus;
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            className="tool-card-header"
            onClick={onToggle}
            aria-expanded={isOpen}
        >
            <div className="tool-card-title-wrap">
                <Wrench className="tool-card-wrench" size={14} />
                <span className="tool-card-name">{toolName}</span>
                <ToolStatusBadge status={status} />
            </div>
            <ChevronDown size={14} className={`tool-card-chevron${isOpen ? " is-open" : ""}`} />
        </button>
    );
}

// ========== 组件：Input（调用参数） ==========

export function GenerationToolInput({ input }: { input: ToolCallInput }) {
    const promptPreview = useMemo(() => {
        const raw = input.prompt || "";
        return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
    }, [input.prompt]);

    const settings = input.settings;
    const entries = useMemo(() => {
        if (!settings) return [] as Array<[string, string]>;
        return Object.entries(settings)
            .filter(([, v]) => v !== undefined && v !== "" && v !== null)
            .filter(([k]) => !["prompt", "userPrompt"].includes(k))
            .map(([k, v]) => [k, String(v)] as [string, string]);
    }, [settings]);

    return (
        <div className="tool-card-input">
            <div className="tool-card-section-label">调用参数</div>
            <div className="tool-card-operation">
                <Sparkles size={12} />
                <span>{describeOperation(input.operation, input.mode)}</span>
            </div>
            {entries.length ? (
                <div className="tool-card-settings">
                    {entries.map(([k, v]) => (
                        <div key={k} className="tool-card-setting">
                            <span className="tool-card-setting-key">{k}</span>
                            <span className="tool-card-setting-val">{v}</span>
                        </div>
                    ))}
                </div>
            ) : null}
            {promptPreview ? (
                <div className="tool-card-prompt" title={input.prompt}>
                    {promptPreview}
                </div>
            ) : null}
        </div>
    );
}

// ========== 容器（Header + 可展开 Body + Output 渲染） ==========

export type GenerationToolCardProps = {
    status: ToolCallStatus;
    mode: "text" | "image" | "video" | "audio";
    operation: string;
    prompt?: string;
    settings?: Record<string, string | number | undefined>;
    // 是否有效果键集合（多图批量）
    isBulk?: boolean;
    children?: React.ReactNode;
    // 覆盖默认展开态（不传时按 status 决定）
    defaultOpen?: boolean;
};

export function GenerationToolCard({
    status,
    mode,
    operation,
    prompt = "",
    settings,
    isBulk = false,
    children,
    defaultOpen,
}: GenerationToolCardProps) {
    const toolName = describeOperation(operation, mode);

    // 默认展开态：
    //   - 运行中/错误/停止：必须展开（用户看进度 / 错误信息）
    //   - 已完成 + 非批量：默认展开 —— 输出区底部的「生成同款 / 添加到画布 / 下载」操作按钮不能被折叠壳藏住
    //   - 已完成 + 批量（多图 4 张以上等）：默认收起，压缩列表高度；用户手动点 header 展开看全部结果
    //   - defaultOpen 显式传入时优先覆盖
    const initialOpen = typeof defaultOpen === "boolean"
        ? defaultOpen
        : status === "running" || status === "error" || status === "denied" ? true
        : status === "completed" && !isBulk ? true
        : false;

    const [isOpen, setIsOpen] = useState(initialOpen);

    const inputData: ToolCallInput = { operation, mode, prompt, settings };

    return (
        <div className={`generation-tool-card tool-status-${statusMeta[status].className}`}>
            <GenerationToolHeader
                toolName={toolName}
                status={status}
                isOpen={isOpen}
                onToggle={() => setIsOpen(!isOpen)}
            />
            {isOpen ? (
                <div className="tool-card-body">
                    <GenerationToolInput input={inputData} />
                    <div className="tool-card-output">
                        <div className="tool-card-section-label">执行结果</div>
                        {children}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
