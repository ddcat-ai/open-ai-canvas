import { describe, expect, test } from "bun:test";
import { assertCommerceBatchHealthy, CommerceBatchPausedError, submitCommerceTaskWhenSlotAvailable, waitForCommerceGenerationSlot } from "../src/pages/ecommerce/generation-slot";
import { ApiError } from "../src/services/api/request";

describe("commerce account task slots", () => {
    test("a failed image pauses the remaining batch when capacity becomes free", async () => {
        let status = "running";
        let submissions = 0;
        await expect(
            submitCommerceTaskWhenSlotAvailable({
                activeLimit: () => 1,
                checkBatch: async () => assertCommerceBatchHealthy([{ status }]),
                listActive: async () => (status === "running" ? [{ status }] : []),
                assertCurrent: () => {},
                onWaiting: () => {},
                wait: async () => {
                    status = "failed";
                },
                submit: async () => {
                    submissions++;
                },
            }),
        ).rejects.toBeInstanceOf(CommerceBatchPausedError);
        expect(submissions).toBe(0);
    });
    test("waits and resubmits only after explicit uncreated capacity rejection", async () => {
        let attempts = 0;
        let waits = 0;
        const result = await submitCommerceTaskWhenSlotAvailable({
            activeLimit: () => 5,
            listActive: async () => [],
            assertCurrent: () => {},
            onWaiting: () => {},
            wait: async () => {
                waits++;
            },
            submit: async () => {
                if (++attempts === 1) throw new ApiError("capacity raced", { status: 429, reason: "rate_limited", details: { scope: "active_tasks", taskCreated: false } });
                return { id: "only-created-task" };
            },
        });
        expect(result.id).toBe("only-created-task");
        expect(attempts).toBe(2);
        expect(waits).toBe(1);
    });

    test("never resubmits uncertain outcomes, generic rate limits or unconfirmed rejections", async () => {
        for (const cause of [
            new Error("timeout"),
            new ApiError("server failure", { status: 503 }),
            new ApiError("rate limit", { status: 429, reason: "rate_limited" }),
            new ApiError("no guarantee", { status: 429, reason: "rate_limited", details: { scope: "active_tasks" } }),
        ]) {
            let attempts = 0;
            await expect(
                submitCommerceTaskWhenSlotAvailable({
                    activeLimit: () => 5,
                    listActive: async () => [],
                    assertCurrent: () => {},
                    onWaiting: () => {},
                    submit: async () => {
                        attempts++;
                        throw cause;
                    },
                    wait: async () => {
                        throw new Error("must not wait/retry");
                    },
                }),
            ).rejects.toBe(cause);
            expect(attempts).toBe(1);
        }
    });

    test("switching project after a capacity rejection prevents any new submission", async () => {
        let current = true;
        let attempts = 0;
        await expect(
            submitCommerceTaskWhenSlotAvailable({
                activeLimit: () => 1,
                listActive: async () => [],
                assertCurrent: () => {
                    if (!current) throw new Error("session changed");
                },
                onWaiting: () => {},
                wait: async () => {
                    current = false;
                },
                submit: async () => {
                    attempts++;
                    throw new ApiError("capacity", { status: 429, reason: "rate_limited", details: { scope: "active_tasks", taskCreated: false } });
                },
            }),
        ).rejects.toThrow("session changed");
        expect(attempts).toBe(1);
    });
    test("waits for other projects and reconciling tasks before submitting", async () => {
        let polls = 0;
        let submitted = false;
        const waiting: number[] = [];
        await waitForCommerceGenerationSlot({
            activeLimit: () => 3,
            listActive: async (limit) => {
                expect(limit).toBe(3);
                return ++polls === 1
                    ? [
                          { status: "running", projectId: "drama" },
                          { status: "queued", projectId: "canvas" },
                          { status: "reconciling", projectId: "other" },
                      ]
                    : [{ status: "running" }, { status: "succeeded" }];
            },
            assertCurrent: () => {},
            onWaiting: (active) => waiting.push(active),
            wait: async () => {
                expect(submitted).toBe(false);
            },
        });
        submitted = true;
        expect(polls).toBe(2);
        expect(waiting).toEqual([3]);
        expect(submitted).toBe(true);
    });

    test("stops before submission when the account or project changes while waiting", async () => {
        let current = true;
        let submitted = false;
        await expect(
            (async () => {
                await waitForCommerceGenerationSlot({
                    activeLimit: () => 1,
                    listActive: async () => [{ status: "running" }],
                    assertCurrent: () => {
                        if (!current) throw new Error("session changed");
                    },
                    onWaiting: () => {},
                    wait: async () => {
                        current = false;
                    },
                });
                submitted = true;
            })(),
        ).rejects.toThrow("session changed");
        expect(submitted).toBe(false);
    });

    test("a failed capacity lookup cannot release a slot or create a paid task", async () => {
        let submitted = false;
        await expect(
            (async () => {
                await waitForCommerceGenerationSlot({
                    activeLimit: () => 5,
                    listActive: async () => {
                        throw new Error("offline");
                    },
                    assertCurrent: () => {},
                    onWaiting: () => {},
                });
                submitted = true;
            })(),
        ).rejects.toThrow("offline");
        expect(submitted).toBe(false);
    });

    test("does not mistake a full API page for spare capacity above the page limit", async () => {
        let waiting = false;
        await expect(
            waitForCommerceGenerationSlot({
                activeLimit: () => 200,
                listActive: async (limit) => {
                    expect(limit).toBe(100);
                    return Array.from({ length: 100 }, () => ({ status: "running" }));
                },
                assertCurrent: () => {},
                onWaiting: () => {
                    waiting = true;
                },
                wait: async () => {
                    throw new Error("still waiting");
                },
            }),
        ).rejects.toThrow("still waiting");
        expect(waiting).toBe(true);
    });
});
