import { describe, expect, it } from "bun:test";
import type { DirectorScene } from "../src/types/director";
import { createDirectorSaveCoordinator, type DirectorDraftEnvelope, type DirectorSaveSnapshot } from "../src/lib/canvas/director/director-save";
import {
    describeDirectorSaveStatus,
    directorSaveProgress,
    idleDirectorSaveProgress,
    resolveDirectorCloseOutcome,
    resolveDirectorDraftStorage,
    shouldBlockDirectorUnload,
    shouldOfferDirectorDraftRecovery,
    unavailableDirectorDraftStorage,
} from "../src/lib/canvas/director/director-save-wiring";

const makeScene = (overrides: Partial<DirectorScene> = {}): DirectorScene => ({
    id: "scene-1",
    version: 1,
    title: "Test Scene",
    background: "#000",
    environmentIntensity: 0.5,
    gridVisible: true,
    objects: [],
    cameras: [],
    lights: [],
    shots: [],
    activeShotId: "shot-1",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
});

const makeSnapshot = (overrides: Partial<DirectorSaveSnapshot> = {}): DirectorSaveSnapshot => ({
    scene: makeScene(),
    revision: 0,
    confirmedRevision: 0,
    status: "saved",
    draftStored: false,
    ...overrides,
});

const makeEnvelope = (overrides: Partial<DirectorDraftEnvelope> = {}): DirectorDraftEnvelope => {
    const scene = overrides.scene ?? makeScene();
    return {
        schemaVersion: 1,
        sceneId: scene.id,
        baseUpdatedAt: "2025-01-01T00:00:00.000Z",
        revision: 1,
        savedAt: 1000,
        ...overrides,
        scene,
    };
};

describe("describeDirectorSaveStatus", () => {
    it("should report a quiet idle state only when everything is confirmed", () => {
        const indicator = describeDirectorSaveStatus(makeSnapshot({ status: "saved", revision: 3, confirmedRevision: 3 }));
        expect(indicator).toEqual({ label: "已保存", tone: "idle", retryable: false, busy: false });
    });

    it("should stay retryable when the status is saved but a revision is unconfirmed", () => {
        const indicator = describeDirectorSaveStatus(makeSnapshot({ status: "saved", revision: 4, confirmedRevision: 3 }));
        expect(indicator.label).toBe("有未保存修改");
        expect(indicator.tone).toBe("pending");
        expect(indicator.retryable).toBe(true);
    });

    it("should mark saving as busy and not retryable", () => {
        const indicator = describeDirectorSaveStatus(makeSnapshot({ status: "saving", revision: 2, confirmedRevision: 1 }));
        expect(indicator).toEqual({ label: "正在保存…", tone: "pending", retryable: false, busy: true });
    });

    it("should distinguish an error with a safe draft from one without", () => {
        const withDraft = describeDirectorSaveStatus(makeSnapshot({ status: "error", revision: 2, confirmedRevision: 1, draftStored: true }));
        const withoutDraft = describeDirectorSaveStatus(makeSnapshot({ status: "error", revision: 2, confirmedRevision: 1, draftStored: false }));

        expect(withDraft.label).toBe("保存失败 · 本地草稿已保留");
        expect(withoutDraft.label).toBe("保存失败 · 本地草稿也未写入");
        expect(withDraft.tone).toBe("danger");
        expect(withoutDraft.tone).toBe("danger");
        expect(withDraft.retryable).toBe(true);
        expect(withoutDraft.retryable).toBe(true);
    });

    it("should surface dirty as pending and retryable", () => {
        const indicator = describeDirectorSaveStatus(makeSnapshot({ status: "dirty", revision: 1, confirmedRevision: 0, draftStored: true }));
        expect(indicator.label).toBe("有未保存修改");
        expect(indicator.retryable).toBe(true);
        expect(indicator.busy).toBe(false);
    });
});

describe("shouldOfferDirectorDraftRecovery", () => {
    it("should offer recovery when the draft is newer than the authoritative scene", () => {
        const authoritativeScene = makeScene({ updatedAt: "2025-01-01T00:00:00.000Z" });
        const candidate = makeEnvelope({
            baseUpdatedAt: "2025-01-01T00:00:00.000Z",
            scene: makeScene({ updatedAt: "2025-06-01T00:00:00.000Z" }),
        });

        expect(shouldOfferDirectorDraftRecovery({ candidate, authoritativeScene })).toBe(true);
    });

    it("should not offer recovery when the project already holds that content", () => {
        const authoritativeScene = makeScene({ updatedAt: "2025-06-01T00:00:00.000Z" });
        const candidate = makeEnvelope({
            baseUpdatedAt: "2025-06-01T00:00:00.000Z",
            scene: makeScene({ updatedAt: "2025-06-01T00:00:00.000Z" }),
        });

        expect(shouldOfferDirectorDraftRecovery({ candidate, authoritativeScene })).toBe(false);
    });

    it("should not offer a stale draft whose base fell behind the authoritative scene", () => {
        const authoritativeScene = makeScene({ updatedAt: "2025-09-01T00:00:00.000Z" });
        const candidate = makeEnvelope({
            baseUpdatedAt: "2025-01-01T00:00:00.000Z",
            scene: makeScene({ updatedAt: "2025-06-01T00:00:00.000Z" }),
        });

        expect(shouldOfferDirectorDraftRecovery({ candidate, authoritativeScene })).toBe(false);
    });

    it("should reject a candidate belonging to another scene", () => {
        const authoritativeScene = makeScene({ id: "scene-1" });
        const candidate = makeEnvelope({
            sceneId: "scene-2",
            scene: makeScene({ id: "scene-2", updatedAt: "2025-06-01T00:00:00.000Z" }),
        });

        expect(shouldOfferDirectorDraftRecovery({ candidate, authoritativeScene })).toBe(false);
    });

    it("should never prompt without both a candidate and an authoritative scene", () => {
        expect(shouldOfferDirectorDraftRecovery({ candidate: null, authoritativeScene: makeScene() })).toBe(false);
        expect(shouldOfferDirectorDraftRecovery({ candidate: makeEnvelope(), authoritativeScene: null })).toBe(false);
    });
});

