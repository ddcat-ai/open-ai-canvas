import { useDeferredValue, useMemo, useState, type ComponentType } from "react";
import { Images, Layers, ListChecks, History, PanelLeftClose, PanelLeftOpen, Wrench } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import type { GenerationTask } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasWorkspaceAssetPanel, type LibraryAsset } from "./canvas-workspace-asset-panel";
import { CanvasWorkspaceNodeListPanel } from "./canvas-workspace-node-list-panel";
import { CanvasWorkspaceTaskPanel } from "./canvas-workspace-task-panel";
import { CanvasWorkspaceToolPanel } from "./canvas-workspace-tool-panel";

type CanvasWorkspaceSidebarProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocus: (nodeId: string) => void;
    assets?: LibraryAsset[];
    onInsertAssetImage?: (asset: LibraryAsset) => void;
    onRefreshAssets?: () => void;
    onAssetAction?: (action: "copy" | "download" | "archive" | "delete", asset: LibraryAsset) => void;
    onActiveTabChange?: (tab: RailTab) => void;
    tasks?: GenerationTask[];
    historyTasks?: GenerationTask[];
    tasksRefreshing?: boolean;
    onRefreshTasks?: () => void;
    onCancelTask?: (task: GenerationTask) => void;
};

type RailTab = "nodes" | "assets" | "tools" | "tasks" | "history";

const RAIL_ITEMS: Array<{ id: RailTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: "nodes", label: "节点", icon: Layers },
    { id: "assets", label: "资产", icon: Images },
    { id: "tools", label: "工具", icon: Wrench },
    { id: "tasks", label: "任务", icon: ListChecks },
    { id: "history", label: "历史", icon: History },
];

export function CanvasWorkspaceSidebar({ nodes, selectedNodeIds, onFocus, assets = [], onInsertAssetImage, onRefreshAssets, onAssetAction, onActiveTabChange, tasks = [], historyTasks = [], tasksRefreshing, onRefreshTasks, onCancelTask }: CanvasWorkspaceSidebarProps) {
    const [activeTab, setActiveTab] = useState<RailTab>("nodes");
    const [panelCollapsed, setPanelCollapsed] = useState(false);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));
    const results = useMemo(() => searchCanvasNodes(nodes, deferredQuery), [nodes, deferredQuery]);

    const handleTabChange = (tab: RailTab) => {
        setActiveTab(tab);
        setPanelCollapsed(false);
        onActiveTabChange?.(tab);
    };

    return (
        <div className="canvas-workspace-sidebar relative z-[var(--z-panel)] hidden shrink-0 lg:flex">
            <nav className="canvas-rail" aria-label="画布分区">
                <Link to="/" className="rail-btn tip-right" data-tip="主页" aria-label="主页">
                    <RailHomeIcon />
                    <span className="rail-label">主页</span>
                </Link>
                <button type="button" className="rail-btn" aria-label={panelCollapsed ? "展开侧边栏" : "折叠侧边栏"} title={panelCollapsed ? "展开侧边栏" : "折叠侧边栏"} onClick={() => setPanelCollapsed((value) => !value)}>
                    {panelCollapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
                    <span className="rail-label">折叠</span>
                </button>
                <span className="rail-sep" />
                {RAIL_ITEMS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`rail-btn tip-right${activeTab === item.id ? " on" : ""}`}
                        data-tip={item.label}
                        aria-pressed={activeTab === item.id}
                        onClick={() => handleTabChange(item.id)}
                    >
                        <item.icon className="size-[19px]" />
                        <span className="rail-label">{item.label}</span>
                    </button>
                ))}
                <span className="rail-grow" />
            </nav>
            {!panelCollapsed ? (
                <aside className="canvas-workspace-panel border-r border-border bg-background/94 backdrop-blur-xl">
                    {activeTab === "nodes" ? (
                        <CanvasWorkspaceNodeListPanel
                            nodes={nodes}
                            results={results}
                            query={query}
                            deferredQuery={deferredQuery}
                            selectedNodeIds={selectedNodeIds}
                            onQueryChange={setQuery}
                            onFocus={onFocus}
                        />
                    ) : activeTab === "assets" ? (
                        <CanvasWorkspaceAssetPanel
                            assets={assets}
                            onInsertAssetImage={onInsertAssetImage}
                            onRefresh={onRefreshAssets}
                            onAssetAction={onAssetAction}
                        />
                    ) : activeTab === "tools" ? (
                        <CanvasWorkspaceToolPanel />
                    ) : activeTab === "tasks" ? (
                        <CanvasWorkspaceTaskPanel
                            tasks={tasks}
                            refreshing={tasksRefreshing}
                            onRefresh={onRefreshTasks}
                            onCancelTask={onCancelTask}
                        />
                    ) : activeTab === "history" ? (
                        <CanvasWorkspaceTaskPanel
                            title="历史"
                            tasks={historyTasks}
                            refreshing={tasksRefreshing}
                            onRefresh={onRefreshTasks}
                            onCancelTask={onCancelTask}
                        />
                    ) : (
                        <PlaceholderPanel tab={activeTab} />
                    )}
                </aside>
            ) : null}
        </div>
    );
}

function PlaceholderPanel({ tab }: { tab: RailTab }) {
    const label = RAIL_ITEMS.find((item) => item.id === tab)?.label || "";
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <span className="truncate text-xs font-semibold">{label}</span>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center px-4">
                <WorkspaceState icon="canvas" compact title={`${label}面板`} description="即将上线，敬请期待。" />
            </div>
        </>
    );
}

function RailHomeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    );
}
