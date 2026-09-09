import assert from "node:assert/strict";
import { test } from "node:test";

import { createDepthEstimationHttpModule, DepthRuntimeError, resolveDepthRuntimePaths, validateDepthDataUrl } from "../src/modules/depth-estimation-http.js";

test("depth runtime module declares signed status and run routes", () => {
    const module = createDepthEstimationHttpModule();
    assert.equal(module.descriptor.id, "depth-estimation");
    assert.deepEqual(module.descriptor.scopes, ["depth:status", "depth:run"]);
    assert.deepEqual(module.routes.map((route) => `${route.method} ${route.path}`), [
        "GET /depth-estimation/status",
        "POST /depth-estimation/run",
    ]);
    module.dispose?.();
});

test("depth input guard accepts image data URLs and rejects unsafe input", () => {
    assert.doesNotThrow(() => validateDepthDataUrl("data:image/png;base64,AQID"));
    assert.throws(
        () => validateDepthDataUrl("data:text/plain;base64,AQID"),
        (error: unknown) => error instanceof DepthRuntimeError && error.code === "depth_input_invalid" && error.statusCode === 400,
    );
});

test("depth runtime paths honor explicit project and Python overrides", () => {
    const paths = resolveDepthRuntimePaths({
        CANVAS_PROJECT_ROOT: "C:\\depth-project",
        CANVAS_DEPTH_PYTHON: "C:\\depth-project\\venv\\python.exe",
        CANVAS_DEPTH_HF_HOME: "C:\\depth-cache",
        CANVAS_DEPTH_MODEL_ID: "example/depth-model",
    });
    assert.equal(paths.pythonPath, "C:\\depth-project\\venv\\python.exe");
    assert.equal(paths.hfHome, "C:\\depth-cache");
    assert.equal(paths.modelId, "example/depth-model");
    assert.equal(paths.configured, false);
});
