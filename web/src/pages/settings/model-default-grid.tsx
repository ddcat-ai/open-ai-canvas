import { Tag } from "antd";
import { AudioLines, Check, Film, Image, MessageSquareText } from "lucide-react";

import { ModelIcon } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import {
    filterModelsByCapability,
    modelDisplayName,
    modelOptionName,
    resolveModelChannel,
    type AiConfig,
    type ModelCapability,
} from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type DefaultModelKey = "imageModel" | "videoModel" | "textModel" | "audioModel";

const groups: Array<{
    capability: ModelCapability;
    modelKey: DefaultModelKey;
    title: string;
    description: string;
    icon: typeof Image;
}> = [
    { capability: "image", modelKey: "imageModel", title: "默认生图模型", description: "图片生成、图像编辑与视觉探索", icon: Image },
    { capability: "video", modelKey: "videoModel", title: "默认视频模型", description: "文生视频、图生视频与镜头延展", icon: Film },
    { capability: "text", modelKey: "textModel", title: "默认文本模型", description: "提示词改写、脚本与结构化文本", icon: MessageSquareText },
    { capability: "audio", modelKey: "audioModel", title: "默认音频模型", description: "语音、音效与音乐生成", icon: AudioLines },
];

export function ModelDefaultGrid({ config, onChange }: { config: AiConfig; onChange: (key: DefaultModelKey, model: string) => void }) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    return (
        <div className="divide-y divide-border/70">
            {groups.map((group) => {
                const models = filterModelsByCapability(config.models, group.capability, config.channels);
                const Icon = group.icon;
                return (
                    <section key={group.capability} className="py-5 first:pt-0 last:pb-0" aria-labelledby={`default-${group.capability}-title`}>
                        <div className="mb-3 flex items-start gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted/35 text-foreground/65"><Icon className="size-4" /></span>
                            <div className="min-w-0">
                                <h3 id={`default-${group.capability}-title`} className="text-sm font-semibold">{group.title}</h3>
                                <p className="mt-0.5 text-xs text-foreground/48">{group.description}</p>
                            </div>
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground/38">{models.length} 个可用</span>
                        </div>
                        {models.length ? (
                            <div role="radiogroup" aria-label={group.title} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {models.map((model) => {
                                    const channel = resolveModelChannel(config, model);
                                    const selected = config[group.modelKey] === model;
                                    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
                                    return (
                                        <button
                                            key={model}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            className={cn(
                                                "group relative min-h-[76px] overflow-hidden rounded-md border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                                selected
                                                    ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent-soft)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--workspace-accent)_28%,transparent)]"
                                                    : "border-border/85 bg-background hover:border-foreground/25 hover:bg-muted/25",
                                            )}
                                            onClick={() => onChange(group.modelKey, model)}
                                        >
                                            <span className="flex min-w-0 items-start gap-2.5">
                                                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border", selected ? "border-[color-mix(in_srgb,var(--workspace-accent)_28%,transparent)] bg-background/70" : "border-border/70 bg-muted/35")}>
                                                    <ModelIcon model={model} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-semibold">{modelDisplayName(config, model)}</span>
                                                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--fs-tiny)] text-foreground/45">
                                                        <span className="max-w-full truncate">{channel.name || "未命名渠道"}</span>
                                                        <span className="rounded border border-border/70 px-1 py-px text-[var(--fs-micro)]">{channel.scope === "system" ? "系统" : "自定义"}</span>
                                                        {creditsEnabled && cost ? <Tag color="gold" className="!m-0 !px-1.5 !text-[var(--fs-micro)] !font-medium !leading-[18px] tabular-nums">{formatPrice(cost.unitPriceMicrocredits)} 积分/{cost.billingMode === "per_second" ? "秒" : "次"}</Tag> : null}
                                                    </span>
                                                </span>
                                                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", selected ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent)] text-white" : "border-border text-transparent group-hover:border-foreground/30")}>
                                                    <Check className="size-3" strokeWidth={2.5} />
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-foreground/45">当前渠道中没有可用的{capabilityLabel(group.capability)}模型</div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function capabilityLabel(capability: ModelCapability) {
    return { image: "图片", video: "视频", text: "文本", audio: "音频" }[capability];
}

function formatPrice(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
