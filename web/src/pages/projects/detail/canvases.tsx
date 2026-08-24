import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Popconfirm, Select, Tooltip } from "antd";
import { Link2, Unlink, X } from "lucide-react";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { linkCanvasUnit, unlinkCanvasProject, unlinkCanvasUnit } from "@/services/api/projects";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

import { type ProjectDetailViewProps } from "./shared";
import { useTranslation } from "react-i18next";

export default function ProjectCanvasesView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { t } = useTranslation("project");
    const { message } = App.useApp();
    const [linkingCanvasId, setLinkingCanvasId] = useState("");
    const localCanvases = useCanvasStore((state) => state.projects);
    const linkMutation = useMutation({
        mutationFn: ({ canvasId, unitId }: { canvasId: string; unitId: string }) => linkCanvasUnit(detail.project.id, { canvasId, unitId, role: "storyboard" }),
        onSuccess: () => {
            setLinkingCanvasId("");
            refreshProject();
            message.success(t("project:canvas-linked-to-chapter"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-link-canvas")),
    });
    const unlinkUnitMutation = useMutation({
        mutationFn: ({ canvasId, unitId }: { canvasId: string; unitId: string }) => unlinkCanvasUnit(detail.project.id, canvasId, unitId),
        onSuccess: () => {
            refreshProject();
            message.success(t("project:chapter-link-removed"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-unlink-chapter")),
    });
    const unlinkProjectMutation = useMutation({
        mutationFn: (canvasId: string) => unlinkCanvasProject(detail.project.id, canvasId),
        onSuccess: (_, canvasId) => {
            // 服务端解除后立即同步本地画布归属，避免后续自动保存把旧关系重新写回。
            useCanvasStore.getState().updateProject(canvasId, { projectId: undefined });
            refreshProject();
            message.success(t("project:project-link-removed-the-canvas-document-remains-in-canvas"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-remove-project-link")),
    });
    const linksByCanvas = useMemo(
        () =>
            detail.canvasUnitLinks.reduce<Record<string, typeof detail.canvasUnitLinks>>((result, link) => {
                (result[link.canvasId] ||= []).push(link);
                return result;
            }, {}),
        [detail.canvasUnitLinks],
    );
    const canvases = useMemo(
        () =>
            detail.canvases
                .map((canvas) => {
                    const local = localCanvases.find((item) => item.id === canvas.id && item.projectId === detail.project.id);
                    if (!local || Date.parse(local.updatedAt) < Date.parse(canvas.updatedAt)) return canvas;
                    return { ...canvas, title: local.title, updatedAt: local.updatedAt };
                })
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        [detail.canvases, detail.project.id, localCanvases],
    );

    return (
        <div>
            {canvases.length ? (
                <div className="project-library-grid library-grid">
                    {canvases.map((canvas) => {
                        const links = linksByCanvas[canvas.id] || [];
                        const linkedUnits = links.map((link) => detail.units.find((unit) => unit.id === link.unitId)).filter(Boolean);
                        const unlinkedUnits = detail.units.filter((unit) => !links.some((link) => link.unitId === unit.id));
                        const project = toCanvasProject(
                            canvas,
                            detail.project.id,
                            localCanvases.find((item) => item.id === canvas.id),
                        );
                        return (
                            <CanvasProjectCard
                                key={canvas.id}
                                project={project}
                                projectName={detail.project.name}
                                readOnly
                                footer={
                                    <div className="border-t border-border/60 pt-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[var(--fs-tiny)] font-medium text-foreground/48">{t("project:link-chapters")}</span>
                                            <span className="text-[var(--fs-micro)] tabular-nums text-foreground/38">
                                                {linkedUnits.length} {t("project:total")}
                                            </span>
                                        </div>
                                        <div className="mt-1.5 flex min-h-6 max-h-12 flex-wrap gap-1 overflow-y-auto">
                                            {linkedUnits.length ? (
                                                linkedUnits.map((unit) => (
                                                    <span key={unit!.id} className="inline-flex h-5 max-w-full items-center gap-1 rounded bg-[var(--workspace-accent-soft)] pl-1.5 pr-0.5 text-[var(--fs-micro)] text-[var(--workspace-accent)]">
                                                        <span className="truncate">
                                                            {String(unit!.position + 1).padStart(2, "0")} · {unit!.title}
                                                        </span>
                                                        <Tooltip title={t("project:unlink-chapter")}>
                                                            <button
                                                                type="button"
                                                                className="grid size-4 shrink-0 place-items-center rounded hover:bg-surface-hover"
                                                                aria-label={t("project:unlink-param", { title: unit!.title })}
                                                                onClick={() => unlinkUnitMutation.mutate({ canvasId: canvas.id, unitId: unit!.id })}
                                                            >
                                                                <X className="size-3" />
                                                            </button>
                                                        </Tooltip>
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="py-0.5 text-[var(--fs-tiny)] text-foreground/38">{t("project:no-chapters-linked-yet")}</span>
                                            )}
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            <Select
                                                size="small"
                                                className="min-w-0 flex-1"
                                                placeholder={unlinkedUnits.length ? t("project:link-more-chapters") : t("project:all-chapters-are-linked")}
                                                disabled={!unlinkedUnits.length}
                                                options={unlinkedUnits.map((unit) => ({ label: `${String(unit.position + 1).padStart(2, "0")} · ${unit.title}`, value: unit.id }))}
                                                onChange={(unitId) => {
                                                    setLinkingCanvasId(canvas.id);
                                                    linkMutation.mutate({ canvasId: canvas.id, unitId });
                                                }}
                                                loading={linkMutation.isPending && linkingCanvasId === canvas.id}
                                                suffixIcon={<Link2 className="size-3.5" />}
                                            />
                                            <Popconfirm
                                                title={t("project:remove-this-canvas-from-the-project")}
                                                description={t("project:the-canvas-document-is-not-deleted-and-stays-available-under-canvas")}
                                                okText={t("project:remove-link")}
                                                cancelText={t("project:cancel-4")}
                                                okButtonProps={{ danger: true, loading: unlinkProjectMutation.isPending }}
                                                onConfirm={() => unlinkProjectMutation.mutate(canvas.id)}
                                            >
                                                <Tooltip title={t("project:remove-project-link")}>
                                                    <Button size="small" type="text" danger icon={<Unlink className="size-3.5" />} aria-label={t("project:remove-project-link")} />
                                                </Tooltip>
                                            </Popconfirm>
                                        </div>
                                    </div>
                                }
                            />
                        );
                    })}
                </div>
            ) : (
                <WorkspaceState icon="canvas" title={t("project:no-project-canvases-yet")} description={t("project:use-new-canvas-at-the-top-right-to-start-creating")} />
            )}
        </div>
    );
}

function toCanvasProject(canvas: { id: string; title: string; createdAt: string; updatedAt: string }, projectId: string, local?: CanvasProject): CanvasProject {
    if (local) return { ...local, title: canvas.title || local.title, updatedAt: canvas.updatedAt || local.updatedAt };
    return {
        id: canvas.id,
        projectId,
        title: canvas.title,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: true,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}
