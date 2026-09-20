import { http } from "./request";
import type { CanvasOperation } from "@/lib/canvas/canvas-operation-contract";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CreateTaskInput, GenerationTask } from "./task-center";

export type CreationStatus = "idle" | "running" | "waiting_answer" | "waiting_proposal" | "waiting_canvas" | "waiting_payment" | "waiting_task" | "paused" | "completed" | "cancelled";
export type CreationGuard = { executionEpoch: number; owner: string };
export type CreationRun = {
    id: string; userId: string; canvasId?: string; revision: number;
    executionEpoch: number; executionOwner: string; leaseExpiresAt?: string;
    status: CreationStatus; state: Record<string, unknown>;
    approvedProposalVersion?: number; approvedProposalHash?: string;
    createdAt: string; updatedAt: string;
};
export type CreationSubmission = {
    id: string; runId: string; itemKey: string; requestHash: string;
    quote: { model: string; billingMode: string; quantity: number; amountMicrocredits: number; estimated: boolean; expiresAt: string; quoteHash: string; options?: Record<string, unknown> };
    approvedAt?: string; revokedAt?: string; taskId?: string;
};
export type CreationRunDetail = { run: CreationRun; submissions: CreationSubmission[] };

const path = (id: string) => `/creation-runs/${encodeURIComponent(id)}`;
export const creationRuns = {
    create: (input: { clientKey: string; canvasId?: string; state: Record<string, unknown> }, signal?: AbortSignal) => http.post<CreationRunDetail>("/creation-runs", input, { signal }),
    get: (id: string, signal?: AbortSignal) => http.get<CreationRunDetail>(path(id), { signal }),
    list: (signal?: AbortSignal) => http.get<{ runs: CreationRun[] }>("/creation-runs", { signal }),
    save: (id: string, input: CreationGuard & { revision: number; state: Record<string, unknown>; status: CreationStatus }, signal?: AbortSignal) => http.patch<CreationRun>(path(id), input, { signal }),
    claim: (id: string, input: { expectedEpoch: number; owner: string }, signal?: AbortSignal) => http.post<CreationRun>(`${path(id)}/claim`, input, { signal }),
    heartbeat: (id: string, guard: CreationGuard, signal?: AbortSignal) => http.post<{ leaseExpiresAt: string }>(`${path(id)}/heartbeat`, guard, { signal }),
    release: (id: string, guard: CreationGuard) => http.post<{ released: boolean }>(`${path(id)}/release`, guard),
    approveProposal: (id: string, input: CreationGuard & { revision: number; proposalVersion: number; proposal: unknown; ops: CanvasOperation[] }, signal?: AbortSignal) => http.post<CreationRun>(`${path(id)}/proposal-approve`, input, { signal }),
    invalidateProposal: (id: string, input: CreationGuard & { revision: number }, signal?: AbortSignal) => http.post<CreationRun>(`${path(id)}/proposal-invalidate`, input, { signal }),
    canvas: (id: string, guard: CreationGuard, signal?: AbortSignal) => http.post<{ run: CreationRun; canvasId: string }>(`${path(id)}/canvas`, guard, { signal }),
    prepare: (id: string, input: CreationGuard & { itemKey: string; proposalVersion?: number; request: CreateTaskInput }, signal?: AbortSignal) => http.post<CreationSubmission>(`${path(id)}/submissions/prepare`, input, { signal }),
    approve: (id: string, input: CreationGuard & { submissionIds: string[] }, signal?: AbortSignal) => http.post<{ submissions: CreationSubmission[] }>(`${path(id)}/submissions/approve`, input, { signal }),
    refreshQuote: (id: string, input: CreationGuard & { submissionId: string }, signal?: AbortSignal) => http.post<CreationSubmission>(`${path(id)}/submissions/refresh`, input, { signal }),
    execute: (id: string, input: CreationGuard & { submissionId: string }, signal?: AbortSignal) => http.post<GenerationTask>(`${path(id)}/execute`, input, { signal }).then((task) => {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wallet:updated"));
        return task;
    }),
    canvasSnapshot: (id: string, signal?: AbortSignal) => http.get<{ document: CanvasProject; snapshotHash: string }>(`${path(id)}/canvas-snapshot`, { signal }),
    commitCanvas: (id: string, input: CreationGuard & { expectedSnapshotHash: string; document: CanvasProject }, signal?: AbortSignal) => http.post<{ snapshotHash: string }>(`${path(id)}/canvas-commit`, input, { signal }),
};;
