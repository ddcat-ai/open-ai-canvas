import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Popconfirm, Select, Tooltip } from "antd";
import { ArrowUpRight, Film, Link2, Unlink, X } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { linkCanvasUnit, unlinkCanvasProject, unlinkCanvasUnit } from "@/services/api/projects";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

import { formatTime, type ProjectDetailViewProps } from "./shared";

export default function ProjectCanvasesView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { message } = App.useApp();
    const [linkingCanvasId, setLinkingCanvasId] = useState("");
    const localCanvases = useCanvasStore((state) => state.projects);
    const linkMutation = useMutation({
        mutationFn: ({ canvasId, unitId }: { canvasId: string; unitId: string }) => linkCanvasUnit(detail.project.id, { canvasId, unitId, role: "storyboard" }),
        onSuccess: () => { setLinkingCanvasId(""); refreshProject(); message.success("画布已关联章节"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "画布关联失败"),
    });
    const unlinkUnitMutation = useMutation({
        mutationFn: ({ canvasId, unitId }: { canvasId: string; unitId: string }) => unlinkCanvasUnit(detail.project.id, canvasId, unitId),
        onSuccess: () => { refreshProject(); message.success("已解除章节关联"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "解除章节关联失败"),
    });
    const unlinkProjectMutation = useMutation({
        mutationFn: (canvasId: string) => unlinkCanvasProject(detail.project.id, canvasId),
        onSuccess: (_, canvasId) => {
            // 服务端解除后立即同步本地画布归属，避免后续自动保存把旧关系重新写回。
            useCanvasStore.getState().updateProject(canvasId, { projectId: undefined });
            refreshProject();
            message.success("已解除项目关系，画布文档仍保留在创作画布中");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "解除项目关系失败"),
    });
    const linksByCanvas = useMemo(() => detail.canvasUnitLinks.reduce<Record<string, typeof detail.canvasUnitLinks>>((result, link) => { (result[link.canvasId] ||= []).push(link); return result; }, {}), [detail.canvasUnitLinks]);
    const canvases = useMemo(() => detail.canvases.map((canvas) => {
        const local = localCanvases.find((item) => item.id === canvas.id && item.projectId === detail.project.id);
        if (!local || Date.parse(local.updatedAt) < Date.parse(canvas.updatedAt)) return canvas;
        return { ...canvas, title: local.title, updatedAt: local.updatedAt };
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [detail.canvases, detail.project.id, localCanvases]);

    return (
        <div>
            {canvases.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,360px))] justify-start gap-3">
                    {canvases.map((canvas, index) => {
                        const links = linksByCanvas[canvas.id] || [];
                        const linkedUnits = links.map((link) => detail.units.find((unit) => unit.id === link.unitId)).filter(Boolean);
                        const unlinkedUnits = detail.units.filter((unit) => !links.some((link) => link.unitId === unit.id));
                        return (
                            <article key={canvas.id} className="min-w-0 overflow-hidden rounded-lg border border-border/80 bg-background">
                                <Link to={`/canvas/${canvas.id}`} className="group relative block h-24 overflow-hidden border-b border-border/70 bg-[#111827] p-3 text-white">
                                    <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                                    <div className="relative flex h-full flex-col justify-between"><div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[var(--fs-tiny)] text-white/55"><Film className="size-3" />画布 {String(index + 1).padStart(2, "0")}</span><ArrowUpRight className="size-3.5 text-white/45 group-hover:text-[var(--workspace-accent)]" /></div><div><div className="truncate text-[var(--fs-body)] font-semibold">{canvas.title}</div><div className="mt-0.5 text-[var(--fs-micro)] text-white/48">更新于 {formatTime(canvas.updatedAt)}</div></div></div>
                                </Link>
                                <div className="p-2.5">
                                    <div className="flex items-center justify-between"><span className="text-[var(--fs-tiny)] font-medium text-foreground/48">关联章节</span><span className="text-[var(--fs-micro)] tabular-nums text-foreground/38">{linkedUnits.length} 个</span></div>
                                    <div className="mt-1.5 flex min-h-6 max-h-12 flex-wrap gap-1 overflow-y-auto">
                                        {linkedUnits.length ? linkedUnits.map((unit) => (
                                            <span key={unit!.id} className="inline-flex h-5 max-w-full items-center gap-1 rounded bg-[var(--workspace-accent-soft)] pl-1.5 pr-0.5 text-[var(--fs-micro)] text-[var(--workspace-accent)]"><span className="truncate">{String(unit!.position + 1).padStart(2, "0")} · {unit!.title}</span><Tooltip title="解除章节关联"><button type="button" className="grid size-4 shrink-0 place-items-center rounded hover:bg-foreground/[.07]" aria-label={`解除${unit!.title}关联`} onClick={() => unlinkUnitMutation.mutate({ canvasId: canvas.id, unitId: unit!.id })}><X className="size-3" /></button></Tooltip></span>
                                        )) : <span className="py-0.5 text-[var(--fs-tiny)] text-foreground/38">尚未关联章节</span>}
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/60 pt-2">
                                        <Select size="small" className="min-w-0 flex-1" placeholder={unlinkedUnits.length ? "关联更多章节" : "全部章节已关联"} disabled={!unlinkedUnits.length} options={unlinkedUnits.map((unit) => ({ label: `${String(unit.position + 1).padStart(2, "0")} · ${unit.title}`, value: unit.id }))} onChange={(unitId) => { setLinkingCanvasId(canvas.id); linkMutation.mutate({ canvasId: canvas.id, unitId }); }} loading={linkMutation.isPending && linkingCanvasId === canvas.id} suffixIcon={<Link2 className="size-3.5" />} />
                                        <Popconfirm title="解除画布与项目的关系？" description="画布文档不会删除，之后仍可在“画布”中打开。" okText="解除关系" cancelText="取消" okButtonProps={{ danger: true, loading: unlinkProjectMutation.isPending }} onConfirm={() => unlinkProjectMutation.mutate(canvas.id)}>
                                            <Tooltip title="解除项目关系"><Button size="small" type="text" danger icon={<Unlink className="size-3.5" />} aria-label="解除项目关系" /></Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : <WorkspaceState icon="canvas" title="还没有项目画布" description="使用右上角的新建画布开始创作。" />}
        </div>
    );
}
