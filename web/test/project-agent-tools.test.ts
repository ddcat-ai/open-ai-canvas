import { describe, expect, test } from "bun:test";

import { distillShotContext, latestShotTask } from "../src/services/api/shot-context";
import type { ProjectDetail } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";

/* W1-B-01（D-046）：镜头域蒸馏函数单测——getShot 返回形状的契约锁。 */

function fakeDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
    return {
        project: { id: "proj-1" } as ProjectDetail["project"],
        units: [],
        canvases: [],
        canvasUnitLinks: [],
        assets: [],
        assetFolders: [],
        workflows: [],
        shots: [],
        shotRevisions: [],
        shotArtifacts: [],
        shotReferences: [],
        assetCandidates: [],
        tasks: [],
        ...overrides,
    } as unknown as ProjectDetail;
}

function fakeTask(id: string, shotId: string, updatedAt: string, status = "succeeded"): GenerationTask {
    return { id, status, updatedAt, clientContext: { shotId, artifactType: "video" } } as unknown as GenerationTask;
}

describe("latestShotTask", () => {
    test("取 updatedAt 最新的任务", () => {
        const detail = fakeDetail({ tasks: [fakeTask("t-old", "shot-1", "2026-09-05T01:00:00Z"), fakeTask("t-new", "shot-1", "2026-09-05T02:00:00Z"), fakeTask("t-other", "shot-2", "2026-09-05T03:00:00Z")] });
        expect(latestShotTask(detail, "shot-1")?.id).toBe("t-new");
    });

    test("没有任务时返回 undefined", () => {
        expect(latestShotTask(fakeDetail(), "shot-1")).toBeUndefined();
    });
});

describe("distillShotContext", () => {
    test("镜头不存在返回 null", () => {
        expect(distillShotContext(fakeDetail(), "nope")).toBeNull();
    });

    test("组装 shot + 最新 revision + 产物列表（version 倒序）+ 最新任务", () => {
        const detail = fakeDetail({
            shots: [{ id: "shot-1", title: "镜头一", position: 0, durationMs: 3000, status: "draft" } as unknown as ProjectDetail["shots"][number]],
            shotRevisions: [
                { id: "rev-1", shotId: "shot-1", version: 1, durationMs: 3000 },
                { id: "rev-2", shotId: "shot-1", version: 2, durationMs: 4000 },
            ],
            shotArtifacts: [
                { id: "art-1", shotId: "shot-1", type: "video", version: 1, status: "stale", selected: false, createdAt: "2026-09-05T01:00:00Z" },
                { id: "art-2", shotId: "shot-1", type: "video", version: 2, status: "ready", selected: true, provider: "comfy", durationMs: 4000, createdAt: "2026-09-05T02:00:00Z" },
            ],
            tasks: [fakeTask("t-1", "shot-1", "2026-09-05T02:00:00Z", "failed")],
        } as Partial<ProjectDetail>);
        const summary = distillShotContext(detail, "shot-1");
        expect(summary).not.toBeNull();
        expect(summary!.shot.id).toBe("shot-1");
        expect(summary!.revision?.id).toBe("rev-2");
        expect(summary!.artifacts.map((item) => item.version)).toEqual([2, 1]);
        expect(summary!.artifacts[0].selected).toBe(true);
        expect(summary!.latestTask?.id).toBe("t-1");
        expect(summary!.latestTask?.status).toBe("failed");
    });
});
