import { useMemo, useState } from "react";
import { Input, Popover } from "antd";
import { Search, WandSparkles } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

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
        name: "角色设定图",
        description: "正面、侧面、背面与表情参考，锁定角色一致性",
        prompt: "生成角色设定图：保持同一角色身份、五官、发型、服装和体态一致，包含正面、侧面、背面和关键表情参考，背景简洁，便于后续镜头复用。",
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "multi-angle",
        name: "多机位视角",
        description: "围绕同一主体生成连续、可衔接的机位变化",
        prompt: "围绕同一主体设计多机位画面，保持人物、服装、场景和光线一致，分别给出远景、全景、中景、近景、特写、侧面、背面和俯拍视角，镜头之间具有连续性。",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "next-shot",
        name: "画面推演",
        description: "推演当前画面的前后动作与镜头衔接",
        prompt: "基于当前画面推演下一个连续镜头：保持角色和场景一致，明确主体接下来的动作、视线、环境变化、镜头运动和自然衔接方式，不要跳变构图或身份。",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "story-beats",
        name: "连续镜头",
        description: "将短剧情拆成可生成的连续镜头节拍",
        prompt: "把这段内容拆成连续镜头节拍。每个镜头写清主体动作、景别、构图、机位、运镜、光线、情绪和与前后镜头的衔接，并保持角色、场景和道具一致。",
        modes: ["text", "image", "video"],
        source: "builtin",
    },
    {
        id: "cinematic-light",
        name: "电影光影优化",
        description: "保留内容，优化真实光线、层次和融合感",
        prompt: "保留主体身份、动作和原始构图，优化为真实电影摄影光线：明确主光方向、环境反射、阴影层次、肤色和背景融合，降低塑料感与过度锐化，不改变画面内容。",
        modes: ["image", "video"],
        source: "builtin",
    },
    {
        id: "video-prompt",
        name: "视频提示词优化",
        description: "整理为模型更容易执行的时序化镜头指令",
        prompt: "将当前要求改写为结构化视频提示词，按时间顺序描述开场画面、主体动作、镜头运动、环境变化、声音和结束画面；消除冲突指令，保留所有关键约束。",
        modes: ["text", "video"],
        source: "builtin",
    },
];

export function CanvasPresetPicker({ mode, skillReferences = [], open, onOpenChange, onSelect, compact = false, dense = false }: { mode: CanvasGenerationMode; skillReferences?: CanvasResourceReference[]; open?: boolean; onOpenChange?: (open: boolean) => void; onSelect: (preset: CanvasPromptPreset) => void; compact?: boolean; dense?: boolean }) {
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
            return [{ id: `skill:${reference.skill.skill_id}`, name: reference.skill.skill_name, description: reference.skill.description || reference.skill.instruction || "已加入技能", prompt: `@${reference.skill.skill_name} `, modes: ["text", "image", "video", "audio"], source: "skill" }];
        });
        const normalized = query.trim().toLowerCase();
        return [...BUILTIN_PRESETS.filter((preset) => preset.modes.includes(mode)), ...skills].filter((preset) => !normalized || `${preset.name} ${preset.description}`.toLowerCase().includes(normalized));
    }, [mode, query, skillReferences]);

    const content = (
        <div data-canvas-no-zoom className="canvas-preset-picker-menu w-[320px] max-w-[calc(100vw-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Input className="canvas-preset-picker-search" variant="borderless" autoFocus allowClear size="small" prefix={<Search className="size-3.5" />} placeholder="搜索预设或已加入技能" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="thin-scrollbar mt-1 max-h-72 space-y-0.5 overflow-y-auto">
                {presets.length ? presets.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        className="canvas-preset-picker-option"
                        onClick={() => {
                            onSelect(preset);
                            setOpen(false);
                        }}
                    >
                        <span className="canvas-preset-picker-option-icon" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}><WandSparkles className="size-3.5" /></span>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme.node.text }}>
                                <span className="truncate">{preset.name}</span>
                                <span className="shrink-0 text-[var(--fs-micro)] font-medium" style={{ color: theme.accent.primary }}>{preset.source === "skill" ? "技能" : "预设"}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[var(--fs-tiny)] leading-4" style={{ color: theme.node.muted }}>{preset.description}</span>
                        </span>
                    </button>
                )) : <div className="py-8 text-center text-xs" style={{ color: theme.node.muted }}>没有匹配的预设</div>}
            </div>
        </div>
    );

    return (
        <Popover open={actualOpen} onOpenChange={setOpen} trigger="click" placement="topLeft" arrow={false} content={content} classNames={{ root: "canvas-preset-picker-popover", container: "canvas-composer-popover-surface", content: "canvas-composer-popover-content" }}>
            <button type="button" className={`canvas-preset-picker-trigger inline-flex shrink-0 items-center justify-center gap-1 rounded-lg transition hover:brightness-110 focus-visible:outline-none ${compact ? "size-6" : dense ? "h-6 px-1.5" : "h-7 px-2"}`} style={{ background: theme.accent.primarySoft, color: theme.accent.primary }} title="打开提示词预设" aria-label="打开提示词预设" aria-expanded={actualOpen}>
                <WandSparkles className={dense ? "size-3" : "size-3.5"} />
                {compact ? null : <span className="text-[var(--fs-tiny)] font-semibold">预设</span>}
            </button>
        </Popover>
    );
}
