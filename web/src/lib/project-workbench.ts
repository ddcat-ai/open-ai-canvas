import { t } from "@/i18n";
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
    if (summary.project.status === "archived") return { label: t("lib:archived"), detail: t("lib:restore-in-project-settings") };
    if (!summary.unitCount) return { label: t("lib:prepare-story"), detail: t("lib:no-story-chapters-yet") };
    if (summary.completedUnitCount === summary.unitCount) return { label: t("lib:chapters-finished"), detail: t("lib:review-shots-and-deliverables-next") };
    if (!summary.canvasCount) return { label: t("lib:organize-chapters"), detail: t("lib:next-build-the-project-canvas") };
    if (!summary.assetCount) return { label: t("lib:prepare-assets"), detail: t("lib:add-characters-scenes-or-styles") };
    return { label: t("lib:in-production"), detail: t("lib:param-param-chapters-done", { completedUnitCount: summary.completedUnitCount, unitCount: summary.unitCount }) };
}

export function projectDetailStage(detail: ProjectDetail) {
    if (detail.project.status === "archived") return { label: t("lib:archived"), detail: t("lib:restore-the-project-to-continue-production") };
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    if (failedSteps) return { label: t("lib:needs-attention"), detail: t("lib:param-pipeline-steps-failed", { failedSteps: failedSteps }) };
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    if (pendingCandidates) return { label: t("lib:asset-confirmation"), detail: t("lib:param-candidates-awaiting-confirmation", { pendingCandidates: pendingCandidates }) };
    if (!detail.units.length) return { label: t("lib:prepare-story"), detail: t("lib:add-or-import-story-chapters") };
    if (!detail.shots.length) return { label: t("lib:storyboard-prep"), detail: t("lib:pick-chapters-to-generate-shots") };
    const runningSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "running" || step.status === "review").length;
    if (runningSteps) return { label: t("lib:in-production"), detail: t("lib:param-pipeline-steps-in-progress", { runningSteps: runningSteps }) };
    const completedUnits = detail.units.filter((unit) => unit.status === "completed").length;
    if (completedUnits === detail.units.length) return { label: t("lib:review-deliverables"), detail: t("lib:chapters-finished-review-shots-and-results") };
    return { label: t("lib:shot-production"), detail: t("lib:param-shots-created", { length: detail.shots.length }) };
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
            context: t("lib:continue-editing-project-canvas"),
            updatedAt: latestCanvas.updatedAt,
        };
    }
    if (latestUnit) {
        return {
            href: `/projects/${detail.project.id}/chapters/${latestUnit.id}`,
            title: latestUnit.title,
            context: t("lib:continue-working-on-chapters"),
            updatedAt: latestUnit.updatedAt,
        };
    }
    return {
        href: `/projects/${detail.project.id}/chapters`,
        title: detail.project.name,
        context: t("lib:start-from-story-chapters"),
        updatedAt: detail.project.updatedAt,
    };
}

