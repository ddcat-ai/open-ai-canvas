import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import { Input, Popover } from "antd";
import { Cpu, Search, X } from "lucide-react";

import { toc } from "@lobehub/icons/es/toc";

import { cn } from "@/lib/utils";

type LobeIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// 只允许按需加载 Mono 组件。这里不能使用 eager glob：模型 Logo 目录有数百个 provider 模块，
// eager 会让每次进入工作区都发起数百个开发模块请求，即使用户从未打开 Logo 选择器。
const iconModules = "Bun" in globalThis ? {} : import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" });
const iconLoaders = Object.fromEntries(
    Object.entries(iconModules)
        .map(([path, loader]) => [path.match(/\/([^/]+)\/components\/Mono\.js$/)?.[1], loader])
        .filter((entry): entry is [string, () => Promise<LobeIconComponent>] => Boolean(entry[0] && entry[1])),
) as Record<string, () => Promise<LobeIconComponent>>;
const iconRegistry = new Map<string, LobeIconComponent>();
const iconLoadPromises = new Map<string, Promise<LobeIconComponent | undefined>>();
const iconOptions = toc
    .filter((item) => item.group === "model" || item.group === "provider" || item.group === "application")
    .map((item) => ({ id: item.id, title: item.fullTitle || item.title }))
    .filter((item) => Boolean(iconLoaders[item.id]));

function loadIcon(icon?: string) {
    if (!icon) return Promise.resolve(undefined);
    const cached = iconRegistry.get(icon);
    if (cached) return Promise.resolve(cached);
    const existing = iconLoadPromises.get(icon);
    if (existing) return existing;
    const loader = iconLoaders[icon];
    if (!loader) return Promise.resolve(undefined);
    const promise = loader()
        .then((module) => {
            const loaded = (module as unknown as { default?: LobeIconComponent }).default || module;
            iconRegistry.set(icon, loaded);
            return loaded;
        })
        .catch(() => undefined);
    iconLoadPromises.set(icon, promise);
    return promise;
}

export function ModelLogo({ icon, size = 18, className }: { icon?: string; size?: number; className?: string }) {
    const [Icon, setIcon] = useState<LobeIconComponent | undefined>(() => (icon ? iconRegistry.get(icon) : undefined));
    useEffect(() => {
        let cancelled = false;
        setIcon(icon ? iconRegistry.get(icon) : undefined);
        if (!icon || !iconLoaders[icon])
            return () => {
                cancelled = true;
            };
        void loadIcon(icon).then((loaded) => {
            if (!cancelled) setIcon(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [icon]);
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
