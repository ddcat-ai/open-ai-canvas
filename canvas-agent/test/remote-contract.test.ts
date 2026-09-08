import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteCanvasEnvelope, RemoteCanvasPrecondition, RemoteCanvasProject } from "../src/remote-contract.js";
import { toolNames } from "../src/schemas.js";

test("remote contract", () => {
    const precondition: RemoteCanvasPrecondition = { revision: 0, stateHash: "state-hash" };
    const project: RemoteCanvasProject = {
        id: "canvas-1",
        title: "画布",
        payload: { nodes: [] },
        revision: precondition.revision,
        stateHash: precondition.stateHash,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
    };
    const envelope: RemoteCanvasEnvelope<RemoteCanvasProject> = { code: 0, data: project, msg: "" };
    assert.equal(envelope.data.revision, 0);
    assert.deepEqual(envelope.data.payload, { nodes: [] });
});

test("remote MCP discovery contains canvas operations only", () => {
    const exposed = new Set(toolNames);
    for (const name of [
        "canvas_list_skills",
        "canvas_get_skill",
        "canvas_prepare_scene_plan",
        "canvas_get_scene_plan",
        "canvas_apply_scene_plan",
    ]) assert.equal(exposed.has(name as never), false, name);
    assert.equal(exposed.has("canvas_get_context"), true);
    assert.equal(exposed.has("canvas_validate_ops"), true);
});
