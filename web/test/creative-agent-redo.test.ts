import { describe, expect, test } from "bun:test";
import { CreativeAgentController } from "../src/services/creative-agent-controller";
import { assertCreativeBriefSpecifications, initialCreativeState, type CreativeAgentState } from "../src/lib/creation/creative-agent-state";
import type { CreativeProposal } from "../src/lib/creation/creative-agent-contract";
import { creationRuns, type CreationRun, type CreationSubmission } from "../src/services/api/creation-runs";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import type { CanvasSnapshot } from "../src/lib/canvas/canvas-operation-contract";
import { CanvasNodeType } from "../src/types/canvas";
import type { GenerationTask } from "../src/services/api/task-center";

const channel = createModelChannel({ id: "system-test", name: "测试", scope: "system", models: ["gpt-image-1"], apiFormat: "openai", interfaceType: "openai-images", apiKey: "system", baseUrl: "/api/test" });
const model = "system-test::gpt-image-1";
const config = { ...defaultConfig, channels: [channel], model };
const proposal: CreativeProposal = { id: "p", version: 1, title: "双图", summary: "摘要", markdown: "正文", deliverables: [], workflow: { nodes: [{ ref: "a", kind: "image", title: "参考", prompt: "参考" }, { ref: "b", kind: "image", title: "结果", prompt: "结果", referenceRefs: ["a"] }], edges: [], autoRun: false }, generationItems: [{ ref: "a", mode: "image", model, size: "1024x1024" }, { ref: "b", mode: "image", model, size: "1024x1024", referenceRefs: ["a"] }], extra: { nodeIds: { a: "original-a", b: "original-b" } } };

describe("创作规格与局部重做", () => {
    test("像素尺寸按实际比例比较，错误比例和未明确规格仍拒绝", () => {
        const brief = { aspectRatio: { value: "1:1", source: "user" as const, status: "confirmed" as const } };
        expect(() => assertCreativeBriefSpecifications(proposal, brief)).not.toThrow();
        for (const size of ["1536x1024", "auto", undefined]) expect(() => assertCreativeBriefSpecifications({ ...proposal, generationItems: [{ ...proposal.generationItems[0], size }] }, brief)).toThrow("比例");
        expect(() => assertCreativeBriefSpecifications({ ...proposal, generationItems: [{ ...proposal.generationItems[0], size: "1536 × 1024" }] }, { aspectRatio: { ...brief.aspectRatio, value: "3:2" } })).not.toThrow();
    });

    for (const approvedBeforeDisconnect of [false, true]) test(`重做批准${approvedBeforeDisconnect ? "已落盘但回执丢失" : "尚未落盘"}，重新装载后仅准备原目标并保留参考节点`, async () => {
        const state: CreativeAgentState = { ...initialCreativeState(), proposal: structuredClone(proposal), canvasApplied: true, media: ["a", "b"].map((ref) => ({ ref, nodeId: `original-${ref}`, attempt: 1, status: "ready", taskId: `old-${ref}`, storageKey: `resource:${ref}` })) };
        let run: CreationRun = { id: "run", userId: "user", canvasId: "canvas", revision: 1, executionEpoch: 0, executionOwner: "", status: "completed", state: structuredClone(state) as unknown as Record<string, unknown>, approvedProposalVersion: 1, approvedProposalHash: "old", createdAt: "", updatedAt: "" };
        const snapshot: CanvasSnapshot = { projectId: "canvas", title: "画布", nodes: ["a", "b"].map((ref) => ({ id: `original-${ref}`, type: CanvasNodeType.Image, title: ref, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: ref === "a" ? "参考" : "结果", model, size: "1024x1024", status: "success", storageKey: `resource:${ref}`, ...(ref === "b" ? { referenceNodeIds: ["original-a"] } : {}) } })), connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
        const submissions: CreationSubmission[] = [];
        let disconnect = true, approvals = 0, executions = 0;
        const prepared: Parameters<typeof creationRuns.prepare>[1][] = [];
        const api: typeof creationRuns = { ...creationRuns,
            get: async () => ({ run: structuredClone(run), submissions: structuredClone(submissions) }),
            claim: async (_id, input) => (run = { ...run, executionEpoch: run.executionEpoch + 1, executionOwner: input.owner }),
            release: async () => ({ released: true }),
            save: async (_id, input) => (run = { ...run, revision: run.revision + 1, state: structuredClone(input.state), status: input.status }),
            approveProposal: async (_id, input) => {
                approvals++;
                if (!disconnect || approvedBeforeDisconnect) run = { ...run, revision: run.revision + 1, approvedProposalVersion: input.proposalVersion, approvedProposalHash: "redo" };
                if (disconnect) throw new Error("模拟批准断线");
                return run;
            },
            prepare: async (_id, input) => {
                prepared.push(input);
                const submission: CreationSubmission = { id: "new-b", runId: "run", itemKey: input.itemKey, requestHash: "hash", quote: { model, billingMode: "fixed_request", quantity: 1, amountMicrocredits: 1, estimated: false, expiresAt: "2099-01-01", quoteHash: "quote" } };
                submissions.push(submission); return submission;
            },
            execute: async () => { executions++; throw new Error("恢复不得自动收费"); },
        };
        const create = () => new CreativeAgentController({ config: () => config, canvas: () => ({ canvasId: "canvas", read: () => snapshot, apply: async () => { throw new Error("重做不得新建节点"); } }), onChange: () => undefined, onOpenCanvas: () => undefined, api, queryTask: async () => ({ status: "succeeded" } as GenerationTask) });
        const original = create();
        try { await original.load("run"); await expect(original.redo("b")).rejects.toThrow("模拟批准断线"); } finally { original.dispose(); }
        expect((run.state as unknown as CreativeAgentState).pendingRedo).toEqual({ ref: "b", attempt: 2, proposalVersion: 2 });
        disconnect = false;
        const restored = create();
        try { await restored.load("run"); await restored.resume(); await restored.resume(); } finally { restored.dispose(); }
        const saved = run.state as unknown as CreativeAgentState;
        expect(approvals).toBe(approvedBeforeDisconnect ? 1 : 2);
        expect(prepared).toHaveLength(1);
        expect(prepared[0].itemKey).toBe("media:v2:b:2");
        expect(prepared[0].request.input.nodeId).toBe("original-b");
        expect((prepared[0].request.input.referenceImages as { id: string }[]).map((reference) => reference.id)).toEqual(["original-a"]);
        expect(saved.pendingRedo).toBeUndefined();
        expect(saved.media[0]).toEqual(state.media[0]);
        expect(saved.media[1].attempt).toBe(2);
        expect(run.status).toBe("waiting_payment");
        expect(executions).toBe(0);
    });
});
