import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty } from "antd";
import { Link } from "react-router";

import { saveProjectShot, type ProjectDetail } from "@/services/api/projects";

import { AssetsStage, DeliveryStage, StoryStage } from "./workflow-stage-views";
import { type ShortDramaWorkflowStage, workflowStages } from "./workflow-shared";
import "./workflow.css";

const WorkflowProductionWorkbench = lazy(() => import("./workflow-production-workbench"));

type Props = {
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    stage: string;
};

export default function ProjectWorkflowView({ detail, projectId, unitId, stage }: Props) {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const orderedUnits = useMemo(() => detail.units.slice().sort((left, right) => left.position - right.position), [detail.units]);
    const unit = orderedUnits.find((item) => item.id === unitId) || orderedUnits[0];
    const activeStage = workflowStages.some((item) => item.key === stage) ? stage as ShortDramaWorkflowStage : "video";
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unit?.id).slice().sort((left, right) => left.position - right.position), [detail.shots, unit?.id]);
    const workflow = useMemo(() => (detail.workflows || []).find((item) => item.instance?.unitId === unit?.id && (item.steps || []).some((step) => step.stepKey === "previz")), [detail.workflows, unit?.id]);
    const rememberedShotId = sessionStorage.getItem(`project-workflow-selected-shot:${projectId}`) || "";
    const [selectedShotId, setSelectedShotId] = useState(rememberedShotId);
    const selectedShot = shots.find((item) => item.id === selectedShotId) || shots[0];
    const activeStep = workflow?.steps?.find((item) => item.stepKey === activeStage);
    const productionStage = activeStage === "storyboard" || activeStage === "previz" || activeStage === "video";

    useEffect(() => {
        if (!selectedShot) return;
        if (selectedShot.id !== selectedShotId) setSelectedShotId(selectedShot.id);
        sessionStorage.setItem(`project-workflow-selected-shot:${projectId}`, selectedShot.id);
    }, [projectId, selectedShot, selectedShotId]);

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
    };
    const addShot = useMutation({
        mutationFn: () => {
            if (!unit) throw new Error("请先添加章节");
            return saveProjectShot(projectId, {
                unitId: unit.id,
                title: `SC.${String(shots.length + 1).padStart(2, "0")}`,
                description: "待补充分镜画面",
                position: shots.length,
                durationMs: 3000,
                revision: { plotDescription: "待补充分镜画面", durationMs: 3000 },
            });
        },
        onSuccess: async ({ shot }) => {
            setSelectedShotId(shot.id);
            sessionStorage.setItem(`project-workflow-selected-shot:${projectId}`, shot.id);
            await refresh();
            message.success("已新增分镜");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "新增分镜失败"),
    });
    if (!unit) {
        return <div className="grid h-full place-items-center"><Empty description="先添加一个章节，再进入分镜制作"><Link to={`/projects/${projectId}/chapters`}><Button type="primary">添加章节</Button></Link></Empty></div>;
    }

    return (
        <div className="workflow-page-root">
            <main className={`workflow-stage-content ${productionStage ? "is-production" : ""}`}>
                {activeStage === "story" ? <div className="workflow-overview-scroll thin-scrollbar"><StoryStage detail={detail} projectId={projectId} unitId={unit.id} /></div> : null}
                {activeStage === "assets" ? <div className="workflow-overview-scroll thin-scrollbar"><AssetsStage detail={detail} projectId={projectId} unitId={unit.id} /></div> : null}
                {productionStage ? <Suspense fallback={<div className="workflow-workbench-loading">正在准备分镜工作台…</div>}><WorkflowProductionWorkbench activeStage={activeStage} detail={detail} projectId={projectId} unitId={unit.id} workflowStep={activeStep} selectedShot={selectedShot} onSelectShot={setSelectedShotId} onRefresh={refresh} onAddShot={() => addShot.mutate()} addingShot={addShot.isPending} /></Suspense> : null}
                {activeStage === "delivery" ? <div className="workflow-overview-scroll thin-scrollbar"><DeliveryStage detail={detail} unitId={unit.id} /></div> : null}
            </main>
        </div>
    );
}
