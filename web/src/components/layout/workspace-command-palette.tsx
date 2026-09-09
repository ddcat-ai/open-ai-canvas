import { Command, Home, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router";

import { navigationTools } from "@/constant/navigation-tools";
import { Kbd } from "@/components/ui/base/kbd";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";

type PaletteEntry = {
    id: string;
    title: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }>;
    to: string;
};

/** 顶栏搜索 / ⌘K 命令面板：按功能开关过滤当前可用页面入口。 */
export function WorkspaceCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
    const navigate = useNavigate();
    const features = useUserStore((state) => state.features);
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const entries = useMemo<PaletteEntry[]>(() => {
        const toolEntry = (slug: string, to: string): PaletteEntry => {
            const tool = navigationTools.find((item) => item.slug === slug);
            return { id: slug, title: tool?.label ?? slug, icon: tool?.icon ?? Home, to };
        };
        return [
            { id: "home", title: "首页", icon: Home, to: "/" },
toolEntry("projects", "/projects"),
            toolEntry("canvas", "/canvas"),
            ...(features.taskCenterEnabled ? [toolEntry("tasks", "/tasks")] : []),
            toolEntry("assets", "/assets"),
            toolEntry("skills", "/skills"),
            ...(features.creditsEnabled ? [toolEntry("wallet", "/wallet")] : []),
            toolEntry("settings", "/settings"),
        ];
    }, [features]);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return entries;
        return entries.filter((entry) => entry.title.toLowerCase().includes(keyword));
    }, [entries, query]);

    useEffect(() => {
        if (open) {
            setQuery("");
            window.setTimeout(() => inputRef.current?.focus(), 20);
        }
    }, [open]);

    useEffect(() => {
        setHighlight(0);
    }, [filtered.length, open]);

    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((index) => Math.max(index - 1, 0));
                return;
            }
            if (event.key === "Enter" && filtered[highlight]) {
                event.preventDefault();
                const target = filtered[highlight];
                onClose();
                navigate(target.to);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, filtered, highlight, navigate, onClose]);

    if (!open) return null;

    return (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-background/40 px-4 pt-28 backdrop-blur-sm lg:pt-32">
            <div className="absolute inset-0" onClick={onClose} />
            <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-surface-strong)] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="p-3 pb-2">
                    <div className="flex h-10 items-center gap-2 rounded-[var(--r-md)] border border-[var(--workspace-border)] bg-foreground/5 px-3 transition-colors hover:border-[var(--workspace-border-strong)] focus-within:border-[var(--workspace-border-strong)] focus-within:bg-foreground/[.06]">
                        <Search className="size-4 shrink-0 text-foreground/45" strokeWidth={1.6} />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="min-w-0 flex-1 bg-transparent text-[var(--fs-body)] outline-none placeholder:text-foreground/45"
                            placeholder="搜索页面或操作…"
                        />
                        <Kbd onClick={onClose} className="hidden shrink-0 cursor-pointer transition-colors hover:bg-surface-hover hover:text-foreground sm:inline-flex">
                            ⌘K
                        </Kbd>
                        <button
                            type="button"
                            onClick={onClose}
                            className="ml-0.5 shrink-0 rounded-md p-1 text-foreground/50 transition-colors hover:bg-surface-hover hover:text-foreground"
                            aria-label="关闭搜索"
                        >
                            <X className="size-4" strokeWidth={1.6} />
                        </button>
                    </div>
                </div>

                <div className="max-h-80 overflow-y-auto p-2">
                    {filtered.length ? (
                        <ul className="flex flex-col gap-0.5">
                            {filtered.map((entry, index) => {
                                const Icon = entry.icon;
                                return (
                                    <li key={entry.id}>
                                        <button
                                            type="button"
                                            onMouseEnter={() => setHighlight(index)}
                                            onClick={() => {
                                                onClose();
                                                navigate(entry.to);
                                            }}
                                            className={cn(
                                                "flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-3 py-2.5 text-left text-[var(--fs-body)] transition-colors",
                                                index === highlight ? "bg-surface-hover text-foreground" : "text-foreground/65",
                                            )}
                                        >
                                            <Icon className={cn("size-4 shrink-0", index === highlight ? "text-foreground" : "text-foreground/55")} strokeWidth={1.6} />
                                            <span className="truncate">{entry.title}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Command className="mb-2 size-6 text-foreground/30" strokeWidth={1.5} />
                            <p className="text-[var(--fs-caption)] font-medium text-foreground/55">未找到「{query}」相关页面</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
