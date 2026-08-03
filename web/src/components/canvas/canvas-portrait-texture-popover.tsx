import { Popover } from "antd";
import { SlidersHorizontal } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    PORTRAIT_TEXTURE_GROUPS,
    normalizePortraitTextureSettings,
    type PortraitTextureSettingKey,
    type PortraitTextureSettings,
} from "@/lib/canvas/canvas-portrait-texture";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasPortraitTexturePopoverProps = {
    value: unknown;
    placement?: "topLeft" | "topRight";
    onChange: (settings: PortraitTextureSettings) => void;
};

export function CanvasPortraitTexturePopover({ value, placement = "topLeft", onChange }: CanvasPortraitTexturePopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const settings = normalizePortraitTextureSettings(value);

    const updateSetting = (key: PortraitTextureSettingKey, nextValue: string) => {
        onChange(normalizePortraitTextureSettings({ ...settings, [key]: nextValue }));
    };

    const content = (
        <div className="w-[min(350px,calc(100vw-32px))] p-2.5" style={{ color: theme.node.text }}>
            <div className="mb-2 flex items-center gap-1.5 px-0.5">
                <SlidersHorizontal className="size-3.5" style={{ color: theme.accent.primary }} />
                <span className="text-xs font-medium">人物质感调节</span>
            </div>
            <div className="space-y-1">
                {PORTRAIT_TEXTURE_GROUPS.map((group) => (
                    <div key={group.key} className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 py-1">
                        <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>{group.label}</span>
                        <div className="grid min-w-0 grid-cols-3 gap-1" role="radiogroup" aria-label={group.label}>
                            {group.options.map((option) => {
                                const selected = settings[group.key] === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        className="h-7 min-w-0 rounded-md border px-1 text-[var(--fs-tiny)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                                        style={{
                                            background: selected ? theme.accent.primarySoft : theme.toolbar.itemHover,
                                            borderColor: selected ? theme.accent.primary : "transparent",
                                            color: selected ? theme.accent.primary : theme.node.muted,
                                            outlineColor: theme.accent.primary,
                                        }}
                                        onClick={() => updateSetting(group.key, option.value)}
                                    >
                                        <span className="block truncate">{option.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <Popover
            trigger="click"
            placement={placement}
            arrow={false}
            content={content}
            styles={{ content: { padding: 0, overflow: "hidden", background: theme.spatial.elevated, border: `1px solid ${theme.toolbar.border}`, borderRadius: 8, boxShadow: `0 20px 64px ${theme.spatial.shadow}` } }}
        >
            <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                style={{ background: theme.accent.primarySoft, color: theme.accent.primary, outlineColor: theme.accent.primary }}
                aria-label="打开人物质感调节面板"
            >
                <SlidersHorizontal className="size-3 shrink-0" />
                <span className="truncate text-[var(--fs-tiny)] font-medium">人物质感调节</span>
            </button>
        </Popover>
    );
}
