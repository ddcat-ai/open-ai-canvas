import { describe, expect, test } from "bun:test";

import { projectSmartCreationBatch, runSmartCreationSchedule } from "../src/pages/create/smart-creation-runtime";

describe("smart creation batch runtime", () => {
    test("a slow fifth result keeps the batch pending until it arrives", () => {
        const partial = projectSmartCreationBatch({
            total: 5,
            resultUrls: ["a", "b", "c", "d"],
            failedCount: 0,
        });
        expect(partial.status).toBe("pending");
        expect(partial.batchCompletedCount).toBe(4);

        const complete = projectSmartCreationBatch({
            total: 5,
            resultUrls: [...partial.resultUrls, "e"],
            failedCount: 0,
        });
        expect(complete.status).toBe("done");
        expect(complete.batchCompletedCount).toBe(5);
    });

    test("a terminal failure completes the batch without hiding successful results", () => {
        const projection = projectSmartCreationBatch({ total: 5, resultUrls: ["a", "b", "c", "d"], failedCount: 1 });
        expect(projection.status).toBe("done");
        expect(projection.resultUrls).toHaveLength(4);
        expect(projection.batchFailedCount).toBe(1);
    });

    test("stable storage keys count recovered results before access URLs resolve", () => {
        const projection = projectSmartCreationBatch({ total: 2, resultUrls: [], resultStorageKeys: ["resource:first", "resource:second"], failedCount: 0 });
        expect(projection.status).toBe("done");
        expect(projection.batchCompletedCount).toBe(2);
        expect(projection.resultStorageKeys).toEqual(["resource:first", "resource:second"]);
    });

    test("keeps submission concurrency bounded and retries temporary capacity errors", async () => {
        let running = 0;
        let peak = 0;
        const attempts = new Map<number, number>();
        const outcomes = await runSmartCreationSchedule([0, 1, 2, 3, 4], async (task) => {
            const attempt = (attempts.get(task) || 0) + 1;
            attempts.set(task, attempt);
            if (task === 0 && attempt === 1) throw Object.assign(new Error("active task limit"), { reason: "active_task_limit" });
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 1));
            running -= 1;
            return task;
        }, {
            concurrency: 2,
            capacityWaitMs: 100,
            retryDelayMs: 0,
            sleep: async () => undefined,
            isCapacityError: (error) => (error as { reason?: string })?.reason === "active_task_limit",
        });

        expect(peak).toBeLessThanOrEqual(2);
        expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
        expect(attempts.get(0)).toBe(2);
    });
});
