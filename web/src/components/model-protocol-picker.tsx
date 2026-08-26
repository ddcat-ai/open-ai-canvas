import { AudioLines, Check, Film, Flame, Image, MessageSquareText, Network, Settings2, Sparkles } from "lucide-react";
import { Button, Modal } from "antd";
import { useEffect, useState, type ReactNode } from "react";

import { ModelIcon } from "@/components/model-picker";
import { modelProtocolLabel, type ModelProtocol, type ModelProtocolDefinition, type ProtocolCapability } from "@/lib/model-protocols";
import { cn } from "@/lib/utils";

export type ModelCapabilityChoice = ProtocolCapability;

const capabilityChoices: Array<{
    value: ModelCapabilityChoice;
    label: string;
    description: string;
    icon: ReactNode;
    brands: string[];
}> = [
    { value: "text", label: "文本", description: "对话与推理", icon: <MessageSquareText className="size-4" />, brands: ["openai", "deepseek", "glm"] },
    { value: "image", label: "图片", description: "生成与编辑", icon: <Image className="size-4" />, brands: ["openai", "gemini"] },
    { value: "video", label: "视频", description: "生成与续写", icon: <Film className="size-4" />, brands: ["grok", "gemini"] },
    { value: "audio", label: "音频", description: "语音与音效", icon: <AudioLines className="size-4" />, brands: ["openai"] },
];

type PickerDensity = "comfortable" | "compact";

export function CapabilityCardPicker({ value, onChange, density = "comfortable" }: { value?: ModelCapabilityChoice; onChange?: (value: ModelCapabilityChoice) => void; density?: PickerDensity }) {
    return (
        <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", density === "compact" && "gap-1.5")} role="radiogroup" aria-label="模型能力">
            {capabilityChoices.map((item) => {
                const selected = value === item.value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                            "relative flex min-w-0 flex-col rounded-md border text-left outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
                            density === "compact" ? "min-h-16 p-2" : "min-h-24 p-2.5",
                            selected ? "border-foreground/70 bg-foreground/[.04]" : "border-border/75 bg-background hover:border-foreground/25 hover:bg-muted/30",
                        )}
                        onClick={() => onChange?.(item.value)}
                    >
                        <span className={cn("grid place-items-center rounded-md", density === "compact" ? "size-6" : "size-8", selected ? "bg-foreground text-background" : "bg-muted text-foreground/65")}>{item.icon}</span>
                        {selected ? (
                            <span className={cn("absolute grid place-items-center rounded-full bg-foreground text-background", density === "compact" ? "right-1.5 top-1.5 size-4" : "right-2.5 top-2.5 size-5")}>
                                <Check className={density === "compact" ? "size-2.5" : "size-3"} />
                            </span>
                        ) : null}
                        <span className={cn("block font-semibold", density === "compact" ? "mt-1 text-xs" : "mt-2 text-sm")}>{item.label}</span>
                        <span className={cn("block text-foreground/48", density === "compact" ? "text-[var(--fs-micro)]" : "text-xs")}>{item.description}</span>
                        {density === "comfortable" ? <BrandIconRow models={item.brands} className="mt-auto pt-2" /> : null}
                    </button>
                );
            })}
        </div>
    );
}

