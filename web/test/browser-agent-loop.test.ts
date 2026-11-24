import { describe, expect, test } from "bun:test";
import { driveBrowserAgent, type BrowserAgentLoopIO } from "../src/services/agent/browser-agent-loop";
import type { BrowserAgentState } from "../src/services/agent/browser-agent-protocol";

const state = (kind: BrowserAgentState["nextAction"]["kind"], stepId?: string): BrowserAgentState => ({
    runtimeProtocolVersion: 1,
    checkpointVersion: 1,
    epoch: 7,
    runtimeConnection: "connected",
    status: "running",
    revision: 1,
    nextAction: { kind, stepId },
});

describe("browser orchestration", () => {
    test("lost step ACK reconciles accepted work without inventing a new step", async () => {
        const requests: Array<[string, string | undefined]> = [];
        const replies = [state("model", "run:browser:0"), new Error("network"), state("wait_task"), state("tool", "run:browser:1"), state("done")];
        const io: BrowserAgentLoopIO = {
            request: async (method, epoch, stepId) => {
                requests.push([method, stepId]);
                const reply = replies.shift()!;
                if (reply instanceof Error) throw reply;
                return reply;
            },
            wait: async () => {},
            failure: () => {},
        };
        await driveBrowserAgent(io, new AbortController().signal);
        expect(requests).toEqual([
            ["claim", undefined],
            ["step", "run:browser:0"],
            ["claim", undefined],
            ["state", undefined],
            ["step", "run:browser:1"],
        ]);
    });
    test.each(["wait_user", "wait_approval"] as const)("%s never authorizes a model call", async (kind) => {
        const controller = new AbortController();
        const methods: string[] = [];
        await driveBrowserAgent(
            {
                request: async (method) => {
                    methods.push(method);
                    return state(kind);
                },
                wait: async () => {
                    if (methods.length === 2) controller.abort();
                },
                failure: () => {},
            },
            controller.signal,
        );
        expect(methods).toEqual(["claim", "state"]);
    });
    test("incompatible checkpoint stops and reports once", async () => {
        let calls = 0;
        const errors: string[] = [];
        await driveBrowserAgent(
            {
                request: async () => {
                    calls++;
                    return { ...state("model", "step"), checkpointVersion: 99 };
                },
                wait: async () => {},
                failure: (_, error) => {
                    errors.push(error.reason!);
                },
            },
            new AbortController().signal,
        );
        expect(calls).toBe(1);
        expect(errors).toEqual(["browser_protocol_mismatch"]);
    });
});
