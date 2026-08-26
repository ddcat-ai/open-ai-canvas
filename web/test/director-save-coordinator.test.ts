import { describe, expect, it } from "bun:test";
import { scopedStorageKey } from "../src/lib/user-scope";
import type { DirectorScene } from "../src/types/director";
import { createDirectorSaveCoordinator, type DirectorDraftEnvelope, type DirectorFlushRequest, type FlushFunction, type StorageLike } from "../src/lib/canvas/director/director-save";

class MemoryStorage implements StorageLike {
    private readonly values = new Map<string, string>();
    throwOnGet = false;
    throwOnSet = false;
    throwOnRemove = false;

    getItem(key: string): string | null {
        if (this.throwOnGet) throw new Error("get failed");
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.throwOnSet) throw new Error("set failed");
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        if (this.throwOnRemove) throw new Error("remove failed");
        this.values.delete(key);
    }

    keys(): string[] {
        return [...this.values.keys()];
    }
}

class ManualScheduler {
    private callbacks = new Map<number, () => void>();
    private id = 0;

    schedule(callback: () => void, delay: number): unknown {
        const handle = this.id++;
        this.callbacks.set(handle, callback);
        return handle;
    }

    cancel(handle: unknown): void {
        this.callbacks.delete(handle as number);
    }

    runAll(): void {
        for (const cb of this.callbacks.values()) {
            cb();
        }
        this.callbacks.clear();
    }

    size(): number {
        return this.callbacks.size;
    }
}

function deferred() {
    let res: (() => void) | null = null;
    let rej: ((err: unknown) => void) | null = null;
    const p = new Promise<void>((resolve, reject) => {
        res = resolve;
        rej = reject;
    });
    return {
        promise: p,
        resolve: () => res?.(),
        reject: (err: unknown) => rej?.(err),
    };
}

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
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
});

const makeEnvelope = (overrides: Partial<DirectorDraftEnvelope> = {}): DirectorDraftEnvelope => {
    const scene = overrides.scene ?? makeScene();
    return {
        schemaVersion: 1,
        sceneId: scene.id,
        baseUpdatedAt: scene.updatedAt,
        revision: 1,
        savedAt: 1000,
        ...overrides,
        scene,
    };
};

/** Serializes a complete valid envelope after breaking only the target fields. */
const corruptEnvelope = (corrupt: (envelope: Record<string, unknown>) => void, overrides: Partial<DirectorDraftEnvelope> = {}): string => {
    const envelope: Record<string, unknown> = {
        ...makeEnvelope(overrides),
    };
    corrupt(envelope);
    return JSON.stringify(envelope);
};

/**
 * Serializes a complete valid envelope, splicing raw JSON number tokens that
 * JSON.stringify cannot express (for example 1e999 parsing back as Infinity).
 */
const rawEnvelopeWith = (rawFields: Record<string, string>): string => {
    const envelope: Record<string, unknown> = { ...makeEnvelope() };
    const entries = Object.entries(envelope)
        .filter(([field]) => !(field in rawFields))
        .map(([field, value]) => JSON.stringify(field) + ":" + JSON.stringify(value));
    const rawEntries = Object.entries(rawFields).map(([field, token]) => JSON.stringify(field) + ":" + token);
    return "{" + [...entries, ...rawEntries].join(",") + "}";
};

type HarnessOptions = {
    scope?: string;
    storage?: MemoryStorage;
    initialScene?: DirectorScene;
};

