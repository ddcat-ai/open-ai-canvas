import { expect, test } from "bun:test";
import { submitCanvasMutationBatches, type CanvasMutationBatchState } from "@/services/canvas-mutation-batches";
import type { CanvasOperationsRequest } from "@/services/api/user-data";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(count = 1201) {
    const state: CanvasMutationBatchState = { request: { mutationId: "original", operations: Array.from({ length: count }, (_, i) => ({ type: "set_field", field: "title", value: `${i + 1}`, beforeValue: `${i}` })) } };
    let journal = clone(state),
        revision = 1,
        title = "0",
        id = 0;
    const calls: CanvasOperationsRequest[] = [];
    const receipts = new Map<string, { body: string; response: { project: { id: string; title: string; createdAt: string; updatedAt: string; revision: number }; mutationId: string } }>();
    const deps = {
        persist: async () => {
            journal = clone(state);
        },
        assertSession: () => {},
        newId: () => `batch-${++id}`,
        send: async (request: CanvasOperationsRequest) => {
            // Emulate the server's size check, field preconditions and receipt contract.
            expect(request.operations.length).toBeGreaterThan(0);
            expect(request.operations.length).toBeLessThanOrEqual(500);
            expect(journal.request).toEqual(request);
            calls.push(clone(request));
            const body = JSON.stringify(request),
                receipt = receipts.get(request.mutationId);
            if (receipt) {
                expect(receipt.body).toBe(body);
                return receipt.response;
            }
            for (const op of request.operations) {
                if (op.type !== "set_field") throw new Error("unexpected operation");
                expect(op.beforeValue).toBe(title);
                title = op.value as string;
            }
            const response = { project: { id: "canvas", title, createdAt: "", updatedAt: "", revision: ++revision }, mutationId: request.mutationId };
            receipts.set(request.mutationId, { body, response });
            return response;
        },
    };
    return { state, deps, calls, getJournal: () => clone(journal), restore: () => Object.assign(state, clone(journal)), title: () => title };
}

test("large edits preserve order and preconditions, persisting every batch before sending", async () => {
    const f = fixture(2004);
    const result = await submitCanvasMutationBatches(f.state, f.deps);
    expect(f.calls.map((call) => call.operations.length)).toEqual([500, 500, 500, 500, 4]);
    expect(f.calls.map((call) => call.baseRevision)).toEqual([undefined, 2, 3, 4, 5]);
    expect(f.title()).toBe("2004");
    expect(result.project.revision).toBe(6);
});

test("lost response resumes the exact journal request after reload without duplicating edits", async () => {
    const f = fixture();
    const send = f.deps.send;
    f.deps.send = async (request) => {
        const response = await send(request);
        if (f.calls.length === 2) throw new Error("response lost");
        return response;
    };
    await expect(submitCanvasMutationBatches(f.state, f.deps)).rejects.toThrow("response lost");
    const pending = f.getJournal();
    f.restore();
    f.deps.send = send;
    await submitCanvasMutationBatches(f.state, f.deps);
    expect(f.calls[2]).toEqual(pending.request);
    expect(f.title()).toBe("1201");
    expect(f.calls.map((call) => call.operations.length)).toEqual([500, 500, 500, 201]);
});

test("failed checkpoint does not send the next batch; persisted receipt can recover", async () => {
    const f = fixture();
    const persist = f.deps.persist;
    let writes = 0;
    f.deps.persist = async () => {
        if (++writes === 2) throw new Error("disk full");
        await persist();
    };
    await expect(submitCanvasMutationBatches(f.state, f.deps)).rejects.toThrow("disk full");
    expect(f.calls.length).toBe(1);
    f.restore();
    f.deps.persist = persist;
    await submitCanvasMutationBatches(f.state, f.deps);
    expect(f.calls[1]).toEqual(f.calls[0]);
    expect(f.title()).toBe("1201");
});

test("small request and final unacknowledged batch retain their original ID and body", async () => {
    const f = fixture(2);
    const request = f.state.request;
    await submitCanvasMutationBatches(f.state, f.deps);
    f.restore();
    await submitCanvasMutationBatches(f.state, f.deps);
    expect(f.calls).toEqual([request, request]);
    expect(f.title()).toBe("2");
});

test("conflict halts at the failed batch and leaves remaining edits pending", async () => {
    const f = fixture();
    const send = f.deps.send;
    f.deps.send = async (request) => {
        if (f.calls.length === 1) throw new Error("field conflict");
        return send(request);
    };
    await expect(submitCanvasMutationBatches(f.state, f.deps)).rejects.toThrow("field conflict");
    expect(f.title()).toBe("500");
    expect(f.getJournal().request.operations.length).toBe(500);
    expect(f.getJournal().remainingOperations?.length).toBe(201);
});

test("account switch after a response cannot submit the next batch", async () => {
    const f = fixture();
    const send = f.deps.send;
    let active = true;
    f.deps.send = async (request) => {
        const response = await send(request);
        active = false;
        return response;
    };
    f.deps.assertSession = () => {
        if (!active) throw new Error("account switched");
    };
    await expect(submitCanvasMutationBatches(f.state, f.deps)).rejects.toThrow("account switched");
    expect(f.calls.length).toBe(1);
    expect(f.getJournal().request.mutationId).toBe("original");
});

test("every batch retains edit proofs required by multi-window text leases", async () => {
    const f = fixture();
    const proofs = [{ nodeId: "text-node", sessionId: "window-1", token: "lease-token" }];
    f.state.request.editProofs = proofs;
    const send = f.deps.send;
    f.deps.send = async (request) => {
        if (JSON.stringify(request.editProofs) !== JSON.stringify(proofs)) throw new Error("edit lease proof missing");
        return send(request);
    };
    await submitCanvasMutationBatches(f.state, f.deps);
    expect(f.calls).toHaveLength(3);
    expect(f.calls.every((request) => JSON.stringify(request.editProofs) === JSON.stringify(proofs))).toBe(true);
});
