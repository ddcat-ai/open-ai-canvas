import type { ProjectDetail, ProjectSummary, ProjectUnit } from "@/services/api/projects";

export type ProjectActionTone = "default" | "attention" | "danger";

export type ProjectWorkbenchAction = {
    id: string;
    title: string;
    description: string;
    href: string;
    actionLabel: string;
    tone: ProjectActionTone;
};

export type ProjectContinueTarget = {
    href: string;
    title: string;
    context: string;
    updatedAt: string;
};

export type ProjectStageCell = {
    label: string;
    state: "idle" | "active" | "attention" | "completed";
};

export type ProjectUnitStage = {
    unit: ProjectUnit;
    content: ProjectStageCell;
    assets: ProjectStageCell;
    storyboard: ProjectStageCell;
    canvas: ProjectStageCell;
};

export function projectSummaryCompletion(summary: ProjectSummary) {
    return summary.unitCount ? Math.round((summary.completedUnitCount / summary.unitCount) * 100) : 0;
}

export function projectSummaryStage(summary: ProjectSummary) {
    if (summary.project.status === "archived") return { label: "已归档", detail: "可在项目设置中恢复" };
    if (!summary.unitCount) return { label: "准备故事", detail: "还没有剧情章节" };
    if (summary.completedUnitCount === summary.unitCount) return { label: "章节已完成", detail: "可继续检查镜头与交付结果" };
    if (!summary.canvasCount) return { label: "组织章节", detail: "下一步可建立项目画布" };
    if (!summary.assetCount) return { label: "准备资产", detail: "补充角色、场景或画风" };
    return { label: "制作中", detail: `${summary.completedUnitCount}/${summary.unitCount} 章已完成` };
}

export function projectDetailStage(detail: ProjectDetail) {
    if (detail.project.status === "archived") return { label: "已归档", detail: "恢复项目后可继续制作" };
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    if (failedSteps) return { label: "需要处理", detail: `${failedSteps} 个流程步骤失败` };
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    if (pendingCandidates) return { label: "资产确认", detail: `${pendingCandidates} 个候选待确认` };
    if (!detail.units.length) return { label: "准备故事", detail: "添加或导入剧情章节" };
    if (!detail.shots.length) return { label: "分镜准备", detail: "选择章节生成镜头" };
    const runningSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "running" || step.status === "review").length;
    if (runningSteps) return { label: "制作中", detail: `${runningSteps} 个流程步骤正在推进` };
    const completedUnits = detail.units.filter((unit) => unit.status === "completed").length;
    if (completedUnits === detail.units.length) return { label: "检查交付", detail: "章节已完成，可检查镜头与结果" };
    return { label: "镜头制作", detail: `${detail.shots.length} 个镜头已建立` };
}

export function projectAttentionCount(detail: ProjectDetail) {
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    return pendingCandidates + failedSteps;
}