export function ProtocolCardPicker({
    capability,
    value,
    onChange,
    density = "comfortable",
    protocols = [],
}: {
    capability?: ModelCapabilityChoice;
    value?: ModelProtocol;
    onChange?: (value: ModelProtocol) => void;
    density?: PickerDensity;
    protocols?: ModelProtocolDefinition[];
}) {
    const availableProtocols = protocols.filter((item) => item.capability === capability && item.enabled !== false);
    return (
        <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", density === "compact" && "gap-1.5 xl:grid-cols-3")} role="radiogroup" aria-label="模型请求协议">
            {availableProtocols.map((protocol) => {
                const selected = value === protocol.value;
                return (
                    <button
                        key={protocol.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                            "relative flex min-w-0 flex-col rounded-md border text-left outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
                            density === "compact" ? "min-h-16 p-2" : "min-h-24 p-2.5",
                            selected ? "border-foreground/70 bg-foreground/[.04]" : "border-border/75 bg-background hover:border-foreground/25 hover:bg-muted/30",
                        )}
                        onClick={() => onChange?.(protocol.value)}
                    >
                        <div className={cn("flex min-w-0 items-start", density === "compact" ? "gap-1.5 pr-4" : "gap-2.5 pr-6")}>
                            <ProtocolBrandMark protocol={protocol} compact={density === "compact"} />
                            <div className="min-w-0 flex-1">
                                <div className={cn("model-protocol-card-title truncate font-semibold", density === "compact" ? "text-xs" : "text-sm")}>{protocol.label}</div>
                                <div className={cn("model-protocol-card-endpoint mt-0.5 truncate font-mono text-foreground/48", density === "compact" ? "text-[var(--fs-micro)]" : "text-[var(--fs-tiny)]")}>{protocol.create}</div>
                            </div>
                        </div>
                        {selected ? (
                            <span className={cn("absolute grid place-items-center rounded-full bg-foreground text-background", density === "compact" ? "right-1.5 top-1.5 size-4" : "right-2.5 top-2.5 size-5")}>
                                <Check className={density === "compact" ? "size-2.5" : "size-3"} />
                            </span>
                        ) : null}
                        {density === "comfortable" ? (
                            <>
                                <div className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/58">{protocol.media}</div>
                                <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[var(--fs-tiny)] text-foreground/42">
                                    <span className="truncate">{protocol.contentType}</span>
                                    {protocol.poll ? <span className="shrink-0">异步轮询</span> : <span className="shrink-0">同步响应</span>}
                                </div>
                            </>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}

export function ModelCapabilityProtocolModal({
    value,
    onChange,
    protocols = [],
}: {
    value: { capability: ModelCapabilityChoice; protocol: ModelProtocol };
    onChange: (value: { capability: ModelCapabilityChoice; protocol: ModelProtocol }) => void;
    protocols?: ModelProtocolDefinition[];
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (!open) setDraft(value);
    }, [open, value]);

    const updateCapability = (capability: ModelCapabilityChoice) => {
        const protocol = draft.protocol && protocols.some((item) => item.value === draft.protocol && item.capability === capability) ? draft.protocol : protocols.find((item) => item.capability === capability)?.value || "";
        setDraft({ capability, protocol });
    };

    return (
        <>
            <Button
                size="small"
                className="max-w-full justify-start"
                icon={<Settings2 className="size-3.5" />}
                onClick={() => {
                    setDraft(value);
                    setOpen(true);
                }}
            >
                <span className="max-w-[min(56vw,360px)] truncate">
                    {capabilityLabel(value.capability)} · {modelProtocolLabel(value.protocol, protocols)}
                </span>
            </Button>
            <Modal
                title="配置模型能力与请求协议"
                open={open}
                width="min(720px, calc(100vw - 24px))"
                centered
                destroyOnHidden
                onCancel={() => setOpen(false)}
                okText="应用配置"
                cancelText="取消"
                onOk={() => {
                    onChange(draft);
                    setOpen(false);
                }}
            >
                <div className="space-y-4">
                    <section>
                        <div className="mb-2 text-xs font-semibold text-foreground/65">模型能力</div>
                        <CapabilityCardPicker value={draft.capability} onChange={updateCapability} />
                    </section>
                    <section>
                        <div className="mb-2 text-xs font-semibold text-foreground/65">请求协议</div>
                        <ProtocolCardPicker capability={draft.capability} value={draft.protocol} protocols={protocols} onChange={(protocol) => setDraft((current) => ({ ...current, protocol }))} />
                    </section>
                </div>
            </Modal>
        </>
    );
}

function ProtocolBrandMark({ protocol, compact = false }: { protocol: ModelProtocolDefinition; compact?: boolean }) {
    const iconSize = compact ? "size-6" : "size-8";
    const vendor = `${protocol.vendor || ""} ${protocol.label}`.toLowerCase();
    if (vendor.includes("jimeng") || vendor.includes("即梦"))
        return (
            <span className={cn("grid shrink-0 place-items-center rounded-md bg-muted text-foreground/65", iconSize)}>
                <Sparkles className={compact ? "size-3" : "size-4"} />
            </span>
        );
    if (vendor.includes("volcengine") || vendor.includes("火山方舟"))
        return (
            <span className={cn("grid shrink-0 place-items-center rounded-md bg-muted text-foreground/65", iconSize)}>
                <Flame className={compact ? "size-3" : "size-4"} />
            </span>
        );
    if (vendor.includes("newapi") || vendor.includes("novita"))
        return (
            <span className={cn("grid shrink-0 place-items-center rounded-md bg-muted text-foreground/65", iconSize)}>
                <Network className={compact ? "size-3" : "size-4"} />
            </span>
        );
    const brand = vendor.includes("gemini") || vendor.includes("google") ? "gemini" : vendor.includes("grok") || vendor.includes("xai") ? "grok" : vendor.includes("openai") ? "openai" : "openai";
    return <BrandIconRow models={[brand]} compact={compact} />;
}

function BrandIconRow({ models, compact = false, className }: { models: string[]; compact?: boolean; className?: string }) {
    return (
        <span className={cn("flex items-center -space-x-1", compact && "shrink-0", className)} aria-hidden="true">
            {models.map((model) => (
                <span key={model} className={cn("grid shrink-0 place-items-center rounded-md border border-border/70 bg-background", compact ? "size-6" : "size-6")} title={modelBrandLabel(model)}>
                    <ModelIcon model={model} />
                </span>
            ))}
        </span>
    );
}

function modelBrandLabel(model: string) {
    const labels: Record<string, string> = { openai: "OpenAI", deepseek: "DeepSeek", glm: "智谱 GLM", gemini: "Google Gemini", grok: "xAI Grok" };
    return labels[model] || model;
}

function capabilityLabel(value: ModelCapabilityChoice) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频" }[value];
}
