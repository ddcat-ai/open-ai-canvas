import { expect, test } from "bun:test";
import { createCanvasAgentPlan } from "../src/lib/canvas/canvas-agent-plan";
import { recoverCanvasAgentSessions } from "../src/lib/canvas/canvas-agent-session-recovery";

test("recovers plans during initial session hydration", () => {
    const plan = { ...createCanvasAgentPlan([{ id: "write", function: { name: "canvas_apply_ops" } }]), status: "running" as const };
    const sessions = [{ id: "s1", title: "对话", messages: [{ id: "m1", role: "tool", title: "执行中", text: "", detail: { status: "running", plan } }] }] as never;
    const recovered = recoverCanvasAgentSessions(sessions);
    expect((recovered[0].messages[0].detail as any).plan.stopReason).toBe("recovered");
    expect(recovered[0].messages[0].title).toBe("计划已恢复，等待继续");
});

test("does not recover the same plan twice", () => {
    const plan = { ...createCanvasAgentPlan([{ id: "write", function: { name: "canvas_apply_ops" } }]), status: "running" as const };
    const session = [{ id: "s1", title: "对话", messages: [{ id: "m1", role: "tool", title: "执行中", text: "", detail: { status: "running", plan } }] }] as never;
    const once = recoverCanvasAgentSessions(session);
    const twice = recoverCanvasAgentSessions(once);
    expect(twice).toEqual(once);
    expect((twice[0].messages[0].detail as any).plan.stopReason).toBe("recovered");
});

test("keeps plans and messages isolated across sessions", () => {
    const make = (id: string) => ({ id, title: id, messages: [{ id: `${id}-message`, role: "tool", title: "执行中", text: "", detail: { status: "running", plan: { ...createCanvasAgentPlan([{ id, function: { name: "canvas_apply_ops" } }]), id: `plan-${id}`, status: "running" } } }] });
    const recovered = recoverCanvasAgentSessions([make("project-a"), make("project-b")] as never);
    expect(recovered.map((session) => session.id)).toEqual(["project-a", "project-b"]);
    expect((recovered[0].messages[0].detail as any).plan.id).toBe("plan-project-a");
    expect((recovered[1].messages[0].detail as any).plan.id).toBe("plan-project-b");
});
