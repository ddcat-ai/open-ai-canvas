import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";
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
    const searchInputRef = useRef<any>(null);

    useEffect(() => {
        if (open) {
            const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        } else {
            setKeyword("");
        }
    }, [open]);

    const filteredIcons = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return query ? iconOptions.filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(query)) : iconOptions;
    }, [keyword]);

    const content = (
        <div
            className="w-[440px] max-w-[calc(100vw-32px)] space-y-2.5 p-0.5"
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-center gap-2">
                <Input
                    ref={searchInputRef}
                    size="small"
                    prefix={<Search className="size-3.5 text-foreground/40" />}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索 Logo 名称或品牌..."
                    allowClear
                />
                {value ? (
                    <button
                        type="button"
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-foreground/60 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition-colors"
                        onClick={() => {
                            onChange?.("");
                            setOpen(false);
                        }}
                        aria-label="清除 Logo"
                    >
                        <X className="size-3" />
                        <span>清除</span>
                    </button>
                ) : null}
            </div>
            <div
                className="grid max-h-72 grid-cols-10 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-11"
                role="listbox"
                aria-label="模型 Logo"
                onWheel={(event) => event.stopPropagation()}
            >
                {filteredIcons.length ? (
                    filteredIcons.map((item) => {
                        const selected = value === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                title={item.title}
                                className={cn(
                                    "flex size-9 items-center justify-center rounded-md border border-transparent text-foreground/75 transition-all hover:scale-105 hover:border-border/80 hover:bg-surface-active hover:text-foreground",
                                    selected && "border-primary/60 bg-primary/10 text-primary shadow-xs"
                                )}
                                onClick={() => {
                                    onChange?.(item.id);
                                    setOpen(false);
                                }}
                            >
                                <ModelLogo icon={item.id} size={20} />
                            </button>
                        );
                    })
                ) : (
                    <div className="col-span-full py-8 text-center text-xs text-foreground/45">
                        未找到与 “{keyword}” 相关的 Logo
                    </div>
                )}
            </div>
            <div className="flex items-center justify-between border-t border-border/40 pt-1.5 text-[var(--fs-tiny)] text-foreground/40">
                <span>共 {filteredIcons.length} 个可用 Logo</span>
                <span>点击即选定并应用</span>
            </div>
        </div>
    );

    return (
        <Popover
            trigger={["click"]}
            open={open}
            onOpenChange={setOpen}
            arrow={{ pointAtCenter: true }}
            placement="bottomLeft"
            destroyTooltipOnHide={false}
            autoAdjustOverflow
            getPopupContainer={(trigger) => trigger.closest(".ant-modal-content, .ant-drawer-content, .admin-modal, body") || document.body}
            classNames={{ root: "model-logo-picker-popover" }}
            content={content}
        >
            <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 text-left text-sm transition-colors hover:border-border hover:bg-muted/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                aria-label="选择模型 Logo"
            >
                <ModelLogo icon={value} size={20} />
                <span className="min-w-0 flex-1 truncate text-foreground/70">{value ? iconOptions.find((item) => item.id === value)?.title || value : "选择 Logo"}</span>
            </button>
        </Popover>
    );
}
