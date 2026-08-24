import { useMemo, useState } from "react";
import { Input, Popover } from "antd";
import { Search, WandSparkles } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export type CanvasPromptPreset = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    modes: CanvasGenerationMode[];
    source: "builtin" | "skill";
};

const BUILTIN_PRESETS: CanvasPromptPreset[] = [
    {
        id: "character-sheet",
        name: t("canvas:character-reference-sheet"),
        description: t("canvas:front-side-back-and-expression-references-lock-character-consistency"),
        prompt: t("domain:generate-a-character-reference-sheet-keep-identity-features-hair-outfit"),
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "multi-angle",
        name: t("canvas:multi-angle-views"),
        description: t("domain:generate-continuous-connectable-camera-angles-around-the-same-subject"),
        prompt: t("domain:design-multi-camera-views-of-the-same-subject-with-consistent-characters"),
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "next-shot",
        name: t("canvas:next-shot-inference"),
        description: t("canvas:infer-the-surrounding-action-and-shot-transitions-of-the-current-frame"),
        prompt: t("domain:infer-the-next-continuous-shot-from-the-current-frame-keep-characters-an"),
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "story-beats",
        name: t("canvas:continuous-shots"),
        description: t("canvas:split-the-story-into-generatable-continuous-shot-beats"),
        prompt: t("domain:split-this-content-into-continuous-shot-beats-each-shot-states-subject-a"),
        modes: ["text", "image", "video"],
        source: "builtin",
    },
    {
        id: "cinematic-light",
        name: t("canvas:cinematic-lighting-enhance"),
        description: t("domain:keep-the-content-optimize-for-realistic-light-depth-and-blending"),
        prompt: t("domain:keep-subject-identity-action-and-original-composition-optimize-for-true"),
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "video-prompt",
        name: t("canvas:video-prompt-refine"),
        description: t("domain:restructure-into-timed-shot-instructions-the-model-can-follow-more-relia"),
        prompt: t("domain:rewrite-the-request-as-a-structured-video-prompt-describing-opening-fram"),
        modes: ["text", "video"],
        source: "builtin",
    },
];

export function CanvasPresetPicker({
    mode,
    skillReferences = [],
    open,
    onOpenChange,
    onSelect,
    compact = false,
    dense = false,
}: {
    mode: CanvasGenerationMode;
    skillReferences?: CanvasResourceReference[];
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSelect: (preset: CanvasPromptPreset) => void;
    compact?: boolean;
    dense?: boolean;
}) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [internalOpen, setInternalOpen] = useState(false);
    const [query, setQuery] = useState("");
    const actualOpen = open ?? internalOpen;
    const setOpen = (next: boolean) => {
        if (!next) setQuery("");
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    const presets = useMemo(() => {
        const skills = skillReferences.flatMap((reference): CanvasPromptPreset[] => {
            if (!reference.skill) return [];
            return [
                {
                    id: `skill:${reference.skill.skill_id}`,
                    name: reference.skill.skill_name,
                    description: reference.skill.description || reference.skill.instruction || t("canvas:skills-added"),
                    prompt: `@${reference.skill.skill_name} `,
                    modes: ["text", "image", "video", "audio"],
                    source: "skill",
                },
            ];
        });
        const normalized = query.trim().toLowerCase();
        return [...BUILTIN_PRESETS.filter((preset) => preset.modes.includes(mode)), ...skills].filter((preset) => !normalized || `${preset.name} ${preset.description}`.toLowerCase().includes(normalized));
    }, [mode, query, skillReferences]);

    const content = (
        <div data-canvas-no-zoom className="canvas-preset-picker-menu w-[var(--panel-width-compact)] max-w-[calc(100vw-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Input
                className="canvas-preset-picker-search"
                variant="borderless"
                autoFocus
                allowClear
                size="small"
                prefix={<Search className="size-3.5" />}
                placeholder={t("canvas:search-presets-or-added-skills")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />
            <div className="thin-scrollbar mt-1 max-h-72 space-y-0.5 overflow-y-auto">
                {presets.length ? (
                    presets.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className="canvas-preset-picker-option"
                            onClick={() => {
                                onSelect(preset);
                                setOpen(false);
                            }}
                        >
                            <span className="canvas-preset-picker-option-icon" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                <WandSparkles className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme.node.text }}>
                                    <span className="truncate">{preset.name}</span>
                                    <span className="shrink-0 text-[var(--fs-micro)] font-medium" style={{ color: theme.accent.primary }}>
                                        {preset.source === "skill" ? t("canvas:skills") : t("canvas:presets-3")}
                                    </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[var(--fs-tiny)] leading-4" style={{ color: theme.node.muted }}>
                                    {preset.description}
                                </span>
                            </span>
                        </button>
                    ))
                ) : (
                    <div className="py-8 text-center text-xs" style={{ color: theme.node.muted }}>
                        {t("canvas:no-matching-presets-2")}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <Popover
            open={actualOpen}
            onOpenChange={setOpen}
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={content}
            classNames={{ root: "canvas-preset-picker-popover", container: "canvas-composer-popover-surface", content: "canvas-composer-popover-content" }}
        >
            <button
                type="button"
                className={`canvas-preset-picker-trigger inline-flex shrink-0 items-center justify-center gap-1 rounded-lg transition hover:brightness-110 focus-visible:outline-none ${compact ? "size-6" : dense ? "h-6 px-1.5" : "h-7 px-2"}`}
                style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}
                title={t("canvas:open-prompt-presets")}
                aria-label={t("canvas:open-prompt-presets")}
                aria-expanded={actualOpen}
            >
                <WandSparkles className={dense ? "size-3" : "size-3.5"} />
                {compact ? null : <span className="text-[var(--fs-tiny)] font-semibold">{t("canvas:presets-3")}</span>}
            </button>
        </Popover>
    );
}