const createHarness = (options: HarnessOptions = {}) => {
    const scope = options.scope ?? "user-a";
    const storage = options.storage ?? new MemoryStorage();
    const initialScene = options.initialScene ?? makeScene();
    const scheduler = new ManualScheduler();
    let now = 1000;
    const requests: DirectorFlushRequest[] = [];
    let flushBehavior: FlushFunction = async () => undefined;

    const flushFn: FlushFunction = async (request) => {
        requests.push(structuredClone(request));
        await flushBehavior(request);
    };

    const coord = createDirectorSaveCoordinator({
        initialScene,
        scope,
        storage,
        flush: flushFn,
        now: () => now++,
        debounceMs: 25,
        schedule: (callback) => scheduler.schedule(callback, 0),
        cancelSchedule: (handle) => scheduler.cancel(handle),
    });

    const key = scopedStorageKey("director-scene-draft:" + initialScene.id, scope);

    const editedScene = (overrides: Partial<DirectorScene> = {}) => {
        const scene = makeScene(overrides);
        coord.edit(scene);
        return scene;
    };

    const readEnvelope = (id: string = initialScene.id): DirectorDraftEnvelope | null => {
        const readKey = id === initialScene.id ? key : scopedStorageKey("director-scene-draft:" + id, scope);
        const raw = storage.getItem(readKey);
        return raw === null ? null : (JSON.parse(raw) as DirectorDraftEnvelope);
    };

    const writeRaw = (raw: string): void => {
        storage.setItem(key, raw);
    };

    const setFlushBehavior = (next: FlushFunction): void => {
        flushBehavior = next;
    };

    const flushMicrotasks = async (): Promise<void> => {
        scheduler.runAll();
        await Promise.resolve();
        await Promise.resolve();
    };

    const dispose = (): void => {
        coord.dispose();
        scheduler.runAll();
    };

    return {
        storage,
        scheduler,
        now: () => now,
        requests,
        coord,
        scope,
        key,
        editedScene,
        readEnvelope,
        writeRaw,
        setFlushBehavior,
        flushMicrotasks,
        dispose,
    };
};

