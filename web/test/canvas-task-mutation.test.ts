import { describe, expect, test } from "bun:test";

import { fenceRejectedTaskTimestampMutation, repairLegacyTaskIdFence } from "@/lib/canvas/canvas-task-mutation";
import type { CanvasOperationsRequest } from "@/services/api/user-data";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const oldTime = "2026-04-01T00:00:00.123456789Z";
const newTime = "2026-04-01T08:00:01.123456789+08:00";

function canvas(taskUpdatedAt: unknown = oldTime, taskId: unknown = "task-1"): CanvasProject {
    return {
        id: "canvas",
        title: "Canvas",
        createdAt: "",
        updatedAt: "",
        nodes: [{ id: "video", type: "video", metadata: { taskId, taskUpdatedAt } }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    } as unknown as CanvasProject;
}

function request(patch: Record<string, unknown> = { "metadata.taskUpdatedAt": newTime }, before: Record<string, unknown> = { "metadata.taskUpdatedAt": oldTime }): CanvasOperationsRequest {
    return { mutationId: "original-id", baseRevision: 4, operations: [{ type: "patch_node", id: "video", patch, before }] };
}

describe("fenceRejectedTaskTimestampMutation", () => {
    test("adds only a same-task fence to original JSON wire without mutating inputs", () => {
        const original = JSON.parse(JSON.stringify(request())) as CanvasOperationsRequest;
        const baseline = canvas();
        const prepared = canvas(newTime);
        const saved = structuredClone({ original, baseline, prepared });
        const result = fenceRejectedTaskTimestampMutation(original, baseline, prepared);
        expect(result).toEqual({ ...original, operations: [{ ...original.operations[0], before: { "metadata.taskUpdatedAt": oldTime, "metadata.taskId": "task-1" } }] });
        expect({ original, baseline, prepared }).toEqual(saved);
        expect(result?.mutationId).toBe("original-id");
        expect(result?.operations[0]?.type === "patch_node" && result.operations[0].patch).toBe(original.operations[0]?.type === "patch_node" && original.operations[0].patch);
    });

    test("preserves mixed business patches and their original conflict baselines", () => {
        const original = request({ "metadata.taskUpdatedAt": newTime, "metadata.prompt": "new" }, { "metadata.taskUpdatedAt": oldTime, "metadata.prompt": "wire-old" });
        original.operations.unshift({ type: "set_field", field: "title", value: "new title", beforeValue: "wire title" });
        original.operations.push({ type: "patch_node", id: "other", patch: { x: 7 }, before: { x: 3 } });
        const result = fenceRejectedTaskTimestampMutation(original, canvas(), canvas(newTime));
        expect(result?.operations).toHaveLength(3);
        expect(result?.operations[0]).toBe(original.operations[0]);
        expect(result?.operations[2]).toBe(original.operations[2]);
        expect(result?.operations[1]).toEqual({ ...original.operations[1], before: { "metadata.taskUpdatedAt": oldTime, "metadata.prompt": "wire-old", "metadata.taskId": "task-1" } });
    });

    test("rejects any explicit taskId patch even when its value is unchanged", () => {
        expect(fenceRejectedTaskTimestampMutation(request({ "metadata.taskUpdatedAt": newTime, "metadata.taskId": "task-1" }), canvas(), canvas(newTime))).toBeUndefined();
        const original = request();
        original.operations.push({ type: "patch_node", id: "video", patch: { "metadata.taskId": "task-1" }, before: { "metadata.taskId": "task-1" } });
        expect(fenceRejectedTaskTimestampMutation(original, canvas(), canvas(newTime))).toBeUndefined();
    });

    test("does not repeat an existing fence or replace a wrong existing fence", () => {
        for (const taskId of ["task-1", "task-2", null, ""]) {
            expect(fenceRejectedTaskTimestampMutation(request(undefined, { "metadata.taskUpdatedAt": oldTime, "metadata.taskId": taskId }), canvas(), canvas(newTime))).toBeUndefined();
        }
        const fenced = fenceRejectedTaskTimestampMutation(request(), canvas(), canvas(newTime))!;
        expect(fenceRejectedTaskTimestampMutation(fenced, canvas(), canvas(newTime))).toBeUndefined();
    });

    test.each(["", null, undefined, 123, "not-a-date", "2026-04-01", "2026-04-01T00:00:00", "2026-02-30T00:00:00Z", "2026-04-01T24:00:00Z", "2026-04-01T00:60:00Z", "2026-04-01T00:00:00+24:00", "2026-04-01T00:00:00Z "])(
        "rejects invalid patch or baseline timestamp %p",
        (value) => {
            expect(fenceRejectedTaskTimestampMutation(request({ "metadata.taskUpdatedAt": value }), canvas(), canvas(value))).toBeUndefined();
            if (value !== null) expect(fenceRejectedTaskTimestampMutation(request(undefined, { "metadata.taskUpdatedAt": value }), canvas(value), canvas(newTime))).toBeUndefined();
        },
    );

    test("fences first observed timestamp only when null wire baseline matches an absent or null original", () => {
        const original = request(undefined, { "metadata.taskUpdatedAt": null });
        const absent = canvas();
        delete absent.nodes[0]!.metadata!.taskUpdatedAt;
        const explicitUndefined = canvas();
        explicitUndefined.nodes[0]!.metadata!.taskUpdatedAt = undefined;
        for (const baseline of [absent, explicitUndefined, canvas(null)]) {
            const saved = structuredClone({ original, baseline });
            expect(fenceRejectedTaskTimestampMutation(original, baseline, canvas(newTime))).toEqual({
                ...original,
                operations: [{ ...original.operations[0], before: { "metadata.taskUpdatedAt": null, "metadata.taskId": "task-1" } }],
            });
            expect({ original, baseline }).toEqual(saved);
        }
        for (const baseline of [canvas(), canvas(""), canvas("not-a-date"), canvas(123)]) {
            expect(fenceRejectedTaskTimestampMutation(original, baseline, canvas(newTime))).toBeUndefined();
        }
        expect(fenceRejectedTaskTimestampMutation(request(), absent, canvas(newTime))).toBeUndefined();
        expect(fenceRejectedTaskTimestampMutation(request({ "metadata.taskUpdatedAt": null }, { "metadata.taskUpdatedAt": null }), absent, canvas(null))).toBeUndefined();
        expect(fenceRejectedTaskTimestampMutation(original, absent, canvas(newTime, "task-2"))).toBeUndefined();
    });

    test("rejects missing snapshots/nodes, different canvases and task identity changes", () => {
        expect(fenceRejectedTaskTimestampMutation(request())).toBeUndefined();
        expect(fenceRejectedTaskTimestampMutation(request(), canvas())).toBeUndefined();
        expect(fenceRejectedTaskTimestampMutation(request(), undefined, canvas(newTime))).toBeUndefined();
        for (const baseline of [canvas(oldTime, ""), canvas(oldTime, null), { ...canvas(), nodes: [] }]) {
            expect(fenceRejectedTaskTimestampMutation(request(), baseline, canvas(newTime))).toBeUndefined();
        }
        for (const prepared of [canvas(newTime, "task-2"), canvas(newTime, null), { ...canvas(newTime), nodes: [] }, { ...canvas(newTime), id: "other" }]) {
            expect(fenceRejectedTaskTimestampMutation(request(), canvas(), prepared)).toBeUndefined();
        }
    });

    test("rejects missing before and raw wire/snapshot mismatches even for equal instants", () => {
        const missing = request();
        if (missing.operations[0]?.type === "patch_node") delete missing.operations[0].before;
        for (const original of [missing, request(undefined, {}), request(undefined, { "metadata.taskUpdatedAt": "2026-04-01T08:00:00.123456789+08:00" }), request({ "metadata.taskUpdatedAt": "2026-04-01T00:00:01.123456789Z" })]) {
            expect(fenceRejectedTaskTimestampMutation(original, canvas(), canvas(newTime))).toBeUndefined();
        }
    });

    test("rejects task switching, null/reset and metadata parent replacements", () => {
        for (const patch of [{ metadata: null }, { metadata: { taskId: "task-1", taskUpdatedAt: newTime } }, { "metadata.taskId": "task-2" }, { "metadata.taskId": null }, { "metadata.taskId": "" }]) {
            expect(fenceRejectedTaskTimestampMutation(request({ "metadata.taskUpdatedAt": newTime, ...patch }), canvas(), canvas(newTime))).toBeUndefined();
        }
        expect(fenceRejectedTaskTimestampMutation(request(undefined, { metadata: {}, "metadata.taskUpdatedAt": oldTime }), canvas(), canvas(newTime))).toBeUndefined();
    });

    test("rejects the whole batch when any timestamp op is unsafe, regardless of order", () => {
        const safe = request().operations[0]!;
        const unsafe = request({ "metadata.taskUpdatedAt": null }).operations[0]!;
        for (const operations of [
            [safe, unsafe],
            [unsafe, safe],
        ]) {
            expect(fenceRejectedTaskTimestampMutation({ ...request(), operations }, canvas(), canvas(newTime))).toBeUndefined();
        }
        expect(fenceRejectedTaskTimestampMutation({ ...request(), operations: [safe, { type: "patch_node", id: "video", patch: { "metadata.taskId": null }, before: { "metadata.taskId": "task-1" } }] }, canvas(), canvas(newTime))).toBeUndefined();
    });

    test("returns undefined if no timestamp operation changes", () => {
        expect(fenceRejectedTaskTimestampMutation({ ...request(), operations: [] }, canvas(), canvas(newTime))).toBeUndefined();
        expect(fenceRejectedTaskTimestampMutation(request({ "metadata.prompt": "new" }, { "metadata.prompt": "old" }), canvas(), canvas(newTime))).toBeUndefined();
    });
});

describe("repairLegacyTaskIdFence", () => {
    const bind = (before: Record<string, unknown> = { "metadata.taskId": "task-new", "metadata.taskUpdatedAt": null, "metadata.status": "idle" }) =>
        request({ "metadata.taskId": "task-new", "metadata.taskUpdatedAt": newTime, "metadata.status": "loading" }, before);

    test("restores the original taskId baseline when v1.6.8.5 wrote the new id into before", () => {
        const original = bind();
        const saved = structuredClone(original);
        const result = repairLegacyTaskIdFence(original, canvas(null, null), canvas(newTime, "task-new"));
        expect(result?.operations[0]).toEqual({ ...original.operations[0], before: { "metadata.taskId": null, "metadata.taskUpdatedAt": null, "metadata.status": "idle" } });
        expect(original).toEqual(saved);
        expect(repairLegacyTaskIdFence(result!, canvas(null, null), canvas(newTime, "task-new"))).toBeUndefined();
        expect(repairLegacyTaskIdFence(original, canvas(null, "task-old"), canvas(newTime, "task-new"))?.operations[0]).toMatchObject({ before: { "metadata.taskId": "task-old" } });
        const absent = canvas(null, null);
        delete absent.nodes[0]!.metadata!.taskId;
        expect(repairLegacyTaskIdFence(original, absent, canvas(newTime, "task-new"))?.operations[0]).toMatchObject({ before: { "metadata.taskId": null } });
    });

    test("never guesses without matching snapshots and leaves valid requests alone", () => {
        expect(repairLegacyTaskIdFence(bind())).toBeUndefined();
        expect(repairLegacyTaskIdFence(bind(), { ...canvas(null, null), nodes: [] }, canvas(newTime, "task-new"))).toBeUndefined();
        expect(repairLegacyTaskIdFence(bind(), canvas(null, null), canvas(newTime, "task-other"))).toBeUndefined();
        expect(repairLegacyTaskIdFence(bind(), canvas(null, "task-new"), canvas(newTime, "task-new"))).toBeUndefined();
        expect(repairLegacyTaskIdFence(bind({ "metadata.taskId": null }), canvas(null, null), canvas(newTime, "task-new"))).toBeUndefined();
        expect(repairLegacyTaskIdFence(request(), canvas(), canvas(newTime))).toBeUndefined();
    });
});
