import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { clampAgentLauncherPosition, moveAgentLauncher, restoreAgentLauncherPosition } from "../src/lib/canvas/agent-launcher-position";

const viewport = { width: 1280, height: 800 };
const start = { right: 20, bottom: 20 };

test("Live2D bounds use actual rectangular dimensions when restoring and dragging", () => {
    const size = { width: 180, height: 240 };
    const small = { width: 320, height: 400 };
    expect(restoreAgentLauncherPosition('{"right":999,"bottom":999}', small, size)).toEqual({ right: 120, bottom: 140 });
    expect(moveAgentLauncher({ start, x: 0, y: 0, dragged: true }, -999, -999, small, size).position).toEqual({ right: 120, bottom: 140 });
});

test("launcher restores a valid position and defaults safely for corrupt preferences", () => {
    expect(restoreAgentLauncherPosition('{"right":240,"bottom":180}', viewport)).toEqual({ right: 240, bottom: 180 });
    for (const raw of [null, "invalid", "null", "{}", '{"right":"20","bottom":20}', '{"right":1e999,"bottom":20}']) {
        expect(restoreAgentLauncherPosition(raw, viewport)).toEqual(start);
    }
});

test("launcher stays within all four edges and clamps after a viewport shrink", () => {
    expect(clampAgentLauncherPosition({ right: -500, bottom: -500 }, viewport)).toEqual(start);
    expect(clampAgentLauncherPosition({ right: 5000, bottom: 5000 }, viewport)).toEqual({ right: 1184, bottom: 704 });
    expect(clampAgentLauncherPosition({ right: 1000, bottom: 500 }, { width: 320, height: 300 })).toEqual({ right: 224, bottom: 204 });
    expect(clampAgentLauncherPosition(start, { width: 90, height: 90 })).toEqual({ right: 7, bottom: 7 });
});

test("small pointer jitter remains a click, but dragging back to the origin remains a drag", () => {
    const gesture = { start, x: 500, y: 500, dragged: false };
    expect(moveAgentLauncher(gesture, 502, 503, viewport)).toEqual({ dragged: false, position: start });
    expect(moveAgentLauncher(gesture, 400, 450, viewport)).toEqual({ dragged: true, position: { right: 120, bottom: 70 } });
    expect(moveAgentLauncher({ ...gesture, dragged: true }, 500, 500, viewport)).toEqual({ dragged: true, position: start });
});

// Execute the production hook with a tiny hook scheduler; only React and browser
// side effects are substituted, not the pointer/click handlers being tested.
const build = await Bun.build({
    entrypoints: [new URL("../src/components/canvas/use-agent-launcher-position.ts", import.meta.url).pathname],
    target: "browser",
    format: "cjs",
    plugins: [
        {
            name: "hook-scheduler",
            setup(builder) {
                builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "test" }));
                builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const { useState, useRef, useEffect } = globalThis.hooks;", loader: "js" }));
            },
        },
    ],
});
expect(build.success).toBe(true);
const source = await build.outputs[0].text();

function harness() {
    const cells = [];
    let cursor = 0;
    let opens = 0;
    const stored = new Map();
    const listeners = new Map();
    const window = { innerWidth: 1280, innerHeight: 800, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
    const module = { exports: {} };
    const hooks = {
        useState(initial) {
            const i = cursor++;
            if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
            return [
                cells[i],
                (next) => {
                    cells[i] = typeof next === "function" ? next(cells[i]) : next;
                },
            ];
        },
        useRef(initial) {
            const i = cursor++;
            return (cells[i] ||= { current: initial });
        },
        useEffect(fn) {
            const i = cursor++;
            if (!cells[i]) {
                cells[i] = true;
                fn();
            }
        },
    };
    runInNewContext(source, { module, exports: module.exports, hooks, window, localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }, console });
    const render = () => {
        cursor = 0;
        return module.exports.useAgentLauncherPosition(() => opens++);
    };
    let current = render();
    let captured = null;
    const target = {
        setPointerCapture: (id) => {
            captured = id;
        },
        hasPointerCapture: (id) => captured === id,
        releasePointerCapture: () => {
            captured = null;
        },
    };
    return {
        fire(name, overrides = {}) {
            const event = { currentTarget: target, pointerId: 1, isPrimary: true, button: 0, clientX: 500, clientY: 500, detail: 1, preventDefault() {}, stopPropagation() {}, ...overrides };
            current.handlers[name](event);
            current = render();
        },
        resize(width, height) {
            window.innerWidth = width;
            window.innerHeight = height;
            listeners.get("resize")();
            current = render();
        },
        get state() {
            return current;
        },
        get opens() {
            return opens;
        },
        get saved() {
            return [...stored.values()].map(JSON.parse);
        },
        get captured() {
            return captured;
        },
    };
}

test("production handlers preserve click and suppress drag-release activation", () => {
    const h = harness();
    h.fire("onPointerDown");
    h.fire("onPointerMove", { clientX: 502 });
    h.fire("onPointerUp", { clientX: 502 });
    h.fire("onClick");
    expect(h.opens).toBe(1);
    h.fire("onPointerDown");
    h.fire("onPointerMove", { clientX: 400, clientY: 450 });
    expect(h.state.dragging).toBe(true);
    h.fire("onPointerUp", { clientX: 400, clientY: 450 });
    h.fire("onClick");
    expect(h.opens).toBe(1);
    expect(h.state.position).toEqual({ right: 120, bottom: 70 });
    expect(h.saved).toEqual([{ right: 120, bottom: 70 }]);
    expect(h.captured).toBe(null);
    h.fire("onClick", { detail: 0 });
    expect(h.opens).toBe(2);
    h.fire("onPointerDown");
    h.fire("onPointerUp");
    h.fire("onClick");
    expect(h.opens).toBe(3);
});

for (const ending of ["onPointerCancel", "onLostPointerCapture"]) {
    test(`production handlers stop safely on ${ending} and ignore other pointers`, () => {
        const h = harness();
        h.fire("onPointerDown", { button: 2 });
        expect(h.captured).toBe(null);
        h.fire("onPointerDown", { pointerType: "touch" });
        h.fire("onPointerMove", { pointerId: 2, clientX: 100 });
        expect(h.state.position).toEqual(start);
        h.fire("onPointerMove", { clientX: 300 });
        h.fire(ending);
        h.fire("onPointerMove", { clientX: 100 });
        h.fire("onClick");
        expect(h.state.position).toEqual({ right: 220, bottom: 20 });
        expect(h.state.dragging).toBe(false);
        expect(h.captured).toBe(null);
        expect(h.opens).toBe(0);
    });
}

test("production handlers support keyboard movement and viewport resizing", () => {
    const h = harness();
    h.fire("onKeyDown", { key: "ArrowLeft" });
    h.fire("onKeyDown", { key: "ArrowUp", shiftKey: true });
    expect(h.state.position).toEqual({ right: 30, bottom: 60 });
    h.resize(100, 100);
    expect(h.state.position).toEqual({ right: 12, bottom: 12 });
    h.fire("onClick", { detail: 0 });
    expect(h.opens).toBe(1);
});
