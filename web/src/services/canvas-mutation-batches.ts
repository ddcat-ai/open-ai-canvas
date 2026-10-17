import type { CanvasOperation, CanvasOperationsRequest, RemoteUserDataSummary } from "@/services/api/user-data";

// ApplyUserCanvasOperations accepts at most 500 operations per transaction.
const batchLimit = 500;
export type CanvasMutationBatchState = {
    request: CanvasOperationsRequest;
    remainingOperations?: CanvasOperation[];
};
type MutationResponse = { project: RemoteUserDataSummary & { revision: number }; mutationId: string };

/** Persist each exact request before sending; keep the last request until the caller acknowledges the full snapshot. */
export async function submitCanvasMutationBatches(
    state: CanvasMutationBatchState,
    deps: {
        persist: () => Promise<void>;
        assertSession: () => void;
        send: (request: CanvasOperationsRequest) => Promise<MutationResponse>;
        newId: () => string;
    },
) {
    deps.assertSession();
    if (state.request.operations.length > batchLimit) {
        state.remainingOperations = [...state.request.operations.slice(batchLimit), ...(state.remainingOperations || [])];
        state.request = { ...state.request, operations: state.request.operations.slice(0, batchLimit) };
    }
    for (;;) {
        await deps.persist();
        deps.assertSession();
        const response = await deps.send(state.request);
        deps.assertSession();
        if (!Number.isSafeInteger(response.project.revision)) throw new Error("服务端未返回有效画布版本");
        if (!state.remainingOperations?.length) return response;
        // If this checkpoint fails, the persisted previous batch can be replayed
        // with its receipt. No later batch is sent before its journal is durable.
        state.request = {
            ...state.request,
            mutationId: deps.newId(),
            baseRevision: response.project.revision,
            operations: state.remainingOperations.slice(0, batchLimit),
        };
        state.remainingOperations = state.remainingOperations.slice(batchLimit);
    }
}
