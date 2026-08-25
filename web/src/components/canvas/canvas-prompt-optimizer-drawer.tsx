import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Alert, App, Button, Dropdown, Input, Popover, Tag, Typography } from "antd";
import { Bubble, Sender, type BubbleItemType } from "@ant-design/x";
import { ArrowUp, Check, ChevronDown, FileText, Image as ImageIcon, LoaderCircle, Music2, Sparkles, UserRound, Video, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { PromptOptimizationMode, PromptOptimizationResult, PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasPromptOptimizerDrawerProps = {
    open: boolean;
    children: ReactNode;
    prompt: string;
    generationMode: "image" | "video";
    targetModel: string;
    targetProtocol?: string;
    config: AiConfig;
    optimizerModel: string;
    references: CanvasResourceReference[];
    provider: PromptOptimizerProvider | null;
    onClose: () => void;
    onApply: (prompt: string) => void;
};

const modeOptions: Array<{ label: string; value: PromptOptimizationMode }> = [
    { label: "扩展想法", value: "expand" },
    { label: "精修已有", value: "refine" },
    { label: "强化风格", value: "style" },
    { label: "适配模型", value: "model-adapt" },
    { label: "结合参考", value: "reference" },
];

const modeDescriptions: Record<PromptOptimizationMode, string> = {
    expand: "从一句模糊想法补齐主体、场景、构图、光线和镜头等可执行细节。",
    refine: "尽量保留原意，只修正表达并补充必要细节，适合已经有初稿的提示词。",
    style: "保留主体和动作，重点强化电影感、材质、色彩、光影或指定艺术风格。",
    "model-adapt": "根据当前生成模型的习惯调整提示词结构和描述重点，减少模型不易理解的表达。",
    reference: "结合已连接的参考图或文本，补充一致性、外观、构图和关联关系。",
};

type PanelSize = { width: number; height: number };
type PanelOffset = { x: number; y: number };
type PanelPosition = { left: number; top: number };
type ResizeEdges = { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };

const PANEL_MARGIN = 12;
const PANEL_MIN_WIDTH = 300;
const PANEL_MIN_HEIGHT = 360;
const PANEL_MAX_WIDTH = 760;
const PANEL_MAX_HEIGHT = 780;

function clampPanelValue(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

function getPanelResizeBounds() {
    const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
    const maxWidth = Math.min(PANEL_MAX_WIDTH, Math.max(0, viewportWidth - PANEL_MARGIN * 2));
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(0, viewportHeight - PANEL_MARGIN * 2));
    return {
        minWidth: Math.min(PANEL_MIN_WIDTH, maxWidth),
        maxWidth,
        minHeight: Math.min(PANEL_MIN_HEIGHT, maxHeight),
        maxHeight,
    };
}

function getInitialPanelSize(): PanelSize {
    const bounds = getPanelResizeBounds();
    return {
        width: clampPanelValue(420, bounds.minWidth, bounds.maxWidth),
        height: clampPanelValue(620, bounds.minHeight, bounds.maxHeight),
    };
}

function getInitialPanelPosition(panelSize: PanelSize): PanelPosition {
    if (typeof window === "undefined") return { left: PANEL_MARGIN, top: PANEL_MARGIN };

    const anchor = [...document.querySelectorAll<HTMLElement>(".canvas-node-composer, .creation-chat-composer")]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .find(({ element, rect }) => rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden");

    if (!anchor) return { left: PANEL_MARGIN, top: PANEL_MARGIN };

    const { rect } = anchor;
    const left = clampPanelValue(rect.left + (rect.width - panelSize.width) / 2, PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - panelSize.width);
    const aboveTop = rect.top - panelSize.height - PANEL_MARGIN;
    const belowTop = rect.bottom + PANEL_MARGIN;
    const hasRoomBelow = belowTop + panelSize.height <= window.innerHeight - PANEL_MARGIN;
    const top = aboveTop >= PANEL_MARGIN ? aboveTop : hasRoomBelow ? belowTop : aboveTop;

    return {
        left,
        top: clampPanelValue(top, PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - panelSize.height),
    };
}

export function CanvasPromptOptimizerDrawer({ open, children, prompt, generationMode, targetModel, targetProtocol, config, optimizerModel, references, provider, onClose, onApply }: CanvasPromptOptimizerDrawerProps) {
    const { message } = App.useApp();
    const abortRef = useRef<AbortController | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [mode, setMode] = useState<PromptOptimizationMode>("expand");
    const [activeOptimizerModel, setActiveOptimizerModel] = useState("");
    const [draftPrompt, setDraftPrompt] = useState(prompt);
    const [submittedPrompt, setSubmittedPrompt] = useState("");
    const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
    const [result, setResult] = useState<PromptOptimizationResult | null>(null);
    const [selectedPrompt, setSelectedPrompt] = useState("");
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [panelSize, setPanelSize] = useState<PanelSize>(getInitialPanelSize);
    const [panelOffset, setPanelOffset] = useState<PanelOffset>({ x: 0, y: 0 });
    const [panelInteracting, setPanelInteracting] = useState(false);
    const panelOffsetRef = useRef(panelOffset);
    const panelPositionRef = useRef<PanelPosition | null>(null);
    const wasOpenRef = useRef(false);
    const interactionCleanupRef = useRef<(() => void) | null>(null);
    panelOffsetRef.current = panelOffset;

    const activeReferences = useMemo(() => references.filter((reference) => reference.active), [references]);
    const selectedReferences = useMemo(() => activeReferences.filter((reference) => selectedReferenceIds.includes(reference.id)), [activeReferences, selectedReferenceIds]);
    const optimizationReferences = mode === "reference" ? selectedReferences : activeReferences;
    const referenceCount = mode === "reference" ? selectedReferences.length : activeReferences.length;
    const textContext = useMemo(
        () => optimizationReferences.filter((reference) => (reference.kind === "text" || reference.kind === "character") && reference.text?.trim()).map((reference) => ({ title: reference.title || reference.label, text: reference.text!.trim() })),
        [optimizationReferences],
    );
    const imageContext = useMemo(
        () =>
            optimizationReferences
                .filter((reference) => (reference.kind === "image" || reference.kind === "character") && reference.previewUrl && /^(data:|https?:\/\/)/i.test(reference.previewUrl))
                .map((reference) => ({ title: reference.title || reference.label, url: reference.previewUrl! })),
        [optimizationReferences],
    );

    useEffect(() => {
        if (!open) return;
        abortRef.current?.abort();
        setDraftPrompt(prompt);
        setSubmittedPrompt(prompt.trim());
        setActiveOptimizerModel(optimizerModel);
        setSelectedReferenceIds(references.filter((reference) => reference.active).map((reference) => reference.id));
        setResult(null);
        setSelectedPrompt("");
        setError("");
        setWorking(false);
        setStreaming(false);
    }, [open, optimizerModel, prompt]);

    useLayoutEffect(() => {
        if (open && !wasOpenRef.current) {
            panelPositionRef.current = null;
            const initialPosition = getInitialPanelPosition(panelSize);
            panelPositionRef.current = initialPosition;
            const initialOffset = { x: initialPosition.left, y: initialPosition.top };
            panelOffsetRef.current = initialOffset;
            setPanelOffset(initialOffset);
        }
        wasOpenRef.current = open;
    }, [open, panelSize]);

    useEffect(
        () => () => {
            abortRef.current?.abort();
            interactionCleanupRef.current?.();
        },
        [],
    );

    useEffect(() => {
        if (open) return;
        interactionCleanupRef.current?.();
    }, [open]);

    const syncPanelPositionToViewport = useCallback(() => {
        const popoverRoot = contentRef.current?.closest<HTMLElement>(".canvas-prompt-optimizer-popover");
        if (!popoverRoot) return;

        const rect = popoverRoot.getBoundingClientRect();
        const currentOffset = panelOffsetRef.current;
        const baseLeft = rect.left - currentOffset.x;
        const baseTop = rect.top - currentOffset.y;
        const currentPosition = panelPositionRef.current ?? { left: rect.left, top: rect.top };
        const nextPosition = {
            left: clampPanelValue(currentPosition.left, PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - rect.width),
            top: clampPanelValue(currentPosition.top, PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - rect.height),
        };
        panelPositionRef.current = nextPosition;
        const nextOffset = {
            x: nextPosition.left - baseLeft,
            y: nextPosition.top - baseTop,
        };

        setPanelOffset((current) => {
            panelOffsetRef.current = nextOffset;
            return nextOffset.x === current.x && nextOffset.y === current.y ? current : nextOffset;
        });
    }, []);

    useEffect(() => {
        if (!open) return;
        const handleViewportResize = () => {
            const bounds = getPanelResizeBounds();
            setPanelSize((current) => ({
                width: clampPanelValue(current.width, bounds.minWidth, bounds.maxWidth),
                height: clampPanelValue(current.height, bounds.minHeight, bounds.maxHeight),
            }));
            requestAnimationFrame(syncPanelPositionToViewport);
        };
        window.addEventListener("resize", handleViewportResize);
        return () => window.removeEventListener("resize", handleViewportResize);
    }, [open, syncPanelPositionToViewport]);

    useEffect(() => {
        if (!open || panelInteracting) return;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(syncPanelPositionToViewport);
        });
        return () => cancelAnimationFrame(frame);
    }, [open, panelInteracting, panelSize.height, panelSize.width, syncPanelPositionToViewport]);

    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => {
            const scrollBox = chatRef.current?.querySelector<HTMLElement>(".ant-bubble-list-scroll-box");
            if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    }, [open, submittedPrompt, working, result, error]);

    const beginPanelInteraction = (event: ReactPointerEvent<HTMLElement>, kind: "drag" | "resize", edges: ResizeEdges = {}) => {
        if (event.button !== 0) return;
        const popoverRoot = event.currentTarget.closest<HTMLElement>(".canvas-prompt-optimizer-popover");
        if (!popoverRoot) return;

        event.preventDefault();
        event.stopPropagation();
        interactionCleanupRef.current?.();

        const startX = event.clientX;
        const startY = event.clientY;
        const startSize = panelSize;
        const startRect = popoverRoot.getBoundingClientRect();
        const startPosition = panelPositionRef.current ?? { left: startRect.left, top: startRect.top };
        panelPositionRef.current = startPosition;
        const basePosition = {
            left: startRect.left - panelOffsetRef.current.x,
            top: startRect.top - panelOffsetRef.current.y,
        };
        const interactionTarget = event.currentTarget;
        const pointerId = event.pointerId;
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        const horizontalResize = Boolean(edges.left || edges.right);
        const verticalResize = Boolean(edges.top || edges.bottom);
        const cursor = kind === "drag" ? "grabbing" : horizontalResize && verticalResize ? (edges.top === edges.left ? "nwse-resize" : "nesw-resize") : horizontalResize ? "ew-resize" : "ns-resize";

        let frameId: number | null = null;
        let pendingPosition: PanelPosition | null = null;
        let pendingSize: PanelSize | null = null;
        let latestSize = startSize;

        const commitPanelLayout = (position: PanelPosition, size?: PanelSize) => {
            const nextOffset = {
                x: position.left - basePosition.left,
                y: position.top - basePosition.top,
            };
            panelPositionRef.current = position;
            panelOffsetRef.current = nextOffset;
            popoverRoot.style.setProperty("translate", `${nextOffset.x}px ${nextOffset.y}px`);
            if (size) {
                latestSize = size;
                popoverRoot.style.setProperty("--canvas-prompt-optimizer-width", `${size.width}px`);
                popoverRoot.style.setProperty("--canvas-prompt-optimizer-height", `${size.height}px`);
            }
        };

        const flushPendingLayout = () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            if (!pendingPosition && !pendingSize) return;
            const nextPosition = pendingPosition ?? panelPositionRef.current ?? startPosition;
            const nextSize = pendingSize;
            pendingPosition = null;
            pendingSize = null;
            commitPanelLayout(nextPosition, nextSize || undefined);
        };

        const schedulePanelLayout = (position: PanelPosition, size?: PanelSize) => {
            pendingPosition = position;
            pendingSize = size || pendingSize;
            if (frameId !== null) return;
            frameId = requestAnimationFrame(() => {
                frameId = null;
                if (!pendingPosition && !pendingSize) return;
                const nextPosition = pendingPosition ?? panelPositionRef.current ?? startPosition;
                const nextSize = pendingSize;
                pendingPosition = null;
                pendingSize = null;
                commitPanelLayout(nextPosition, nextSize || undefined);
            });
        };

        document.body.style.userSelect = "none";
        document.body.style.cursor = cursor;
        try {
            interactionTarget.setPointerCapture(pointerId);
        } catch {
            // 某些浏览器在指针已被外层捕获时会拒绝重复捕获，窗口级监听仍可继续完成拖动。
        }
        setPanelInteracting(true);

        const handleMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            moveEvent.preventDefault();
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            if (kind === "drag") {
                schedulePanelLayout({
                    left: clampPanelValue(startPosition.left + deltaX, PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - startRect.width),
                    top: clampPanelValue(startPosition.top + deltaY, PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - startRect.height),
                });
                return;
            }

            const bounds = getPanelResizeBounds();
            let nextWidth = startSize.width;
            let nextHeight = startSize.height;

            if (edges.right) {
                nextWidth = clampPanelValue(startSize.width + deltaX, bounds.minWidth, Math.min(bounds.maxWidth, window.innerWidth - PANEL_MARGIN - startPosition.left));
            }
            if (edges.left) {
                nextWidth = clampPanelValue(startSize.width - deltaX, bounds.minWidth, Math.min(bounds.maxWidth, startPosition.left + startSize.width - PANEL_MARGIN));
            }
            if (edges.bottom) {
                nextHeight = clampPanelValue(startSize.height + deltaY, bounds.minHeight, Math.min(bounds.maxHeight, window.innerHeight - PANEL_MARGIN - startPosition.top));
            }
            if (edges.top) {
                nextHeight = clampPanelValue(startSize.height - deltaY, bounds.minHeight, Math.min(bounds.maxHeight, startPosition.top + startSize.height - PANEL_MARGIN));
            }

            const nextPosition = {
                left: clampPanelValue(edges.left ? startPosition.left + startSize.width - nextWidth : startPosition.left, PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - nextWidth),
                top: clampPanelValue(edges.top ? startPosition.top + startSize.height - nextHeight : startPosition.top, PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - nextHeight),
            };
            schedulePanelLayout(nextPosition, { width: nextWidth, height: nextHeight });
        };

        const cleanup = () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", cleanup);
            window.removeEventListener("pointercancel", cleanup);
            flushPendingLayout();
            try {
                if (interactionTarget.hasPointerCapture(pointerId)) interactionTarget.releasePointerCapture(pointerId);
            } catch {
                // 指针已由浏览器释放时无需再次释放。
            }
            document.body.style.userSelect = previousUserSelect;
            document.body.style.cursor = previousCursor;
            setPanelOffset((current) => {
                const next = panelOffsetRef.current;
                return current.x === next.x && current.y === next.y ? current : { ...next };
            });
            if (kind === "resize") setPanelSize(latestSize);
            setPanelInteracting(false);
            if (interactionCleanupRef.current === cleanup) interactionCleanupRef.current = null;
        };

        interactionCleanupRef.current = cleanup;
        window.addEventListener("pointermove", handleMove, { passive: false });
        window.addEventListener("pointerup", cleanup);
        window.addEventListener("pointercancel", cleanup);
    };

    const nudgePanel = (deltaX: number, deltaY: number) => {
        const popoverRoot = contentRef.current?.closest<HTMLElement>(".canvas-prompt-optimizer-popover");
        if (!popoverRoot) {
            setPanelOffset((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
            return;
        }

        const rect = popoverRoot.getBoundingClientRect();
        const currentPosition = panelPositionRef.current ?? { left: rect.left, top: rect.top };
        const currentOffset = panelOffsetRef.current;
        const baseLeft = rect.left - currentOffset.x;
        const baseTop = rect.top - currentOffset.y;
        const nextPosition = {
            left: clampPanelValue(currentPosition.left + deltaX, PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - rect.width),
            top: clampPanelValue(currentPosition.top + deltaY, PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - rect.height),
        };
        const nextOffset = {
            x: nextPosition.left - baseLeft,
            y: nextPosition.top - baseTop,
        };
        panelPositionRef.current = nextPosition;
        panelOffsetRef.current = nextOffset;
        setPanelOffset(nextOffset);
    };

    const handlePanelMoveKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowLeft") nudgePanel(-step, 0);
        else if (event.key === "ArrowRight") nudgePanel(step, 0);
        else if (event.key === "ArrowUp") nudgePanel(0, -step);
        else if (event.key === "ArrowDown") nudgePanel(0, step);
        else return;
        event.preventDefault();
    };

    const runOptimization = async (requestedPrompt = draftPrompt) => {
        const promptValue = requestedPrompt.trim();
        if (!provider || working || !promptValue || (mode === "reference" && !selectedReferences.length)) return;
        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;
        setWorking(true);
        setStreaming(false);
        setError("");
        setSubmittedPrompt(promptValue);
        setDraftPrompt("");
        setResult(null);
        setSelectedPrompt("");
        try {
            const optimized = await provider.optimize(
                {
                    prompt: promptValue,
                    mode,
                    generationMode,
                    targetModel,
                    targetProtocol,
                    optimizerModel: activeOptimizerModel || undefined,
                    context: { texts: textContext, images: imageContext },
                },
                {
                    signal: controller.signal,
                    onDelta: () => setStreaming(true),
                },
            );
            if (controller.signal.aborted) return;
            setResult(optimized);
            setSelectedPrompt(optimized.optimizedPrompt);
        } catch (reason) {
            if (controller.signal.aborted) return;
            setDraftPrompt(promptValue);
            setError(reason instanceof Error ? reason.message : "提示词优化失败，请稍后重试");
        } finally {
            if (!controller.signal.aborted) {
                setWorking(false);
                setStreaming(false);
            }
        }
    };

    const applyPrompt = () => {
        const value = selectedPrompt.trim();
        if (!value) return;
        onApply(value);
        onClose();
        message.success("提示词已采用并回填到当前输入框");
    };

    const modeMenuItems = modeOptions.map((option) => ({
        key: option.value,
        label: (
            <span className="canvas-prompt-optimizer-mode-option">
                <span>{option.label}</span>
                <small>{modeDescriptions[option.value]}</small>
            </span>
        ),
    }));

    const bubbleItems: BubbleItemType[] = [
        {
            key: "assistant-intro",
            role: "ai",
            content: (
                <div className="canvas-prompt-optimizer-bubble is-assistant-bubble">
                    <div className="canvas-prompt-optimizer-message-meta">
                        <span>提示词助手</span>
                        <span>当前模式：{modeOptions.find((option) => option.value === mode)?.label}</span>
                    </div>
                    <p>{modeDescriptions[mode]}</p>
                    {mode === "reference" ? (
                        <ReferenceSelection
                            references={activeReferences}
                            selectedReferences={selectedReferences}
                            onToggle={(referenceId) => setSelectedReferenceIds((current) => (current.includes(referenceId) ? current.filter((id) => id !== referenceId) : [...current, referenceId]))}
                        />
                    ) : activeReferences.length ? (
                        <div className="canvas-prompt-optimizer-chat-reference">
                            <span>将结合参考</span>
                            <div className="flex min-w-0 flex-wrap gap-1.5">
                                {activeReferences.map((reference) => (
                                    <Tag key={reference.id}>{reference.title || reference.label}</Tag>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ),
        },
    ];

    if (submittedPrompt) {
        bubbleItems.push({
            key: "user-prompt",
            role: "user",
            content: (
                <div className="canvas-prompt-optimizer-user-content">
                    <div className="canvas-prompt-optimizer-message-meta">
                        <span>你</span>
                        <span>{submittedPrompt.length} 字</span>
                    </div>
                    <div className="canvas-prompt-optimizer-bubble is-user-bubble">{submittedPrompt}</div>
                </div>
            ),
        });
    }

    if (working) {
        bubbleItems.push({
            key: "working",
            role: "ai",
            content: (
                <div className="canvas-prompt-optimizer-bubble is-assistant-bubble is-working" role="status">
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                    <span>{streaming ? "正在接收优化结果…" : "正在整理你的想法…"}</span>
                </div>
            ),
        });
    }

    if (error) {
        bubbleItems.push({
            key: "error",
            role: "system",
            content: <Alert className="canvas-prompt-optimizer-alert" type="error" showIcon message="优化失败" description={error} />,
        });
    }

    if (result) {
        bubbleItems.push({
            key: "result",
            role: "ai",
            content: (
                <div className="canvas-prompt-optimizer-bubble is-assistant-bubble is-result-bubble">
                    <div className="canvas-prompt-optimizer-message-meta">
                        <span>提示词助手</span>
                        {result.modelProfile ? (
                            <Tag color="blue" bordered={false}>
                                已按 {result.modelProfile.label} 适配
                            </Tag>
                        ) : null}
                    </div>
                    <div className="canvas-prompt-optimizer-result-heading">
                        <span>我建议这样写</span>
                        <Button type="primary" size="small" icon={<Check className="size-3.5" />} onClick={applyPrompt} disabled={!selectedPrompt.trim()} aria-label="采用优化后的提示词">
                            采用
                        </Button>
                    </div>
                    <Input.TextArea
                        className="canvas-prompt-optimizer-textarea canvas-prompt-optimizer-result-textarea"
                        value={selectedPrompt}
                        onChange={(event) => setSelectedPrompt(event.target.value)}
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        aria-label="优化后的提示词"
                    />

                    {result.negativePrompt ? (
                        <div className="canvas-prompt-optimizer-chat-detail">
                            <span>建议规避</span>
                            <p>{result.negativePrompt}</p>
                        </div>
                    ) : null}
                    {result.changes.length ? <ResultList title="我做了什么" items={result.changes} /> : null}
                    {result.assumptions.length ? <ResultList title="需要你确认" items={result.assumptions} warning /> : null}

                    {result.variants.length ? (
                        <div className="canvas-prompt-optimizer-subsection">
                            <div className="canvas-prompt-optimizer-field-label">
                                <span>备选版本</span>
                            </div>
                            <div className="space-y-2">
                                {result.variants.map((variant) => {
                                    const selected = selectedPrompt === variant.prompt;
                                    return (
                                        <button
                                            key={`${variant.label}-${variant.prompt}`}
                                            type="button"
                                            className={`canvas-prompt-optimizer-variant ${selected ? "is-selected" : ""}`}
                                            onClick={() => setSelectedPrompt(variant.prompt)}
                                            aria-pressed={selected}
                                        >
                                            <span className="mb-1 flex items-center gap-1.5 text-[var(--fs-micro)] font-medium text-foreground/72">
                                                {selected ? <Check className="size-3.5 text-primary" /> : null}
                                                {variant.label}
                                            </span>
                                            <span className="line-clamp-3 text-[var(--fs-body)] leading-5 text-foreground/70">{variant.prompt}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                </div>
            ),
        });
    }

    const popoverRootStyle = {
        "--canvas-prompt-optimizer-width": `${panelSize.width}px`,
        "--canvas-prompt-optimizer-height": `${panelSize.height}px`,
        translate: `${panelOffset.x}px ${panelOffset.y}px`,
    } as CSSProperties;

    const content = (
        <div ref={contentRef} className={`canvas-prompt-optimizer-panel${panelInteracting ? " is-interacting" : ""}`} data-canvas-no-zoom>
            <div
                className="canvas-prompt-optimizer-header"
                onPointerDown={(event) => {
                    if ((event.target as Element | null)?.closest("button")) return;
                    beginPanelInteraction(event, "drag");
                }}
            >
                <div className="canvas-prompt-optimizer-header-main canvas-prompt-optimizer-drag-region" role="button" tabIndex={0} aria-label="移动提示词优化面板" title="拖动移动面板，方向键也可以移动" onKeyDown={handlePanelMoveKeyDown}>
                    <span className="canvas-prompt-optimizer-icon">
                        <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <div className="canvas-prompt-optimizer-header-title">
                        <div className="canvas-prompt-optimizer-header-title-row">
                            <Typography.Text strong>AI 提示词优化</Typography.Text>
                            <span className="canvas-prompt-optimizer-mode-badge">{generationMode === "image" ? "图片" : "视频"}</span>
                            <span className="canvas-prompt-optimizer-context" title={targetModel || "未配置模型"}>
                                · {targetModel || "未配置模型"}
                                {referenceCount ? ` · 参考 ${referenceCount}` : ""}
                            </span>
                        </div>
                    </div>
                </div>
                <button type="button" className="canvas-prompt-optimizer-close" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="关闭提示词优化">
                    <X className="size-4" aria-hidden="true" />
                </button>
            </div>

            <div ref={chatRef} className="canvas-prompt-optimizer-chat-shell">
                <Bubble.List
                    className="canvas-prompt-optimizer-chat thin-scrollbar"
                    items={bubbleItems}
                    autoScroll={false}
                    aria-live="polite"
                    role={{
                        ai: {
                            placement: "start",
                            variant: "borderless",
                            avatar: (
                                <span className="canvas-prompt-optimizer-message-avatar">
                                    <Sparkles className="size-3.5" aria-hidden="true" />
                                </span>
                            ),
                        },
                        user: { placement: "end", variant: "borderless" },
                        system: { placement: "start", variant: "borderless" },
                    }}
                />
            </div>

            <div className="canvas-prompt-optimizer-composer">
                <Sender
                    className="canvas-prompt-optimizer-sender"
                    value={draftPrompt}
                    onChange={(value) => setDraftPrompt(value)}
                    onSubmit={(value) => void runOptimization(value)}
                    placeholder="继续描述你的画面想法，Enter 发送"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    disabled={working}
                    suffix={false}
                    submitType="enter"
                    footer={
                        <div className="canvas-prompt-optimizer-composer-toolbar">
                            <div className="canvas-prompt-optimizer-composer-leading">
                                <Dropdown
                                    trigger={["click"]}
                                    placement="topLeft"
                                    classNames={{ root: "canvas-prompt-optimizer-mode-dropdown" }}
                                    menu={{
                                        items: modeMenuItems,
                                        selectedKeys: [mode],
                                        onClick: ({ key }) => setMode(key as PromptOptimizationMode),
                                    }}
                                >
                                    <button type="button" className="canvas-prompt-optimizer-mode-trigger" aria-label="选择优化方式" aria-haspopup="menu">
                                        <span>{modeOptions.find((option) => option.value === mode)?.label}</span>
                                        <ChevronDown className="size-3" aria-hidden="true" />
                                    </button>
                                </Dropdown>
                            </div>
                            <div className="flex min-w-0 items-center gap-2">
                                <ModelPicker
                                    config={config}
                                    value={activeOptimizerModel}
                                    onChange={setActiveOptimizerModel}
                                    capability="text"
                                    placeholder="选择优化模型"
                                    showSelectedPrice={false}
                                    variant="creation"
                                    className="canvas-prompt-optimizer-model-picker"
                                    popoverClassName="canvas-prompt-optimizer-model-popover"
                                />
                                <button
                                    type="button"
                                    className="canvas-prompt-optimizer-send"
                                    onClick={() => void runOptimization()}
                                    disabled={!provider || working || !draftPrompt.trim() || (mode === "reference" && !selectedReferences.length)}
                                    aria-label={working ? "正在优化" : "发送优化请求"}
                                >
                                    {working ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-4" strokeWidth={2.35} aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                    }
                    aria-label="输入提示词优化请求"
                />
            </div>

            <div className="canvas-prompt-optimizer-resize-handle is-edge-top" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { top: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-edge-right" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { right: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-edge-bottom" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { bottom: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-edge-left" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { left: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-corner-top-left" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { top: true, left: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-corner-top-right" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { top: true, right: true })} />
            <div className="canvas-prompt-optimizer-resize-handle is-corner-bottom-left" aria-hidden="true" onPointerDown={(event) => beginPanelInteraction(event, "resize", { bottom: true, left: true })} />
        </div>
    );

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            trigger={[]}
            placement="top"
            arrow={false}
            autoAdjustOverflow
            motion={{ motionName: "" }}
            styles={{ root: popoverRootStyle }}
            content={content}
            classNames={{ root: "canvas-prompt-optimizer-popover", container: "canvas-prompt-optimizer-popover-surface", content: "canvas-prompt-optimizer-popover-content" }}
        >
            {children}
        </Popover>
    );
}

function ResultList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
    return (
        <div className="canvas-prompt-optimizer-subsection">
            <div className="canvas-prompt-optimizer-field-label">
                <span>{title}</span>
            </div>
            <ul className={`canvas-prompt-optimizer-list ${warning ? "is-warning" : ""}`}>
                {items.map((item) => (
                    <li key={item} className="list-disc pl-1 marker:text-foreground/35">
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ReferenceSelection({ references, selectedReferences, onToggle }: { references: CanvasResourceReference[]; selectedReferences: CanvasResourceReference[]; onToggle: (referenceId: string) => void }) {
    return (
        <div className="canvas-prompt-optimizer-reference-selection">
            <div className="canvas-prompt-optimizer-reference-heading">
                <span>参考内容</span>
                <span>{references.length ? `已选 ${selectedReferences.length}/${references.length}` : "当前上下文未连接参考"}</span>
            </div>
            {references.length ? (
                <div className="canvas-prompt-optimizer-reference-list" role="group" aria-label="本次优化使用的参考内容">
                    {references.map((reference) => {
                        const selected = selectedReferences.some((item) => item.id === reference.id);
                        return (
                            <button
                                key={reference.id}
                                type="button"
                                className={`canvas-prompt-optimizer-reference-chip ${selected ? "is-selected" : ""}`}
                                aria-pressed={selected}
                                onClick={() => onToggle(reference.id)}
                                title={`${selected ? "取消使用" : "使用"} ${reference.title || reference.label}`}
                            >
                                <ReferencePreview reference={reference} />
                                <span className="canvas-prompt-optimizer-reference-chip-label">{reference.title || reference.label}</span>
                                {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <p className="canvas-prompt-optimizer-reference-empty">请先添加参考图、角色或文本，再使用此模式。</p>
            )}
        </div>
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if ((reference.kind === "image" || reference.kind === "character") && reference.previewUrl) {
        return <img className="canvas-prompt-optimizer-reference-chip-preview" src={reference.previewUrl} alt="" />;
    }
    const Icon = reference.kind === "text" ? FileText : reference.kind === "video" ? Video : reference.kind === "audio" ? Music2 : reference.kind === "character" ? UserRound : ImageIcon;
    return (
        <span className="canvas-prompt-optimizer-reference-chip-icon">
            <Icon className="size-3.5" aria-hidden="true" />
        </span>
    );
}
