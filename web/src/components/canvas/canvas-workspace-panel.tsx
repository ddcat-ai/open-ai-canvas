import { Link } from "react-router";
import { CanvasWorkspaceAssetPanel } from "./canvas-workspace-asset-panel";
import { CanvasWorkspaceHistoryPanel } from "./canvas-workspace-history-panel";
import type { InsertAssetPayload } from "./asset-picker-modal";
import { useDeferredValue, useState } from "react";
import { Button, Grid } from "antd";
import { Home, PanelLeftClose, PanelLeftOpen, Layers, Images, ListChecks, History, X } from "lucide-react";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import { useCanvasWorkspaceTasks } from "@/pages/canvas/use-canvas-workspace-tasks";
import { CanvasWorkspaceNodeListPanel } from "./canvas-workspace-node-list-panel";
import { CanvasWorkspaceTaskPanel } from "./canvas-workspace-task-panel";
import "./canvas-workspace-panel.css";

export function CanvasWorkspacePanel({
    projectId,
    nodes,
    selectedNodeIds,
    onClose,
    open,
    onOpen,
    onInsertAssets,
    onFocus,
    onAssets,
    onProjectAssets,
    onCancelTask,
}: {
    projectId: string;
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onClose: () => void;
    open: boolean;
    onOpen: () => void;
    onInsertAssets: (payloads: InsertAssetPayload[]) => Promise<unknown>;
    onFocus: (id: string) => void;
    onAssets: () => void;
    onProjectAssets?: () => void;
    onCancelTask: (task: GenerationTask) => void;
}) {
    const [tab, setTab] = useState("nodes");
    const theme = canvasThemes[useActiveTheme()];
    const [query, setQuery] = useState("");
    const history = tab === "history";
    const deferredQuery = useDeferredValue(query);
    const config = useEffectiveConfig();
    const screens = Grid.useBreakpoint();
    const tasks = useCanvasWorkspaceTasks(projectId, open && (tab === "tasks" || history));
    const content = (
        <div className="canvas-workspace-panel flex h-full min-h-0 flex-col bg-background text-foreground" data-canvas-no-zoom data-canvas-wheel-scroll onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-border p-3">
                <strong>工作区</strong>
                <button aria-label="关闭工作区" onClick={onClose}>
                    <X className="size-4" />
                </button>
            </header>
            {tab === "nodes" && (
                <CanvasWorkspaceNodeListPanel nodes={nodes} config={config} results={searchCanvasNodes(nodes, deferredQuery, nodes.length, config)} query={query} deferredQuery={deferredQuery} selectedNodeIds={selectedNodeIds} onQueryChange={setQuery} onFocus={onFocus} />
            )}
            {tab === "assets" && <CanvasWorkspaceAssetPanel onInsert={onInsertAssets} onManage={onAssets} onProjectAssets={onProjectAssets} />}
            {(tab === "tasks" || history) && (
                <>
                    {tasks.error ? (
                        <div role="alert" className="p-4">
                            任务加载失败。<Button onClick={() => void tasks.refetch()}>重试</Button>
                        </div>
                    ) : tasks.loading ? (
                        <p className="p-4">正在加载任务…</p>
                    ) : history ? (
                        <CanvasWorkspaceHistoryPanel tasks={tasks.allTasks} refreshing={tasks.refreshing} onRefresh={() => void tasks.refetch()} onCancelTask={onCancelTask} />
                    ) : (
                        <CanvasWorkspaceTaskPanel
                            tasks={history ? tasks.allTasks : tasks.tasks.filter((t) => t.status === "queued" || t.status === "running")}
                            refreshing={tasks.refreshing}
                            onRefresh={() => void tasks.refetch()}
                            onCancelTask={onCancelTask}
                        />
                    )}
                </>
            )}
        </div>
    );
    const entries = [
        { id: "nodes", label: "节点", icon: Layers },
        { id: "assets", label: "资产", icon: Images },
        { id: "tasks", label: "任务", icon: ListChecks },
        { id: "history", label: "历史", icon: History },
    ];
    return (
        <>
            <nav className="canvas-workspace-rail" style={{ ...canvasDockStyle(theme), boxShadow: "none" }} aria-label="画布左侧菜单" data-canvas-no-zoom onWheel={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Link to="/" className="canvas-workspace-rail-button" aria-label="主页" title="返回主页">
                    <Home />
                    <span>主页</span>
                </Link>
                <div className="canvas-workspace-rail-divider" aria-hidden="true" />
                <div className="canvas-workspace-rail-items">
                    {entries.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            className="canvas-workspace-rail-button"
                            title={open && tab === id ? `收起${label}` : `打开${label}`}
                            aria-pressed={open && tab === id}
                            onClick={() => {
                                if (open && tab === id) onClose();
                                else {
                                    setTab(id);
                                    onOpen();
                                }
                            }}
                        >
                            <Icon />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
                <button
                    className="canvas-workspace-rail-button canvas-workspace-rail-toggle"
                    type="button"
                    onClick={open ? onClose : onOpen}
                    aria-expanded={open}
                    aria-label={open ? "折叠面板" : "展开面板"}
                    title={open ? "收起面板，扩大画布" : "展开工作区面板"}
                >
                    {open ? <PanelLeftClose /> : <PanelLeftOpen />}
                    <span>{open ? "收起" : "展开"}</span>
                </button>
            </nav>
            {open &&
                (screens.lg ? (
                    <aside className="w-80 shrink-0 border-r border-border min-h-0" aria-label="画布工作区">
                        {content}
                    </aside>
                ) : (
                    <AppDrawer flush open placement="left" title={null} closable={false} size={320} onClose={onClose}>
                        {content}
                    </AppDrawer>
                ))}
        </>
    );
}
