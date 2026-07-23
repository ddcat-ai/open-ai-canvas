import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleAlert, FolderKanban } from "lucide-react";
import { Link } from "react-router";

import { getProject } from "@/services/api/projects";

export function CanvasProjectSidebar({ projectId }: { projectId: string }) {
    const [collapsed, setCollapsed] = useState(false);
    const query = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject(projectId), enabled: Boolean(projectId) });
    const workflow = query.data?.workflows?.find((item) => item.instance.scope === "project");
    const failed = workflow?.steps.filter((step) => step.status === "failed") || [];
    if (collapsed) {
        return <aside className="relative z-30 hidden w-12 shrink-0 flex-col items-center border-r border-border bg-background/94 py-3 backdrop-blur-xl lg:flex"><button type="button" className="grid size-8 place-items-center rounded-md text-foreground/60 hover:bg-foreground/[.06]" title="展开项目侧栏" aria-label="展开项目侧栏" onClick={() => setCollapsed(false)}><ChevronRight className="size-4" /></button><Link to={`/projects/${projectId}`} className="mt-3 grid size-8 place-items-center rounded-md text-foreground/65 hover:bg-foreground/[.06]" title="打开项目"><FolderKanban className="size-4" /></Link></aside>;
    }
    return (
        <aside className="relative z-30 hidden w-[248px] shrink-0 flex-col border-r border-border bg-background/94 backdrop-blur-xl lg:flex">
            <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
                <Link to={`/projects/${projectId}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold"><FolderKanban className="size-4 shrink-0" /><span className="truncate">{query.data?.project.name || "项目空间"}</span></Link>
                <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-foreground/55 hover:bg-foreground/[.06]" title="收起项目侧栏" aria-label="收起项目侧栏" onClick={() => setCollapsed(true)}><ChevronLeft className="size-4" /></button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <SidebarTitle>章节</SidebarTitle>
                <div className="mt-2 grid gap-1">
                    {query.data?.units.length ? query.data.units.map((unit) => { const shots = query.data.shots?.filter((shot) => shot.unitId === unit.id) || []; const missing = shots.filter((shot) => !(query.data.shotReferences || []).some((reference) => reference.shotId === shot.id)); return <div key={unit.id}><Link to={`/projects/${projectId}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-xs hover:bg-foreground/[.05]"><span className="min-w-0 truncate">{unit.title}</span><span className="shrink-0 text-[10px] text-foreground/45">{shots.length ? `${shots.length} 镜头` : unit.status === "completed" ? "完成" : "草稿"}</span></Link>{missing.length ? <div className="px-2 pb-1 text-[10px] text-amber-600 dark:text-amber-300">{missing.length} 个镜头缺参考</div> : null}</div>; }) : <div className="px-2 py-3 text-xs text-foreground/40">暂无章节</div>}
                </div>
                {(query.data?.assetCandidates || []).some((candidate) => candidate.status === "pending_confirmation") ? <Link to={`/projects/${projectId}`} className="mt-4 flex items-center justify-between rounded-md border border-amber-500/20 bg-amber-500/[.06] px-2.5 py-2 text-xs text-amber-700 dark:text-amber-200"><span>待确认资产</span><strong>{query.data?.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length}</strong></Link> : null}
                <SidebarTitle className="mt-5">制作流程</SidebarTitle>
                <div className="mt-2 grid gap-1">
                    {workflow?.steps.map((step) => <div key={step.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"><span className="min-w-0 truncate">{step.name}</span><span className={`size-2 shrink-0 rounded-full ${step.status === "completed" ? "bg-emerald-500" : step.status === "failed" ? "bg-red-500" : step.status === "running" ? "bg-blue-500" : "bg-foreground/20"}`} title={step.status} /></div>)}
                </div>
                {failed.length ? <Link to={`/projects/${projectId}`} className="mt-5 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/[.06] px-2.5 py-2 text-xs text-red-600 dark:text-red-300"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span>{failed.length} 个流程阶段失败，打开项目处理</span></Link> : null}
            </div>
        </aside>
    );
}

function SidebarTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`px-2 text-[11px] font-semibold text-foreground/45 ${className}`}>{children}</div>;
}
