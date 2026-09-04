import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createEditorCommandRegistry, getEditorCommandRegistry } from "../src/lib/timeline/editor-commands";
import type { TimelineProject } from "../src/types/timeline";

const golden = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/commands.golden.json"), "utf8")) as {
    base: TimelineProject;
    cases: Array<{ name: string; commands: Array<{ op: string; payload: unknown }>; expected: TimelineProject }>;
};

describe("editor command registry (golden file)", () => {
    for (const c of golden.cases) {
        test(c.name, () => {
            const registry = createEditorCommandRegistry();
            const result = c.commands.reduce<TimelineProject>((state, cmd) => registry.apply(state, cmd), golden.base);
            expect(result).toEqual(c.expected);
        });
    }

    test("knownOps lists the 12 golden ops", () => {
        expect(createEditorCommandRegistry().knownOps().sort()).toEqual(
            ["addClip", "addSubtitle", "moveClip", "rebuildSubtitleClips", "removeClip", "removeSubtitle", "setClipProperty", "splitClip", "trimClip", "addTrack", "removeTrack", "setTrackFlag"].sort(),
        );
    });
});

describe("editor command registry (immutability)", () => {
    test("apply returns a new state and never mutates the input", () => {
        const registry = createEditorCommandRegistry();
        const before = JSON.stringify(golden.base);
        const result = registry.apply(golden.base, { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        expect(result).not.toBe(golden.base);
        expect(result.clips).not.toBe(golden.base.clips);
        expect(JSON.stringify(golden.base)).toBe(before);
    });

    test("rejected commands leave the input untouched", () => {
        const registry = createEditorCommandRegistry();
        const before = JSON.stringify(golden.base);
        expect(() => registry.apply(golden.base, { op: "removeClip", payload: { id: "nope" } })).toThrow();
        expect(JSON.stringify(golden.base)).toBe(before);
    });
});

describe("editor command registry (fail-closed payload validation)", () => {
    const registry = createEditorCommandRegistry();

    test("unknown op throws", () => {
        expect(() => registry.apply(golden.base, { op: "explodeEverything", payload: {} })).toThrow(/unknown edit command op "explodeEverything"/);
    });

    test("malformed command object throws", () => {
        expect(() => registry.apply(golden.base, null as unknown as { op: string })).toThrow(/must be \{ op, payload \}/);
        expect(() => registry.apply(golden.base, { payload: {} } as unknown as { op: string })).toThrow(/must be \{ op, payload \}/);
    });

    test("addClip rejects missing fields, negative start, subtitle kind, missing track", () => {
        expect(() => registry.apply(golden.base, { op: "addClip", payload: { clip: { id: "x", kind: "video", nodeId: "n", trackId: "video-1", startMs: 0 } } })).toThrow(/durationMs/);
        expect(() => registry.apply(golden.base, { op: "addClip", payload: { clip: { id: "x", kind: "video", nodeId: "n", trackId: "video-1", startMs: -1, durationMs: 1000 } } })).toThrow(/startMs/);
        expect(() => registry.apply(golden.base, { op: "addClip", payload: { clip: { id: "x", kind: "subtitle", nodeId: "n", trackId: "subtitle-1", startMs: 0, durationMs: 1000 } } })).toThrow(/addSubtitle/);
        expect(() => registry.apply(golden.base, { op: "addClip", payload: { clip: { id: "x", kind: "video", nodeId: "n", trackId: "missing-track", startMs: 0, durationMs: 1000 } } })).toThrow(/does not exist/);
    });

    test("moveClip rejects unknown clip, negative start, missing track", () => {
        expect(() => registry.apply(golden.base, { op: "moveClip", payload: { id: "nope", startMs: 0 } })).toThrow(/does not exist/);
        expect(() => registry.apply(golden.base, { op: "moveClip", payload: { id: "clip-a", startMs: -100 } })).toThrow(/startMs/);
        expect(() => registry.apply(golden.base, { op: "moveClip", payload: { id: "clip-a", startMs: 0, trackId: "nope" } })).toThrow(/does not exist/);
    });

    test("trimClip rejects over-source and negative values", () => {
        expect(() => registry.apply(golden.base, { op: "trimClip", payload: { id: "clip-b", durationMs: 9000 } })).toThrow(/exceeds sourceDurationMs/);
        expect(() => registry.apply(golden.base, { op: "trimClip", payload: { id: "clip-b", startMs: 0, durationMs: 1000, sourceStartMs: 7500 } })).toThrow(/exceeds sourceDurationMs/);
        expect(() => registry.apply(golden.base, { op: "trimClip", payload: { id: "clip-b", durationMs: 0 } })).toThrow(/positive/);
        expect(() => registry.apply(golden.base, { op: "trimClip", payload: { id: "nope", durationMs: 1000 } })).toThrow(/does not exist/);
    });

    test("splitClip rejects out-of-range split points", () => {
        expect(() => registry.apply(golden.base, { op: "splitClip", payload: { id: "clip-a", splitAtMs: 0 } })).toThrow(/strictly inside/);
        expect(() => registry.apply(golden.base, { op: "splitClip", payload: { id: "clip-a", splitAtMs: 5000 } })).toThrow(/strictly inside/);
        expect(() => registry.apply(golden.base, { op: "splitClip", payload: { id: "clip-a", splitAtMs: 9999 } })).toThrow(/strictly inside/);
        expect(() => registry.apply(golden.base, { op: "splitClip", payload: { id: "nope", splitAtMs: 1000 } })).toThrow(/does not exist/);
    });

    test("setClipProperty rejects structural fields and empty patch", () => {
        expect(() => registry.apply(golden.base, { op: "setClipProperty", payload: { id: "clip-a", patch: { trackId: "video-2" } } })).toThrow(/not editable/);
        expect(() => registry.apply(golden.base, { op: "setClipProperty", payload: { id: "clip-a", patch: { startMs: 100 } } })).toThrow(/not editable/);
        expect(() => registry.apply(golden.base, { op: "setClipProperty", payload: { id: "clip-a", patch: {} } })).toThrow(/must not be empty/);
        expect(() => registry.apply(golden.base, { op: "setClipProperty", payload: { id: "nope", patch: { volume: 0.5 } } })).toThrow(/does not exist/);
    });

    test("addSubtitle rejects non-subtitle kind; removeSubtitle rejects non-subtitle clip", () => {
        expect(() => registry.apply(golden.base, { op: "addSubtitle", payload: { clip: { id: "x", kind: "video", nodeId: "n", trackId: "video-1", startMs: 0, durationMs: 1000 } } })).toThrow(/must be "subtitle"/);
        expect(() => registry.apply(golden.base, { op: "removeSubtitle", payload: { id: "clip-a" } })).toThrow(/not a subtitle clip/);
        expect(() => registry.apply(golden.base, { op: "removeSubtitle", payload: { id: "nope" } })).toThrow(/does not exist/);
    });

    test("rebuildSubtitleClips rejects bad entries, non-subtitle track, and no subtitle track", () => {
        const entries = (extra: Record<string, unknown>) => [{ index: 0, startMs: 0, endMs: 1000, text: "ok", ...extra }];
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: entries({ index: -1 }) } })).toThrow(/non-negative integer/);
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: entries({ endMs: 0 }) } })).toThrow(/endMs must be greater than startMs/);
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: entries({ text: 42 }) } })).toThrow(/text must be a string/);
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: [...entries({}), ...entries({ index: 0 })] } })).toThrow(/duplicate entry index/);
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: [], trackId: "video-1" } })).toThrow(/not a subtitle track/);
        const noSubtitle = { ...golden.base, tracks: golden.base.tracks.filter((t) => t.kind !== "subtitle") };
        expect(() => registry.apply(noSubtitle, { op: "rebuildSubtitleClips", payload: { nodeId: "node-a", entries: [] } })).toThrow(/no subtitle track/);
    });

    test("rebuildSubtitleClips requires a non-empty nodeId", () => {
        expect(() => registry.apply(golden.base, { op: "rebuildSubtitleClips", payload: { nodeId: "", entries: [] } })).toThrow(/nodeId/);
    });
});

