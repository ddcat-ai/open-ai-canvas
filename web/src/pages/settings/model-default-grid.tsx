import { AudioLines, Check, Film, Image, MessageSquareText } from "lucide-react";

import { ModelIcon } from "@/components/model-picker";
import { formatLocale } from "@/lib/format-locale";
import { cn } from "@/lib/utils";
import { filterModelsByCapability, modelDisplayName, modelOptionName, resolveModelChannel, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type DefaultModelKey = "imageModel" | "videoModel" | "textModel" | "audioModel";

const groups: Array<{
    capability: ModelCapability;
    modelKey: DefaultModelKey;
    title: string;
    description: string;
    icon: typeof Image;
}> = [
    { capability: "image", modelKey: "imageModel", title: t("settings:default-image-model"), description: t("settings:image-generation-editing-and-visual-exploration"), icon: Image },
    { capability: "video", modelKey: "videoModel", title: t("settings:default-video-model"), description: t("settings:text-to-video-image-to-video-and-shot-extension"), icon: Film },
    { capability: "text", modelKey: "textModel", title: t("settings:default-text-model"), description: t("settings:prompt-rewriting-scripts-and-structured-text"), icon: MessageSquareText },
    { capability: "audio", modelKey: "audioModel", title: t("settings:default-audio-model"), description: t("settings:speech-sound-effects-and-music-generation"), icon: AudioLines },
];

export function ModelDefaultGrid({ config, onChange }: { config: AiConfig; onChange: (key: DefaultModelKey, model: string) => void }) {
    const { t } = useTranslation("canvas");
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    return (
        <div className="space-y-1">
            {groups.map((group) => {
                const models = filterModelsByCapability(config.models, group.capability, config.channels);
                const Icon = group.icon;
                return (
                    <section key={group.capability} className="py-5 first:pt-0 last:pb-0" aria-labelledby={`default-${group.capability}-title`}>
                        <div className="mb-3 flex items-start gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-active text-foreground/65">
                                <Icon className="size-4" />
                            </span>
                            <div className="min-w-0">
                                <h3 id={`default-${group.capability}-title`} className="text-sm font-semibold">
                                    {group.title}
                                </h3>
                                <p className="mt-0.5 text-xs text-foreground/48">{group.description}</p>
                            </div>
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground/38">
                                {models.length} {t("settings:available-2")}
                            </span>
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
                                                "model-default-option group relative overflow-hidden rounded-md px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                                selected && "is-selected",
                                            )}
                                            onClick={() => onChange(group.modelKey, model)}
                                        >
                                            <span className="flex min-w-0 items-start gap-2.5">
                                                <span className="model-default-option-icon grid size-8 shrink-0 place-items-center rounded-md">
                                                    <ModelIcon config={config} model={model} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-semibold">{modelDisplayName(config, model)}</span>
                                                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--fs-tiny)] text-foreground/45">
                                                        <span className="max-w-full truncate">{channel.name || t("settings:untitled-channel")}</span>
                                                        <span className="model-default-option-scope">{channel.scope === "system" ? t("settings:system") : t("settings:custom")}</span>
                                                        {creditsEnabled && cost ? (
                                                            <span className="model-default-price">
                                                                {formatPrice(cost.billingMode === "token" ? cost.outputTokenPriceMicrocredits || 0 : cost.unitPriceMicrocredits)} /
                                                                {cost.billingMode === "token" ? t("settings:million-tokens") : cost.billingMode === "per_second" ? t("settings:s") : t("settings:requests")}
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                </span>
                                                <span className={cn("model-default-option-check grid size-5 shrink-0 place-items-center rounded-full", selected ? "is-selected" : "text-transparent")}>
                                                    <Check className="size-3" strokeWidth={2.5} />
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-md bg-surface-active px-4 py-6 text-center text-xs text-foreground/45">
                                {t("settings:none-available-on-the-current-channel")}
                                {capabilityLabel(group.capability)}
                                {t("settings:models-4")}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function capabilityLabel(capability: ModelCapability) {
    const { t } = useTranslation("canvas");
    return { image: t("settings:image"), video: t("settings:video"), text: t("settings:text"), audio: t("settings:audio") }[capability];
}

function formatPrice(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString(formatLocale(), { maximumFractionDigits: 6 });
}