export function projectContinueTarget(detail: ProjectDetail): ProjectContinueTarget {
    const latestCanvas = [...detail.canvases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestUnit = [...detail.units].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (latestCanvas && (!latestUnit || latestCanvas.updatedAt >= latestUnit.updatedAt)) {
        return {
            href: `/canvas/${latestCanvas.id}`,
            title: latestCanvas.title,
            context: "继续编辑项目画布",
            updatedAt: latestCanvas.updatedAt,
        };
    }
    if (latestUnit) {
        return {
            href: `/projects/${detail.project.id}/chapters/${latestUnit.id}`,
            title: latestUnit.title,
            context: "继续处理剧情章节",
            updatedAt: latestUnit.updatedAt,
        };
    }
    return {
        href: `/projects/${detail.project.id}/chapters`,
        title: detail.project.name,
        context: "从剧情章节开始",
        updatedAt: detail.project.updatedAt,
    };
}

// 项目概览必须把真实阻塞转成动作；没有事实依据时只提示通用的制作下一步。
export function projectNextActions(detail: ProjectDetail, limit = 4): ProjectWorkbenchAction[] {
    const actions: ProjectWorkbenchAction[] = [];
    const projectRoot = `/projects/${detail.project.id}`;
    if (detail.project.status === "archived") {
        return [{
            id: "restore-project",
            title: "项目已归档",
            description: "恢复后才能创建画布和提交生成任务。",
            href: `${projectRoot}/settings`,
            actionLabel: "前往恢复",
            tone: "attention",
        }];
    }

    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed");
    if (failedSteps.length) {
        actions.push({
            id: "failed-steps",
            title: `处理 ${failedSteps.length} 个失败步骤`,
            description: failedSteps[0].error?.trim() || "查看失败原因和输入后，仅重试受影响的任务。",
            href: "/tasks?status=failed",
            actionLabel: "查看失败任务",
            tone: "danger",
        });
    }

    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    if (pendingCandidates.length) {
        const categories = new Set(pendingCandidates.map((candidate) => candidate.category));
        actions.push({
            id: "pending-assets",
            title: `确认 ${pendingCandidates.length} 个资产候选`,
            description: `${categories.size} 类角色、场景或制作资产需要确认后才能稳定复用。`,
            href: `${projectRoot}/assets`,
            actionLabel: "去确认",
            tone: "attention",
        });
    }

    if (!detail.units.length) {
        actions.push({
            id: "add-story",
            title: "添加第一个剧情章节",
            description: "导入小说、粘贴文本，或从空白章节开始。",
            href: `${projectRoot}/chapters`,
            actionLabel: "添加章节",
            tone: "default",
        });
    } else {
        const firstDraft = [...detail.units].sort(byPosition).find((unit) => unit.status === "draft");
        if (firstDraft) {
            actions.push({
                id: `review-unit-${firstDraft.id}`,
                title: `确认第 ${firstDraft.position + 1} 章内容`,
                description: firstDraft.title,
                href: `${projectRoot}/chapters/${firstDraft.id}`,
                actionLabel: "继续处理",
                tone: "default",
            });
        }

        const unitsWithShots = new Set(detail.shots.map((shot) => shot.unitId).filter(Boolean));
        const firstUnitWithoutShots = [...detail.units].sort(byPosition).find((unit) => unit.status !== "draft" && !unitsWithShots.has(unit.id));
        if (firstUnitWithoutShots) {
            actions.push({
                id: `storyboard-unit-${firstUnitWithoutShots.id}`,
                title: `为第 ${firstUnitWithoutShots.position + 1} 章建立分镜`,
                description: `${firstUnitWithoutShots.title}还没有镜头，可先生成分镜草稿再逐项调整。`,
                href: `${projectRoot}/chapters/${firstUnitWithoutShots.id}`,
                actionLabel: "建立分镜",
                tone: "default",
            });
        }
    }

    if (!detail.canvases.length && detail.units.length) {
        actions.push({
            id: "create-canvas",
            title: "建立第一张项目画布",
            description: "把章节、分镜和参考资产放进同一个制作空间。",
            href: `${projectRoot}/canvases`,
            actionLabel: "查看项目画布",
            tone: "default",
        });
    }

    if (!actions.length) {
        const target = projectContinueTarget(detail);
        actions.push({
            id: "continue-project",
            title: "继续最近的制作内容",
            description: `${target.context}：${target.title}`,
            href: target.href,
            actionLabel: "继续创作",
            tone: "default",
        });
    }
    return actions.slice(0, limit);
}

export function projectUnitStages(detail: ProjectDetail, limit = 8): ProjectUnitStage[] {
    const sortedUnits = [...detail.units].sort(byPosition).slice(0, limit);
    return sortedUnits.map((unit) => {
        const candidates = detail.assetCandidates.filter((candidate) => candidate.unitId === unit.id);
        const pendingCandidates = candidates.filter((candidate) => candidate.status === "pending_confirmation").length;
        const confirmedCandidates = candidates.filter((candidate) => candidate.status === "confirmed").length;
        const shots = detail.shots.filter((shot) => shot.unitId === unit.id);
        const canvasCount = new Set(detail.canvasUnitLinks.filter((link) => link.unitId === unit.id).map((link) => link.canvasId)).size;
        return {
            unit,
            content: contentStage(unit),
            assets: pendingCandidates
                ? { label: `${pendingCandidates} 待确认`, state: "attention" }
                : confirmedCandidates
                  ? { label: `${confirmedCandidates} 已确认`, state: "completed" }
                  : { label: "未识别", state: "idle" },
            storyboard: shots.length
                ? { label: `${shots.length} 镜头`, state: shots.every((shot) => shot.status === "completed") ? "completed" : "active" }
                : { label: "未开始", state: "idle" },
            canvas: canvasCount
                ? { label: `${canvasCount} 张`, state: "active" }
                : { label: "未关联", state: "idle" },
        };
    });
}

function contentStage(unit: ProjectUnit): ProjectStageCell {
    if (unit.status === "completed") return { label: "已完成", state: "completed" };
    if (unit.status === "ready") return { label: "待制作", state: "active" };
    return { label: "草稿", state: "attention" };
}

function byPosition(left: ProjectUnit, right: ProjectUnit) {
    return left.position - right.position;
}
