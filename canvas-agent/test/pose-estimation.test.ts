import assert from "node:assert/strict";
import { test } from "node:test";

import { createPoseEstimationHttpModule, PoseRuntimeError, resolvePoseRuntimePaths, validatePoseDataUrl } from "../src/modules/pose-estimation-http.js";

test("pose runtime module declares signed status and run routes", () => {
    const module = createPoseEstimationHttpModule();
    assert.equal(module.descriptor.id, "pose-estimation");
    assert.deepEqual(module.descriptor.scopes, ["pose:status", "pose:run"]);
    assert.deepEqual(module.routes.map((route) => `${route.method} ${route.path}`), [
        "GET /pose-estimation/status",
        "POST /pose-estimation/run",
    ]);
    module.dispose?.();
});

test("pose input guard accepts image data URLs and rejects unsafe input", () => {
    assert.doesNotThrow(() => validatePoseDataUrl("data:image/png;base64,AQID"));
    assert.throws(
        () => validatePoseDataUrl("data:text/plain;base64,AQID"),
        (error: unknown) => error instanceof PoseRuntimeError && error.code === "pose_input_invalid" && error.statusCode === 400,
    );
});

test("pose runtime paths honor explicit project and Python overrides", () => {
    const paths = resolvePoseRuntimePaths({
        CANVAS_PROJECT_ROOT: "C:\\pose-project",
        CANVAS_POSE_PYTHON: "C:\\pose-project\\venv\\python.exe",
        CANVAS_POSE_HF_HOME: "C:\\pose-cache",
        CANVAS_POSE_MODEL_ID: "example/pose-model",
    });
    assert.equal(paths.pythonPath, "C:\\pose-project\\venv\\python.exe");
    assert.equal(paths.hfHome, "C:\\pose-cache");
    assert.equal(paths.modelId, "example/pose-model");
    assert.equal(paths.configured, false);
    assert.equal(paths.modelCached, false);
});