describe("DirectorSaveCoordinator", () => {
    describe("01 initial", () => {
        it("should be saved with revision 0, no draft, no recovery", () => {
            const h = createHarness();
            const snap = h.coord.getSnapshot();
            expect(snap.status).toBe("saved");
            expect(snap.revision).toBe(0);
            expect(snap.confirmedRevision).toBe(0);
            expect(snap.draftStored).toBe(false);
            expect(h.readEnvelope("scene-1")).toBeNull();
        });
    });

    describe("02 edit", () => {
        it("should write to fixed scoped key with complete envelope", () => {
            const h = createHarness();
            const s = h.editedScene({ title: "Edited" });
            expect(s).toBeDefined();
            const env = h.readEnvelope("scene-1");
            expect(env).toMatchObject({
                schemaVersion: 1,
                sceneId: "scene-1",
                scene: expect.objectContaining({ title: "Edited" }),
            });
            expect(env.revision).toBe(1);
            expect(env.savedAt).toBeDefined();
        });
    });

    describe("03 continuous edit", () => {
        it("should monotonically increase revision and reflect latest scene", () => {
            const h = createHarness();
            h.editedScene({ title: "v1" });
            h.editedScene({ title: "v2" });
            const snap = h.coord.getSnapshot();
            expect(snap.revision).toBe(2);
            expect(snap.status).toBe("dirty");
        });
    });

    describe("04 invalid scene id", () => {
        it("should reject edit with wrong scene id and leave status unchanged", () => {
            const h = createHarness();
            const originalStatus = h.coord.getSnapshot().status;
            const result = h.coord.edit(makeScene({ id: "wrong" }));
            expect(result).toBe(false);
            expect(h.coord.getSnapshot().status).toBe(originalStatus);
        });
    });

    describe("05 storage set fail", () => {
        it("should keep memory edit, set error status, draftStored false", () => {
            const h = createHarness();
            h.storage.throwOnSet = true;
            const scene = makeScene({ title: "memory-only" });
            expect(h.coord.edit(scene)).toBe(true);
            const snap = h.coord.getSnapshot();
            expect(snap.scene.title).toBe("memory-only");
            expect(snap.status).toBe("error");
            expect(snap.draftStored).toBe(false);
        });
    });

    describe("06 debounce", () => {
        it("should debounce multiple edits and flush only the latest scene", async () => {
            const h = createHarness();
            h.editedScene({ title: "a" });
            h.editedScene({ title: "b" });
            expect(h.scheduler.size()).toBe(1);
            await h.flushMicrotasks();
            expect(h.requests).toHaveLength(1);
            expect(h.requests[0]?.scene.title).toBe("b");
        });
    });

    describe("07 concurrent flush", () => {
        it("should return the same Promise for concurrent flushLatest calls", async () => {
            const h = createHarness();
            h.editedScene({ title: "dirty" });
            const first = h.coord.flushLatest();
            const second = h.coord.flushLatest();
            expect(first).toBe(second);
            expect(await first).toBe(true);
        });
    });

    describe("08 concurrent edit during flush", () => {
        it("should send second request in drain and update remaining draft base", async () => {
            const h = createHarness();
            const first = deferred();
            const second = deferred();
            let flushCall = 0;
            h.setFlushBehavior(async () => {
                const gate = flushCall++ === 0 ? first : second;
                await gate.promise;
            });

            const firstScene = h.editedScene({
                title: "first",
                updatedAt: "2026-01-01T00:00:01.000Z",
            });
            const pending = h.coord.flushLatest();
            expect(h.requests).toHaveLength(1);
            expect(h.requests[0]?.scene.title).toBe("first");

            h.editedScene({
                title: "second",
                updatedAt: "2026-01-01T00:00:02.000Z",
            });
            first.resolve();
            await h.flushMicrotasks();

            expect(h.requests).toHaveLength(2);
            expect(h.requests[1]?.scene.title).toBe("second");
            expect(h.coord.getSnapshot().status).not.toBe("saved");
            expect(h.readEnvelope()?.baseUpdatedAt).toBe(firstScene.updatedAt);

            second.resolve();
            expect(await pending).toBe(true);
            expect(h.coord.getSnapshot()).toMatchObject({
                revision: 2,
                confirmedRevision: 2,
                status: "saved",
            });
            expect(h.readEnvelope()).toBeNull();
        });
    });

    describe("09 remote fail", () => {
        it("should keep safe draft and set error status", async () => {
            const h = createHarness();
            h.editedScene({ title: "remote-fail" });
            h.setFlushBehavior(async () => {
                throw new Error("remote failed");
            });
            expect(await h.coord.flushLatest()).toBe(false);
            expect(h.requests).toHaveLength(1);
            expect(h.coord.getSnapshot()).toMatchObject({
                status: "error",
                draftStored: true,
                confirmedRevision: 0,
            });
            expect(h.readEnvelope()?.scene.title).toBe("remote-fail");
        });
    });

    describe("10 retry", () => {
        it("should re-call remote and clear draft on success", async () => {
            const h = createHarness();
            await h.coord.flushLatest();
            const result = await h.coord.retry();
            expect(result).toBe(true);
            expect(h.readEnvelope("scene-1")).toBeNull();
        });
    });

    describe("11 successful flush clears only matching draft", () => {
        it("should clear only draft with confirmed revision", async () => {
            const h = createHarness();
            h.editedScene();
            await h.coord.flushLatest();
            expect(h.readEnvelope("scene-1")).toBeNull();
        });
    });

    describe("12 remove fail keeps saved status", () => {
        it("should stay saved but keep the draft when removeItem fails", async () => {
            const h = createHarness();
            h.editedScene({ title: "remove-fail" });
            expect(h.coord.getSnapshot().draftStored).toBe(true);
            expect(h.readEnvelope()?.revision).toBe(1);

            h.storage.throwOnRemove = true;
            expect(await h.coord.flushLatest()).toBe(true);

            expect(h.coord.getSnapshot()).toMatchObject({
                status: "saved",
                confirmedRevision: 1,
                draftStored: true,
            });

            h.storage.throwOnRemove = false;
            expect(h.readEnvelope()?.revision).toBe(1);
        });
    });

    describe("13 malformed JSON", () => {
        it("should reject unparsable JSON stored under the scoped key", () => {
            const h = createHarness();
            h.writeRaw("invalid json");
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("14 wrong schema", () => {
        it("should reject a candidate whose schemaVersion is not 1", () => {
            const h = createHarness();

            h.writeRaw(JSON.stringify(makeEnvelope()));
            expect(h.coord.restoreCandidate()).not.toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.schemaVersion = 2;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("15 wrong sceneId", () => {
        it("should reject a candidate whose sceneId does not match the scene", () => {
            const h = createHarness();

            h.writeRaw(JSON.stringify(makeEnvelope()));
            expect(h.coord.restoreCandidate()).not.toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.sceneId = "scene-other";
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("16 missing baseUpdatedAt", () => {
        it("should reject a candidate whose baseUpdatedAt is missing or not a string", () => {
            const h = createHarness();

            h.writeRaw(JSON.stringify(makeEnvelope()));
            expect(h.coord.restoreCandidate()).not.toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    delete envelope.baseUpdatedAt;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.baseUpdatedAt = 20250101;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("17 invalid scene shape", () => {
        it("should reject a candidate whose scene fails DirectorScene validation", () => {
            const h = createHarness();

            h.writeRaw(JSON.stringify(makeEnvelope()));
            expect(h.coord.restoreCandidate()).not.toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.scene = { ...makeScene(), gridVisible: "yes" };
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.scene = { ...makeScene(), shots: "none" };
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.scene = makeScene({ id: "scene-2" });
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("18 invalid revision/savedAt", () => {
        it("should reject negative, fractional, unsafe revision and non-finite savedAt", () => {
            const h = createHarness();

            h.writeRaw(JSON.stringify(makeEnvelope()));
            expect(h.coord.restoreCandidate()).not.toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.revision = -1;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.revision = 1.5;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(
                corruptEnvelope((envelope) => {
                    envelope.revision = Number.MAX_SAFE_INTEGER + 1;
                }),
            );
            expect(h.coord.restoreCandidate()).toBeNull();

            h.writeRaw(rawEnvelopeWith({ savedAt: "1e999" }));
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("19 scope isolation", () => {
        it("should only read the draft written under its own user scope", () => {
            const storage = new MemoryStorage();
            const userA = createHarness({ scope: "user-a", storage });
            const userB = createHarness({ scope: "user-b", storage });
            expect(userA.key).not.toBe(userB.key);

            userB.writeRaw(
                JSON.stringify(
                    makeEnvelope({
                        revision: 3,
                        scene: makeScene({ title: "user-b draft" }),
                    }),
                ),
            );

            expect(storage.keys()).toEqual([userB.key]);
            expect(userA.coord.restoreCandidate()).toBeNull();

            const candidate = userB.coord.restoreCandidate();
            expect(candidate).not.toBeNull();
            expect(candidate?.revision).toBe(3);
            expect(candidate?.scene.title).toBe("user-b draft");
        });
    });

    describe("20 explicitRestore success", () => {
        it("should succeed and set dirty status", () => {
            const h = createHarness();
            const env = {
                schemaVersion: 1,
                sceneId: "scene-1",
                baseUpdatedAt: "2025",
                scene: makeScene(),
                revision: 5,
                savedAt: 100,
            };
            const result = h.coord.explicitRestore(env);
            expect(result).toBe(true);
            expect(h.coord.getSnapshot().status).toBe("dirty");
            expect(h.coord.getSnapshot().revision).toBe(5);
        });
    });

    describe("21 invalid explicitRestore", () => {
        it("should reject older or invalid envelope", () => {
            const h = createHarness();
            h.editedScene();
            const env = { ...h.readEnvelope("scene-1")!, revision: 0 };
            const result = h.coord.explicitRestore(env);
            expect(result).toBe(false);
        });
    });

    describe("22 clean prepareClose", () => {
        it("should immediately return close when confirmedRevision equals current", async () => {
            const h = createHarness();
            const result = await h.coord.prepareClose();
            expect(result).toBe("close");
        });
    });

    describe("23 dirty prepareClose", () => {
        it("should reuse promise and return close on success", async () => {
            const h = createHarness();
            h.editedScene();
            const p1 = h.coord.prepareClose();
            const p2 = h.coord.prepareClose();
            expect(p1).toBe(p2);
            const result = await p1;
            expect(result).toBe("close");
        });
    });

    describe("24 prepareClose fail with draft", () => {
        it("should return offer-draft-exit when remote fails but the draft is safe", async () => {
            const h = createHarness();
            h.editedScene({ title: "close-fail" });
            expect(h.coord.getSnapshot().draftStored).toBe(true);
            expect(h.readEnvelope()?.scene.title).toBe("close-fail");

            h.setFlushBehavior(async () => {
                throw new Error("remote rejected");
            });

            expect(await h.coord.prepareClose()).toBe("offer-draft-exit");
            expect(h.coord.getSnapshot().status).toBe("error");
            expect(h.readEnvelope()?.scene.title).toBe("close-fail");
        });
    });

    describe("25 prepareClose full fail", () => {
        it("should return stay when both the local draft and the remote flush fail", async () => {
            const h = createHarness();
            h.storage.throwOnSet = true;
            h.setFlushBehavior(async () => {
                throw new Error("remote rejected");
            });

            h.editedScene({ title: "no-draft" });
            expect(h.coord.getSnapshot().draftStored).toBe(false);

            expect(await h.coord.prepareClose()).toBe("stay");
            expect(h.coord.getSnapshot().status).toBe("error");
            expect(h.readEnvelope()).toBeNull();
        });
    });

    describe("26 handlePageHide", () => {
        it("should reuse one in-flight promise and flush the latest revision", async () => {
            const h = createHarness();
            const gate = deferred();
            h.setFlushBehavior(async () => {
                await gate.promise;
            });

            h.editedScene({ title: "hide-1" });
            h.editedScene({ title: "hide-2" });
            expect(h.coord.getSnapshot().revision).toBe(2);

            const p1 = h.coord.handlePageHide();
            const p2 = h.coord.handlePageHide();
            expect(p1).toBe(p2);

            expect(h.requests).toHaveLength(1);
            expect(h.requests[0]?.revision).toBe(2);
            expect(h.requests[0]?.scene.title).toBe("hide-2");

            gate.resolve();
            expect(await p1).toBe(true);
            expect(h.coord.getSnapshot()).toMatchObject({
                status: "saved",
                confirmedRevision: 2,
            });
        });
    });

    describe("27 dispose", () => {
        it("should cancel debounce, stop notifying, and reject later edits", () => {
            const h = createHarness();
            const seen: string[] = [];
            h.coord.onStatusChange((status) => {
                seen.push(status);
            });

            expect(h.coord.edit(makeScene({ title: "before-dispose" }))).toBe(true);
            expect(seen).toEqual(["dirty"]);
            expect(h.scheduler.size()).toBe(1);

            h.coord.dispose();
            expect(h.scheduler.size()).toBe(0);

            expect(h.coord.edit(makeScene({ title: "after-dispose" }))).toBe(false);
            expect(seen).toEqual(["dirty"]);
        });
    });

    describe("28 dispose in-flight", () => {
        it("should not mark saved or confirmed when disposed mid-flight", async () => {
            const h = createHarness();
            const gate = deferred();
            h.setFlushBehavior(async () => {
                await gate.promise;
            });

            h.editedScene({ title: "in-flight" });
            const pending = h.coord.flushLatest();
            expect(h.requests).toHaveLength(1);
            expect(h.requests[0]?.revision).toBe(1);

            h.coord.dispose();
            gate.resolve();

            expect(await pending).toBe(false);
            const snap = h.coord.getSnapshot();
            expect(snap.confirmedRevision).toBe(0);
            expect(snap.status).not.toBe("saved");
        });
    });

    describe("29 unsubscribe", () => {
        it("should only remove the unsubscribed listener", () => {
            const h = createHarness();
            const first: string[] = [];
            const second: string[] = [];

            const unsubscribeFirst = h.coord.onStatusChange((status) => {
                first.push(status);
            });
            h.coord.onStatusChange((status) => {
                second.push(status);
            });

            unsubscribeFirst();
            h.editedScene({ title: "notify-second" });

            expect(first).toEqual([]);
            expect(second).toEqual(["dirty"]);
        });
    });

    describe("30 restoreCandidate on get fail", () => {
        it("should return null when storage.getItem throws", () => {
            const h = createHarness();
            h.storage.throwOnGet = true;
            expect(h.coord.restoreCandidate()).toBeNull();
        });
    });

    describe("31 discardDraft", () => {
        it("should really delete the scoped draft so the same candidate never returns", () => {
            const h = createHarness();
            h.editedScene({ title: "discard-me" });
            expect(h.coord.restoreCandidate()?.scene.title).toBe("discard-me");

            expect(h.coord.discardDraft()).toBe(true);

            expect(h.readEnvelope()).toBeNull();
            expect(h.storage.keys()).toEqual([]);
            expect(h.coord.restoreCandidate()).toBeNull();
            expect(h.coord.getSnapshot().draftStored).toBe(false);
        });

        it("should report false and keep the draft when removal fails", () => {
            const h = createHarness();
            h.editedScene({ title: "keep-me" });

            h.storage.throwOnRemove = true;
            expect(h.coord.discardDraft()).toBe(false);

            h.storage.throwOnRemove = false;
            expect(h.readEnvelope()?.scene.title).toBe("keep-me");
            expect(h.coord.getSnapshot().draftStored).toBe(true);
        });

        it("should leave a later flush unaffected after discarding", async () => {
            const h = createHarness();
            h.editedScene({ title: "discard-then-save" });
            expect(h.coord.discardDraft()).toBe(true);

            expect(await h.coord.flushLatest()).toBe(true);
            expect(h.requests).toHaveLength(1);
            expect(h.requests[0]?.scene.title).toBe("discard-then-save");
            expect(h.coord.getSnapshot()).toMatchObject({
                status: "saved",
                confirmedRevision: 1,
            });
        });
    });

    describe("32 restore then save", () => {
        it("should adopt the restored revision and confirm it on the next flush", async () => {
            const storage = new MemoryStorage();
            const previousSession = createHarness({ storage });
            previousSession.editedScene({
                title: "recovered",
                updatedAt: "2026-02-02T00:00:00.000Z",
            });
            previousSession.dispose();

            const reopened = createHarness({ storage });
            const candidate = reopened.coord.restoreCandidate();
            expect(candidate?.scene.title).toBe("recovered");
            expect(candidate).not.toBeNull();
            if (!candidate) return;

            expect(reopened.coord.explicitRestore(candidate)).toBe(true);
            expect(reopened.coord.getSnapshot()).toMatchObject({
                status: "dirty",
                revision: candidate.revision,
                confirmedRevision: 0,
                draftStored: true,
            });

            expect(await reopened.coord.flushLatest()).toBe(true);
            expect(reopened.requests).toHaveLength(1);
            expect(reopened.requests[0]?.scene.title).toBe("recovered");
            expect(reopened.requests[0]?.revision).toBe(candidate.revision);
            expect(reopened.coord.getSnapshot()).toMatchObject({
                status: "saved",
                confirmedRevision: candidate.revision,
            });
            expect(reopened.readEnvelope()).toBeNull();
        });
    });

    describe("33 status subscription and retry", () => {
        it("should publish the full dirty/saving/error/saved sequence across a failed then retried save", async () => {
            const h = createHarness();
            const seen: string[] = [];
            h.coord.onStatusChange((status) => {
                seen.push(status);
            });

            let failNext = true;
            h.setFlushBehavior(async () => {
                if (failNext) throw new Error("remote rejected");
            });

            h.editedScene({ title: "retry-me" });
            expect(seen).toEqual(["dirty"]);

            expect(await h.coord.flushLatest()).toBe(false);
            expect(seen).toEqual(["dirty", "saving", "error"]);
            expect(h.coord.getSnapshot().draftStored).toBe(true);

            failNext = false;
            expect(await h.coord.retry()).toBe(true);
            expect(seen).toEqual(["dirty", "saving", "error", "saving", "saved"]);
            expect(h.requests).toHaveLength(2);
            expect(h.requests[1]?.scene.title).toBe("retry-me");
            expect(h.coord.getSnapshot()).toMatchObject({
                status: "saved",
                confirmedRevision: 1,
                draftStored: false,
            });
            expect(h.readEnvelope()).toBeNull();
        });

        it("should stop publishing to a listener that unsubscribed mid-sequence", async () => {
            const h = createHarness();
            const seen: string[] = [];
            const unsubscribe = h.coord.onStatusChange((status) => {
                seen.push(status);
            });

            h.editedScene({ title: "unsub" });
            expect(seen).toEqual(["dirty"]);

            unsubscribe();
            expect(await h.coord.flushLatest()).toBe(true);
            expect(seen).toEqual(["dirty"]);
            expect(h.coord.getSnapshot().status).toBe("saved");
        });
    });

    describe("34 close decisions", () => {
        it("should return close without any request when nothing is dirty", async () => {
            const h = createHarness();
            expect(await h.coord.prepareClose()).toBe("close");
            expect(h.requests).toEqual([]);
        });

        it("should reuse one close promise while a slow save is in flight", async () => {
            const h = createHarness();
            const gate = deferred();
            h.setFlushBehavior(async () => {
                await gate.promise;
            });

            h.editedScene({ title: "slow-close" });
            const first = h.coord.prepareClose();
            const second = h.coord.prepareClose();
            expect(first).toBe(second);
            expect(h.requests).toHaveLength(1);

            gate.resolve();
            expect(await first).toBe("close");
            expect(h.coord.getSnapshot().confirmedRevision).toBe(1);
        });

        it("should offer draft exit when the remote fails but the draft survives", async () => {
            const h = createHarness();
            h.editedScene({ title: "draft-exit" });
            h.setFlushBehavior(async () => {
                throw new Error("remote rejected");
            });

            expect(await h.coord.prepareClose()).toBe("offer-draft-exit");
            expect(h.readEnvelope()?.scene.title).toBe("draft-exit");

            // 放弃草稿后再次关闭仍要如实回报失败，不能因为草稿消失就假装可以安全退出。
            expect(h.coord.discardDraft()).toBe(true);
            expect(await h.coord.prepareClose()).toBe("stay");
        });

        it("should stay when neither the remote nor the local draft succeeded", async () => {
            const h = createHarness();
            h.storage.throwOnSet = true;
            h.setFlushBehavior(async () => {
                throw new Error("remote rejected");
            });

            h.editedScene({ title: "no-escape" });
            expect(await h.coord.prepareClose()).toBe("stay");
            expect(h.coord.getSnapshot().draftStored).toBe(false);
        });

        it("should stay after dispose instead of reporting a clean close", async () => {
            const h = createHarness();
            h.editedScene({ title: "disposed-close" });
            h.coord.dispose();
            expect(await h.coord.prepareClose()).toBe("stay");
        });
    });

    describe("35 snapshot visible inside the status callback", () => {
        it("should expose a fully confirmed, draft-free snapshot when saved fires", async () => {
            const h = createHarness();
            const observed: Array<{ status: string; revision: number; confirmedRevision: number; draftStored: boolean }> = [];

            h.coord.onStatusChange((status) => {
                // 订阅方只拿到 status 是不够的：必须能在回调内读到完整的新快照。
                const snap = h.coord.getSnapshot();
                observed.push({
                    status,
                    revision: snap.revision,
                    confirmedRevision: snap.confirmedRevision,
                    draftStored: snap.draftStored,
                });
            });

            h.editedScene({ title: "observe-me" });
            expect(await h.coord.flushLatest()).toBe(true);

            expect(observed.map((entry) => entry.status)).toEqual(["dirty", "saving", "saved"]);

            const saved = observed.at(-1);
            expect(saved?.confirmedRevision).toBe(1);
            expect(saved?.revision).toBe(1);
            expect(saved?.confirmedRevision).toBe(saved?.revision);
            expect(saved?.draftStored).toBe(false);
        });

        it("should expose the retained draft and unconfirmed revision when error fires", async () => {
            const h = createHarness();
            let seen: { confirmedRevision: number; revision: number; draftStored: boolean } | null = null;

            h.setFlushBehavior(async () => {
                throw new Error("remote rejected");
            });
            h.coord.onStatusChange((status) => {
                if (status !== "error") return;
                const snap = h.coord.getSnapshot();
                seen = {
                    confirmedRevision: snap.confirmedRevision,
                    revision: snap.revision,
                    draftStored: snap.draftStored,
                };
            });

            h.editedScene({ title: "error-observe" });
            expect(await h.coord.flushLatest()).toBe(false);

            expect(seen).not.toBeNull();
            expect(seen?.revision).toBe(1);
            expect(seen?.confirmedRevision).toBe(0);
            expect(seen?.draftStored).toBe(true);
        });

        it("should reach a saved snapshot through the debounced schedule, not just explicit flush", async () => {
            const h = createHarness();
            let savedSnapshot: { confirmedRevision: number; revision: number; draftStored: boolean } | null = null;

            h.coord.onStatusChange((status) => {
                if (status !== "saved") return;
                const snap = h.coord.getSnapshot();
                savedSnapshot = {
                    confirmedRevision: snap.confirmedRevision,
                    revision: snap.revision,
                    draftStored: snap.draftStored,
                };
            });

            h.editedScene({ title: "debounced" });
            expect(h.scheduler.size()).toBe(1);

            // 自动 debounce 保存完成后，订阅方看到的必须已经是确认态。
            await h.flushMicrotasks();

            expect(h.requests).toHaveLength(1);
            expect(savedSnapshot).not.toBeNull();
            expect(savedSnapshot?.confirmedRevision).toBe(1);
            expect(savedSnapshot?.revision).toBe(1);
            expect(savedSnapshot?.draftStored).toBe(false);
            expect(h.readEnvelope()).toBeNull();
        });
    });
});