describe("resolveDirectorCloseOutcome", () => {
    it("should close outright on a clean decision", () => {
        expect(resolveDirectorCloseOutcome("close")).toEqual({ kind: "close" });
    });

    it("should require confirmation and name the safe draft on offer-draft-exit", () => {
        const outcome = resolveDirectorCloseOutcome("offer-draft-exit");
        expect(outcome.kind).toBe("confirm-draft-exit");
        if (outcome.kind !== "confirm-draft-exit") return;
        expect(outcome.message).toContain("远端保存失败");
        expect(outcome.message).toContain("本地草稿");
    });

    it("should block the exit and explain why on stay", () => {
        const outcome = resolveDirectorCloseOutcome("stay");
        expect(outcome.kind).toBe("blocked");
        if (outcome.kind !== "blocked") return;
        expect(outcome.message).toContain("重试");
    });
});

describe("shouldBlockDirectorUnload", () => {
    it("should block while any revision is unconfirmed", () => {
        expect(shouldBlockDirectorUnload(makeSnapshot({ revision: 2, confirmedRevision: 1 }))).toBe(true);
    });

    it("should block an error state that has no safe draft", () => {
        expect(shouldBlockDirectorUnload(makeSnapshot({ status: "error", revision: 1, confirmedRevision: 1, draftStored: false }))).toBe(true);
    });

    it("should let an error state with a safe draft through", () => {
        expect(shouldBlockDirectorUnload(makeSnapshot({ status: "error", revision: 1, confirmedRevision: 1, draftStored: true }))).toBe(false);
    });

    it("should not block a fully confirmed session", () => {
        expect(shouldBlockDirectorUnload(makeSnapshot({ revision: 5, confirmedRevision: 5 }))).toBe(false);
    });
});

describe("directorSaveProgress", () => {
    it("should project every progress field and drop the scene", () => {
        const progress = directorSaveProgress(makeSnapshot({ status: "saving", revision: 4, confirmedRevision: 2, draftStored: true }));

        expect(progress).toEqual({
            status: "saving",
            revision: 4,
            confirmedRevision: 2,
            draftStored: true,
        });
        expect("scene" in progress).toBe(false);
    });

    it("should start idle with nothing unconfirmed and no draft", () => {
        expect(idleDirectorSaveProgress).toEqual({
            status: "saved",
            revision: 0,
            confirmedRevision: 0,
            draftStored: false,
        });
        expect(describeDirectorSaveStatus(idleDirectorSaveProgress).retryable).toBe(false);
        expect(shouldBlockDirectorUnload(idleDirectorSaveProgress)).toBe(false);
    });
});

describe("resolveDirectorDraftStorage", () => {
    it("should delegate to the provided storage when it is usable", () => {
        const values = new Map<string, string>();
        const storage = resolveDirectorDraftStorage(
            () =>
                ({
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => {
                        values.set(key, value);
                    },
                    removeItem: (key: string) => {
                        values.delete(key);
                    },
                }) as unknown as Storage,
        );

        storage.setItem("draft", "payload");
        expect(storage.getItem("draft")).toBe("payload");
        storage.removeItem("draft");
        expect(storage.getItem("draft")).toBeNull();
    });

    it("should fall back to the unavailable implementation when the getter throws", () => {
        const storage = resolveDirectorDraftStorage(() => {
            throw new Error("localStorage blocked");
        });
        expect(storage).toBe(unavailableDirectorDraftStorage);
    });

    it("should fall back to the unavailable implementation when there is no storage", () => {
        expect(resolveDirectorDraftStorage(() => null)).toBe(unavailableDirectorDraftStorage);
        expect(resolveDirectorDraftStorage(() => undefined)).toBe(unavailableDirectorDraftStorage);
    });
});

describe("unavailableDirectorDraftStorage", () => {
    it("should read empty and refuse to write, so no draft is ever claimed as safe", () => {
        expect(unavailableDirectorDraftStorage.getItem("draft")).toBeNull();
        expect(() => unavailableDirectorDraftStorage.setItem("draft", "payload")).toThrow();
        expect(() => unavailableDirectorDraftStorage.removeItem("draft")).toThrow();
    });

    it("should drive the coordinator to draftStored false and a stay decision", async () => {
        const coordinator = createDirectorSaveCoordinator({
            initialScene: makeScene(),
            scope: "user-a",
            storage: unavailableDirectorDraftStorage,
            flush: async () => {
                throw new Error("remote rejected");
            },
            schedule: () => 0,
            cancelSchedule: () => undefined,
        });

        expect(coordinator.edit(makeScene({ title: "no-draft" }))).toBe(true);
        expect(coordinator.getSnapshot().draftStored).toBe(false);
        expect(coordinator.restoreCandidate()).toBeNull();

        // 没有安全草稿时必须留在工作台，不能谎称「下次可恢复」。
        expect(await coordinator.prepareClose()).toBe("stay");
    });
});