describe("editor command registry (plugin extension)", () => {
    test("plugins can register custom ops and override builtin ops", () => {
        const registry = createEditorCommandRegistry();
        registry.register("pluginStamp", (state, payload) => {
            const { tag } = payload as { tag: string };
            return { ...state, clips: state.clips.map((c) => (c.id === tag ? { ...c, title: `stamped:${tag}` } : c)) };
        });
        const stamped = registry.apply(golden.base, { op: "pluginStamp", payload: { tag: "clip-a" } });
        expect(stamped.clips.find((c) => c.id === "clip-a")?.title).toBe("stamped:clip-a");
        expect(registry.knownOps()).toContain("pluginStamp");

        // 覆盖内建 op：注册同名 handler 后以新语义执行（宿主不阻止，插件目录测试负责语义回归）
        const before = registry.apply(golden.base, { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        registry.register("moveClip", (state, payload) => {
            const { id, startMs } = payload as { id: string; startMs: number };
            return { ...state, clips: state.clips.map((c) => (c.id === id ? { ...c, startMs: startMs + 1000 } : c)) };
        });
        const after = registry.apply(golden.base, { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        expect(before.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        expect(after.clips.find((c) => c.id === "clip-a")?.startMs).toBe(3000);
    });

    test("shared singleton registry is stable across getters", () => {
        expect(getEditorCommandRegistry()).toBe(getEditorCommandRegistry());
        expect(getEditorCommandRegistry().knownOps()).toContain("trimClip");
    });
});

describe("editor command registry (addTrack)", () => {
    const registry = createEditorCommandRegistry();

    test("adds a track with deterministic id/order/label and keeps existing state", () => {
        const before = JSON.stringify(golden.base);
        const result = registry.apply(golden.base, { op: "addTrack", payload: { kind: "audio" } });
        const added = result.tracks[result.tracks.length - 1];
        expect(added.kind).toBe("audio");
        expect(added.order).toBe(Math.max(...golden.base.tracks.map((t) => t.order)) + 1);
        expect(added.label).toBeTruthy();
        expect(added.id).toBeTruthy();
        expect(result.tracks.length).toBe(golden.base.tracks.length + 1);
        expect(result.clips).toEqual(golden.base.clips);
        expect(JSON.stringify(golden.base)).toBe(before);
    });

    test("same input always appends the same track (determinism for undo/redo replay)", () => {
        const first = registry.apply(golden.base, { op: "addTrack", payload: { kind: "video" } });
        const second = registry.apply(golden.base, { op: "addTrack", payload: { kind: "video" } });
        expect(first).toEqual(second);
    });

    test("rejects unknown kinds", () => {
        expect(() => registry.apply(golden.base, { op: "addTrack", payload: { kind: "burn" } })).toThrow(/kind/);
    });
});

describe("editor command registry (removeTrack)", () => {
    const registry = createEditorCommandRegistry();

    test("removes the track and cascades its clips, keeps the rest", () => {
        const base = golden.base;
        // 先加一条 audio 轨作为可删目标（默认夹具每 kind 仅 1 条，受最后一条守卫保护）。
        const withExtra = registry.apply(base, { op: "addTrack", payload: { kind: "audio" } });
        const victim = withExtra.tracks[withExtra.tracks.length - 1];
        const seeded = {
            ...withExtra,
            clips: [...withExtra.clips, { ...withExtra.clips[0], id: "clip-on-removed", trackId: victim.id }],
        };
        const result = registry.apply(seeded, { op: "removeTrack", payload: { trackId: victim.id } });
        expect(result.tracks.some((t) => t.id === victim.id)).toBe(false);
        expect(result.clips.some((c) => c.trackId === victim.id)).toBe(false);
        expect(result.clips.some((c) => c.id === "clip-on-removed")).toBe(false);
        expect(result.tracks.length).toBe(withExtra.tracks.length - 1);
        expect(result.clips.length).toBe(seeded.clips.length - 1);
    });

    test("refuses to remove the last track of a kind", () => {
        const base = golden.base;
        const target = base.tracks.find((t) => base.tracks.filter((x) => x.kind === t.kind).length === 1);
        expect(target).toBeTruthy();
        expect(() => registry.apply(base, { op: "removeTrack", payload: { trackId: target.id } })).toThrow(/last/);
    });

    test("rejects an unknown track id", () => {
        expect(() =>
            registry.apply(golden.base, { op: "removeTrack", payload: { trackId: "no-such-track" } }),
        ).toThrow(/track/);
    });
});

// ---------------------------------------------------------------------------
// setTrackFlag
// ---------------------------------------------------------------------------
describe("editor command registry (setTrackFlag)", () => {
    const registry = createEditorCommandRegistry();

    test("sets visible/muted on the target track only (fail-closed on flag whitelist)", () => {
        const base = golden.base;
        const targetId = base.tracks[0].id;
        const result = registry.apply(base, { op: "setTrackFlag", payload: { trackId: targetId, flag: "visible", value: false } });
        const target = result.tracks.find((t) => t.id === targetId)!;
        expect(target.visible).toBe(false);
        // 非目标轨道不受影响。
        for (const t of result.tracks) {
            if (t.id !== targetId) expect(t.visible).not.toBe(false);
        }
        // 输入不被修改（apply 返回新状态，不改动传入 base）。
        expect(base.tracks.find((t) => t.id === targetId)!.visible).toBeUndefined();
    });

    test("sets muted flag independently of visible", () => {
        const result = registry.apply(golden.base, {
            op: "setTrackFlag",
            payload: { trackId: golden.base.tracks[0].id, flag: "muted", value: true },
        });
        expect(result.tracks[0].muted).toBe(true);
    });

    test("rejects unknown track, unknown flag, and non-boolean value", () => {
        expect(() =>
            registry.apply(golden.base, { op: "setTrackFlag", payload: { trackId: "no-such-track", flag: "visible", value: false } }),
        ).toThrow(/track/);
        expect(() =>
            registry.apply(golden.base, { op: "setTrackFlag", payload: { trackId: golden.base.tracks[0].id, flag: "locked", value: true } }),
        ).toThrow(/flag/);
        expect(() =>
            registry.apply(golden.base, { op: "setTrackFlag", payload: { trackId: golden.base.tracks[0].id, flag: "visible", value: "on" } }),
        ).toThrow(/boolean/);
    });
});
