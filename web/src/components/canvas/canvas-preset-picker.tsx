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
            return [{ id: `skill:${reference.skill.dir}`, name: reference.skill.name, description: reference.skill.description || reference.skill.detail_text || "已激活技能", prompt: `@${reference.skill.name} `, modes: ["text", "image", "video", "audio"], source: "skill" }];
        });
        const normalized = query.trim().toLowerCase();
        return [...BUILTIN_PRESETS.filter((preset) => preset.modes.includes(mode)), ...skills].filter((preset) => !normalized || `${preset.name} ${preset.description}`.toLowerCase().includes(normalized));
    }, [mode, query, skillReferences]);

    const content = (
        <div data-canvas-no-zoom className="w-[320px] max-w-[calc(100vw-32px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Input autoFocus allowClear size="small" prefix={<Search className="size-3.5 opacity-45" />} placeholder="搜索预设或已激活技能" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="thin-scrollbar mt-2 max-h-72 overflow-y-auto space-y-1">
                {presets.length ? presets.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => {
                            onSelect(preset);
                            setOpen(false);
                        }}
                    >
                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.activeStroke }}><WandSparkles className="size-3.5" /></span>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme.node.text }}>
                                <span className="truncate">{preset.name}</span>
                                <span className="shrink-0 text-[9px] font-medium" style={{ color: theme.node.faint }}>{preset.source === "skill" ? "技能" : "预设"}</span>
                            </span>
                            <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4" style={{ color: theme.node.muted }}>{preset.description}</span>
                        </span>
                    </button>
                )) : <div className="py-8 text-center text-xs" style={{ color: theme.node.muted }}>没有匹配的预设</div>}
            </div>
        </div>
    );

    return (
        <Popover open={actualOpen} onOpenChange={setOpen} trigger="click" placement="topLeft" content={content} styles={{ content: { padding: 8, background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}` } }}>
            <button type="button" className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md transition hover:brightness-110 ${compact ? "size-6" : dense ? "h-6 px-1.5" : "h-7 px-2"}`} style={{ background: theme.toolbar.itemHover, color: theme.node.muted }} title="预设（输入 / 也可打开）" aria-label="打开预设">
                <WandSparkles className={dense ? "size-3" : "size-3.5"} />
                {compact ? null : <span className="text-[10px] font-medium">预设</span>}
            </button>
        </Popover>
    );
}
