import { expect, test } from "bun:test";

import { groupWorkbenchTasks, workbenchTaskOutputs, workbenchTaskSnapshot } from "../src/pages/workbench/workbench-batches";
import type { GenerationTask } from "../src/services/api/task-center";

test("local image receipts retain batch, parameters and storage-backed outputs", () => {
    const task: GenerationTask = {
        id: "yingce-local:one",
        type: "canvas_image",
        status: "succeeded",
        prompt: "test",
        attempts: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        clientContext: { batchId: "batch", batchIndex: 1, batchCount: 2 },
        inputJson: JSON.stringify({ metadata: { workbench: { kind: "image", parameters: { size: "1:1" }, references: [], batch: { id: "batch", index: 1, count: 2 } } } }),
        resultJson: JSON.stringify({ images: [{ storageKey: "image:alice:one", mimeType: "image/png" }] }),
    };
    expect(groupWorkbenchTasks([task])[0]).toMatchObject({ key: "batch:batch", expectedTasks: 2 });
    expect(workbenchTaskSnapshot(task)).toMatchObject({ kind: "image", parameters: { size: "1:1" } });
    expect(workbenchTaskOutputs(task, "image")).toMatchObject([{ storageKey: "image:alice:one", mimeType: "image/png", url: "" }]);
});
