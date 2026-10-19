import { expect, test } from "bun:test";
import { spriteBusinessBinding, spriteCompletedTransition, spriteFrame, spriteLookFrame, validateSpritePet, type SpritePet } from "../src/lib/canvas/sprite-pet";

export function fixture(): SpritePet {
    return {
        displayName: "测试",
        spritesheetPath: "atlas.png",
        atlasWidth: 64,
        atlasHeight: 64,
        frameWidth: 16,
        frameHeight: 16,
        neutralFrame: 0,
        lookStartFrame: 0,
        lookDirections: 16,
        speed: 1,
        sleepAfterSeconds: 0,
        author: "",
        source: "",
        license: "",
        actions: [
            { id: "idle", label: "待机", row: 0, start: 0, frames: 4, fps: 4, loop: true },
            { id: "done", label: "完成", row: 1, start: 1, frames: 3, fps: 3, loop: false },
        ],
        bindings: { idle: "idle", working: "", waiting: "", failed: "", completed: "done", moveLeft: "", moveRight: "", hover: "", greeting: "", sleep: "", wake: "" },
    };
}
test("business state beats idle and never mistakes cancellation or disconnection for completion", () => {
    expect(spriteBusinessBinding({ status: "running", approvalPending: true })).toBe("waiting");
    expect(spriteBusinessBinding({ status: "running", waitingUser: true })).toBe("waiting");
    expect(spriteBusinessBinding({ status: "running", connected: false })).toBe("working");
    expect(spriteBusinessBinding({ status: "completed", cleanupPending: true })).toBe("working");
    expect(spriteBusinessBinding({ status: "failed" })).toBe("failed");
    for (const status of ["cancelled", "rejected", "completed"]) expect(spriteBusinessBinding({ status })).toBe("idle");
});
test("completion is a same-run transition, excluding reloads, replay and reconnect", () => {
    expect(spriteCompletedTransition(undefined, { runId: "a", status: "completed" })).toBe(false);
    expect(spriteCompletedTransition({ runId: "a", status: "running" }, { runId: "a", status: "completed" })).toBe(true);
    expect(spriteCompletedTransition({ runId: "a", status: "completed" }, { runId: "a", status: "completed" })).toBe(false);
    expect(spriteCompletedTransition({ runId: "a", status: "running" }, { runId: "b", status: "completed" })).toBe(false);
    expect(spriteCompletedTransition({ runId: "a", status: "running", connected: false }, { runId: "a", status: "completed", connected: true })).toBe(false);
    expect(spriteCompletedTransition({ runId: "a", status: "completed", cleanupPending: true }, { runId: "a", status: "completed", cleanupPending: false })).toBe(true);
});
test("per-action bounds avoid blank columns and non-loop actions hold their last frame", () => {
    const p = fixture();
    expect(spriteFrame(p, p.actions[0], 1000)).toBe(0);
    expect(spriteFrame(p, p.actions[1], 0)).toBe(5);
    expect(spriteFrame(p, p.actions[1], 999999)).toBe(7);
    p.speed = 2;
    expect(spriteFrame(p, p.actions[0], 250)).toBe(2);
});
test("look frames follow clockwise from up and stay neutral in the dead zone", () => {
    const p = fixture();
    expect(spriteLookFrame(p, 0, -100)).toBe(0);
    expect(spriteLookFrame(p, 100, 0)).toBe(4);
    expect(spriteLookFrame(p, 0, 100)).toBe(8);
    expect(spriteLookFrame(p, -100, 0)).toBe(12);
    expect(spriteLookFrame(p, 2, 2)).toBe(0);
});
test("custom layout validates bindings, frame ranges and sleep prerequisites", () => {
    const p = fixture();
    expect(validateSpritePet(p)).toBe("");
    p.actions[1].frames = 4;
    expect(validateSpritePet(p)).not.toBe("");
    p.actions[1].frames = 3;
    p.bindings.working = "missing";
    expect(validateSpritePet(p)).not.toBe("");
    p.bindings.working = "";
    p.sleepAfterSeconds = 300;
    expect(validateSpritePet(p)).not.toBe("");
    p.bindings.sleep = "idle";
    expect(validateSpritePet(p)).toBe("");
});
