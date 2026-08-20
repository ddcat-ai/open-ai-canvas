import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import { Input, Popover } from "antd";
import { Cpu, Search, X } from "lucide-react";

import { toc } from "@lobehub/icons/es/toc";

import { cn } from "@/lib/utils";

type LobeIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// 只加载各图标的 Mono 组件；完整 icons barrel 会经由 Avatar/Combine 与 @lobehub/ui 形成循环依赖，Bun 测试环境会触发未初始化导出。
const iconModules = typeof import.meta.glob === "function"
    ? import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { eager: true, import: "default" })
    : {};
const iconRegistry = Object.fromEntries(
    Object.entries(iconModules)
        .map(([path, icon]) => [path.match(/\/([^/]+)\/components\/Mono\.js$/)?.[1], icon])
        .filter((entry): entry is [string, LobeIconComponent] => Boolean(entry[0] && entry[1])),
) as Record<string, LobeIconComponent>;
const iconOptions = toc
    .filter((item) => item.group === "model" || item.group === "provider")
    .map((item) => ({ id: item.id, title: item.fullTitle || item.title }))
    .filter((item) => Boolean(iconRegistry[item.id]));

export function ModelLogo({ icon, size = 18, className }: { icon?: string; size?: number; className?: string }) {
    const Icon = icon ? iconRegistry[icon] : undefined;
    if (!Icon) return <Cpu className={cn("shrink-0 text-foreground/45", className)} size={size} aria-hidden />;
    return <Icon size={size} className={cn("shrink-0", className)} aria-hidden />;
}

export function ModelIconPicker({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const filteredIcons = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return query ? iconOptions.filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(query)) : iconOptions;
    }, [keyword]);

    const content = (
        <div className="w-full max-w-xl space-y-2" data-canvas-no-zoom>
            <div className="flex items-center gap-2">
                <Input size="small" prefix={<Search className="size-3.5 text-foreground/40" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 Logo" allowClear />
                {value ? (
                    <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/45 hover:text-foreground" onClick={() => onChange?.("")} aria-label="清除 Logo">
                        <X className="size-3.5" />
                    </button>
                ) : null}
            </div>
            <div className="grid max-h-96 grid-cols-12 gap-1 overflow-y-auto pr-1" role="listbox" aria-label="模型 Logo">
                {filteredIcons.map((item) => {
                    const selected = value === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            title={item.title}
                            className={cn("flex size-10 items-center justify-center rounded-md text-foreground/75 hover:bg-muted/40", selected && "bg-muted/60 text-foreground")}
                            onClick={() => {
                                onChange?.(item.id);
                                setOpen(false);
                            }}
                        >
                            <ModelLogo icon={item.id} size={20} />
                        </button>
                    );
                })}
            </div>
        </div>
    );

    return (
        <Popover trigger="click" open={open} onOpenChange={setOpen} arrow={{ pointAtCenter: true }} placement="bottomLeft" classNames={{ root: "model-logo-picker-popover" }} content={content}>
            <button type="button" className="flex min-h-9 w-full items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 text-left text-sm hover:bg-muted/20" aria-label="选择模型 Logo">
                <ModelLogo icon={value} size={20} />
                <span className="min-w-0 flex-1 truncate text-foreground/70">{value ? iconOptions.find((item) => item.id === value)?.title || value : "选择 Logo"}</span>
            </button>
        </Popover>
    );
}
