import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasAssetGroup } from "@/lib/canvas/canvas-asset-catalog";
import type { CanvasNodeData } from "@/types/canvas";

import { canvasAssetKindIcon, CanvasAssetThumbnail } from "./canvas-asset-preview";

export const ASSET_TREE_KIND_PREFIX = "kind:";
export const ASSET_TREE_ASSET_PREFIX = "asset:";
export const ASSET_TREE_VERSION_PREFIX = "version:";

type TreeRow = {
    key: string;
    level: 1 | 2 | 3;
    label: string;
    count?: number;
    icon: ReactNode;
    expandable: boolean;
    expanded: boolean;
    muted: boolean;
    primary?: boolean;
    parentKey?: string;
};

type CanvasAssetTreeProps = {
    groups: CanvasAssetGroup[];
    nodeById: Map<string, CanvasNodeData>;
    selectedKey: string;
    expandedKeys: Set<string>;
    onSelect: (key: string) => void;
    onToggle: (key: string, expanded: boolean) => void;
};

/**
 * 资产目录树：类型 → 资产 → 版本。自绘而不是用 AntD Tree，便于和画布浮层的密度、缩略图保持一致；
 * 键盘交互按 WAI-ARIA tree 模式实现（上下移动、左右折叠展开、Enter/空格选中）。
 */
export function CanvasAssetTree({ groups, nodeById, selectedKey, expandedKeys, onSelect, onToggle }: CanvasAssetTreeProps) {
    const { t } = useTranslation();
    const rows = useMemo(() => flattenRows(groups, nodeById, expandedKeys), [expandedKeys, groups, nodeById]);
    const [focusedKey, setFocusedKey] = useState("");
    const rowRefs = useRef(new Map<string, HTMLDivElement>());
    const activeKey = rows.some((row) => row.key === focusedKey) ? focusedKey : rows.some((row) => row.key === selectedKey) ? selectedKey : rows[0]?.key;

    const focusRow = (key: string | undefined) => {
        if (!key) return;
        setFocusedKey(key);
        rowRefs.current.get(key)?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: TreeRow, index: number) => {
        if (event.key === "ArrowDown") focusRow(rows[index + 1]?.key);
        else if (event.key === "ArrowUp") focusRow(rows[index - 1]?.key);
        else if (event.key === "Home") focusRow(rows[0]?.key);
        else if (event.key === "End") focusRow(rows[rows.length - 1]?.key);
        else if (event.key === "ArrowRight") {
            if (row.expandable && !row.expanded) onToggle(row.key, true);
            else if (row.expandable) focusRow(rows[index + 1]?.key);
        } else if (event.key === "ArrowLeft") {
            if (row.expandable && row.expanded) onToggle(row.key, false);
            else focusRow(row.parentKey);
        } else if (event.key === "Enter" || event.key === " ") onSelect(row.key);
        else return;
        event.preventDefault();
    };

    return (
        <div role="tree" aria-label={t("canvasA.assetTree.label")} className="flex flex-col gap-px">
            {rows.map((row, index) => {
                const selected = row.key === selectedKey;
                return (
                    <div
                        key={row.key}
                        ref={(element) => {
                            if (element) rowRefs.current.set(row.key, element);
                            else rowRefs.current.delete(row.key);
                        }}
                        role="treeitem"
                        aria-level={row.level}
                        aria-selected={selected}
                        aria-expanded={row.expandable ? row.expanded : undefined}
                        tabIndex={row.key === activeKey ? 0 : -1}
                        className={`group flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[var(--r-md)] pr-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/30 ${selected ? "bg-foreground/10 text-foreground" : "hover:bg-foreground/[.05]"} ${row.muted && !selected ? "text-muted-foreground" : ""} ${row.level === 1 ? "mt-1 font-medium first:mt-0" : ""}`}
                        style={{ paddingLeft: 4 + (row.level - 1) * 16 }}
                        onClick={() => {
                            setFocusedKey(row.key);
                            onSelect(row.key);
                        }}
                        onKeyDown={(event) => handleKeyDown(event, row, index)}
                    >
                        <span
                            className="grid size-5 shrink-0 place-items-center rounded-[var(--r-sm)] text-muted-foreground hover:text-foreground"
                            aria-hidden="true"
                            onClick={(event) => {
                                if (!row.expandable) return;
                                event.stopPropagation();
                                onToggle(row.key, !row.expanded);
                            }}
                        >
                            {row.expandable ? <ChevronRight className={`size-3.5 transition-transform motion-reduce:transition-none ${row.expanded ? "rotate-90" : ""}`} /> : null}
                        </span>
                        <span className={`grid shrink-0 place-items-center ${selected ? "text-foreground" : "text-muted-foreground"}`}>{row.icon}</span>
                        <span className="min-w-0 flex-1 truncate" title={row.label}>
                            {row.label}
                        </span>
                        {row.primary ? <Star className="size-3 shrink-0 fill-current text-foreground" aria-label={t("canvasA.assetTree.primaryVersion")} /> : null}
                        {row.count !== undefined ? <span className={`shrink-0 text-[11px] tabular-nums ${selected ? "text-foreground/70" : "text-muted-foreground/80"}`}>{row.count}</span> : null}
                    </div>
                );
            })}
        </div>
    );
}

function flattenRows(groups: CanvasAssetGroup[], nodeById: Map<string, CanvasNodeData>, expandedKeys: Set<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    for (const group of groups) {
        const kindKey = `${ASSET_TREE_KIND_PREFIX}${group.kind}`;
        const kindExpanded = expandedKeys.has(kindKey) && group.entries.length > 0;
        rows.push({ key: kindKey, level: 1, label: group.label, count: group.entries.length, icon: canvasAssetKindIcon(group.kind), expandable: group.entries.length > 0, expanded: kindExpanded, muted: !group.entries.length });
        if (!kindExpanded) continue;
        for (const entry of group.entries) {
            const assetKey = `${ASSET_TREE_ASSET_PREFIX}${entry.key}`;
            const hasVersions = entry.versions.length > 1;
            const assetExpanded = hasVersions && expandedKeys.has(assetKey);
            const node = nodeById.get(entry.nodeId);
            rows.push({
                key: assetKey,
                level: 2,
                label: entry.title,
                count: hasVersions ? entry.versions.length : undefined,
                icon:
                    node && (entry.kind === "image" || entry.kind === "video") ? (
                        <span className="block size-5 overflow-hidden rounded-[var(--r-sm)] bg-foreground/[.06]">
                            <CanvasAssetThumbnail node={node} kind={entry.kind} iconClassName="size-3" />
                        </span>
                    ) : (
                        canvasAssetKindIcon(entry.kind, "size-3.5")
                    ),
                expandable: hasVersions,
                expanded: assetExpanded,
                muted: false,
                parentKey: kindKey,
            });
            if (!assetExpanded) continue;
            for (const version of entry.versions) {
                rows.push({
                    key: `${ASSET_TREE_VERSION_PREFIX}${entry.key}|${version.key}`,
                    level: 3,
                    label: version.label,
                    icon: <span className={`block size-1.5 rounded-full ${version.primary ? "bg-foreground" : "bg-muted-foreground/50"}`} />,
                    expandable: false,
                    expanded: false,
                    muted: !version.primary,
                    primary: version.primary,
                    parentKey: assetKey,
                });
            }
        }
    }
    return rows;
}