// 项目概览必须把真实阻塞转成动作；没有事实依据时只提示通用的制作下一步。
export function projectNextActions(detail: ProjectDetail, limit = 4): ProjectWorkbenchAction[] {
    const actions: ProjectWorkbenchAction[] = [];
    const projectRoot = `/projects/${detail.project.id}`;
    if (detail.project.status === "archived") {
        return [
            {
                id: "restore-project",
                title: t("lib:project-archived"),
                description: t("lib:restore-before-creating-canvases-or-submitting-generation-tasks"),
                href: `${projectRoot}/settings`,
                actionLabel: t("lib:restore-now"),
                tone: "attention",
            },
        ];
    }

    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed");
    if (failedSteps.length) {
        actions.push({
            id: "failed-steps",
            title: t("lib:handle-param-failed-steps", { length: failedSteps.length }),
            description: failedSteps[0].error?.trim() || t("lib:review-failure-causes-and-inputs-then-retry-only-affected-tasks"),
            href: "/tasks?status=failed",
            actionLabel: t("lib:view-failed-tasks"),
            tone: "danger",
        });
    }

    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    if (pendingCandidates.length) {
        const categories = new Set(pendingCandidates.map((candidate) => candidate.category));
        actions.push({
            id: "pending-assets",
            title: t("lib:confirm-param-asset-candidates", { length: pendingCandidates.length }),
            description: t("lib:param-kinds-of-character-scene-or-production-assets-need-confirmation-be", { size: categories.size }),
            href: `${projectRoot}/assets`,
            actionLabel: t("lib:confirm-now"),
            tone: "attention",
        });
    }

    if (!detail.units.length) {
        actions.push({
            id: "add-story",
            title: t("lib:add-the-first-story-chapter"),
            description: t("lib:import-a-novel-paste-text-or-start-from-a-blank-chapter"),
            href: `${projectRoot}/chapters`,
            actionLabel: t("lib:add-chapter"),
            tone: "default",
        });
    } else {
        const firstDraft = [...detail.units].sort(byPosition).find((unit) => unit.status === "draft");
        if (firstDraft) {
            actions.push({
                id: `review-unit-${firstDraft.id}`,
                title: t("lib:review-chapter-content-param", { index: firstDraft.position + 1 }),
                description: firstDraft.title,
                href: `${projectRoot}/chapters/${firstDraft.id}`,
                actionLabel: t("lib:continue"),
                tone: "default",
            });
        }

        const unitsWithShots = new Set(detail.shots.map((shot) => shot.unitId).filter(Boolean));
        const firstUnitWithoutShots = [...detail.units].sort(byPosition).find((unit) => unit.status !== "draft" && !unitsWithShots.has(unit.id));
        if (firstUnitWithoutShots) {
            actions.push({
                id: `storyboard-unit-${firstUnitWithoutShots.id}`,
                title: t("lib:create-storyboard-for-chapter-param", { index: firstUnitWithoutShots.position + 1 }),
                description: t("lib:param-has-no-shots-yet-generate-a-storyboard-draft-first-then-adjust-eac", { title: firstUnitWithoutShots.title }),
                href: `${projectRoot}/chapters/${firstUnitWithoutShots.id}`,
                actionLabel: t("lib:create-storyboard"),
                tone: "default",
            });
        }
    }

    if (!detail.canvases.length && detail.units.length) {
        actions.push({
            id: "create-canvas",
            title: t("lib:build-the-first-project-canvas"),
            description: t("lib:bring-chapters-storyboards-and-reference-assets-into-one-production-spac"),
            href: `${projectRoot}/canvases`,
            actionLabel: t("lib:view-project-canvas"),
            tone: "default",
        });
    }

    if (!actions.length) {
        const target = projectContinueTarget(detail);
        actions.push({
            id: "continue-project",
            title: t("lib:resume-recent-work"),
            description: `${target.context}：${target.title}`,
            href: target.href,
            actionLabel: t("lib:continue-creating"),
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
                ? { label: t("lib:param-to-confirm", { pendingCandidates: pendingCandidates }), state: "attention" }
                : confirmedCandidates
                  ? { label: t("lib:param-confirmed", { confirmedCandidates: confirmedCandidates }), state: "completed" }
                  : { label: t("lib:unrecognized"), state: "idle" },
            storyboard: shots.length ? { label: t("lib:param-shots-2", { length: shots.length }), state: shots.every((shot) => shot.status === "completed") ? "completed" : "active" } : { label: t("lib:not-started-2"), state: "idle" },
            canvas: canvasCount ? { label: t("lib:param", { canvasCount: canvasCount }), state: "active" } : { label: t("lib:not-linked"), state: "idle" },
        };
    });
}

function contentStage(unit: ProjectUnit): ProjectStageCell {
    if (unit.status === "completed") return { label: t("lib:done"), state: "completed" };
    if (unit.status === "ready") return { label: t("lib:to-produce"), state: "active" };
    return { label: t("lib:draft"), state: "attention" };
}

function byPosition(left: ProjectUnit, right: ProjectUnit) {
    return left.position - right.position;
}
