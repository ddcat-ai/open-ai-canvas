import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";
import { Button, Input, Modal } from "antd";
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
            const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        } else {
            setKeyword("");
        }
    }, [open]);

    const filteredIcons = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return query ? iconOptions.filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(query)) : iconOptions;
    }, [keyword]);

    const selectedOption = useMemo(() => (value ? iconOptions.find((item) => item.id === value) : undefined), [value]);

    return (
        <>
            <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 text-left text-sm transition-colors hover:border-border hover:bg-muted/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                aria-label="选择模型 Logo"
                onClick={() => setOpen(true)}
            >
                <ModelLogo icon={value} size={20} />
                <span className="min-w-0 flex-1 truncate text-foreground/70">{selectedOption?.title || value || "选择 Logo"}</span>
                {value ? (
                    <span
                        className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-foreground/40 hover:bg-muted hover:text-foreground"
                        onClick={(event) => {
                            event.stopPropagation();
                            onChange?.("");
                        }}
                        title="清除 Logo"
                    >
                        <X className="size-3" />
                    </span>
                ) : (
                    <span className="text-xs text-foreground/35">浏览</span>
                )}
            </button>

            <Modal
                title="选择模型 Logo"
                open={open}
                onCancel={() => setOpen(false)}
                width={540}
                centered
                destroyOnClose
                footer={
                    <div className="flex items-center justify-between py-1 text-xs text-foreground/45">
                        <span>共 {filteredIcons.length} 个可用 Logo</span>
                        <div className="flex items-center gap-2">
                            {value ? (
                                <Button
                                    size="small"
                                    onClick={() => {
                                        onChange?.("");
                                        setOpen(false);
                                    }}
                                >
                                    清除 Logo
                                </Button>
                            ) : null}
                            <Button type="primary" size="small" onClick={() => setOpen(false)}>
                                完成
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="space-y-3 pt-2">
                    <Input
                        ref={searchInputRef}
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="搜索品牌或模型名称（如 OpenAI, Claude, Google, Flux...）"
                        allowClear
                    />
                    <div
                        className="grid max-h-[380px] grid-cols-8 gap-2 overflow-y-auto pr-1 sm:grid-cols-9"
                        role="listbox"
                        aria-label="模型 Logo 列表"
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
                                            "group relative flex size-12 flex-col items-center justify-center rounded-lg border border-border/50 bg-surface text-foreground/75 transition-all hover:scale-105 hover:border-primary/60 hover:bg-surface-active hover:text-foreground",
                                            selected && "border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary"
                                        )}
                                        onClick={() => {
                                            onChange?.(item.id);
                                            setOpen(false);
                                        }}
                                    >
                                        <ModelLogo icon={item.id} size={24} />
                                    </button>
                                );
                            })
                        ) : (
                            <div className="col-span-full py-12 text-center text-xs text-foreground/45">
                                未找到与 “{keyword}” 相关的 Logo
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        </>
    );
}
