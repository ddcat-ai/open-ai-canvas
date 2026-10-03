import { expect, test } from "bun:test";
import { refreshPublicAppearance } from "../src/services/appearance-bootstrap";
import { DEFAULT_CANVAS_APPEARANCE } from "../src/lib/canvas/agent-appearance";
import { commitPublicAppearance, normalizePublicAppearance, useAppearanceStore } from "../src/stores/use-appearance-store";

test("appearance refresh synchronizes a changed Agent name", async () => {
    const saved = normalizePublicAppearance({ canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "星河助手" } });
    await refreshPublicAppearance(async () => saved);
    expect(useAppearanceStore.getState().appearance.canvas?.agentName).toBe("星河助手");
});

test("failed refresh preserves the last saved identity", async () => {
    commitPublicAppearance({ canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "影绘" } });
    await refreshPublicAppearance(async () => {
        throw new Error("offline");
    });
    expect(useAppearanceStore.getState().appearance.canvas?.agentName).toBe("影绘");
});

test("focus and visibility refresh share one request", async () => {
    let resolve!: (value: ReturnType<typeof normalizePublicAppearance>) => void;
    let calls = 0;
    const pending = new Promise<ReturnType<typeof normalizePublicAppearance>>((done) => {
        resolve = done;
    });
    const fetchAppearance = async () => {
        calls++;
        return pending;
    };
    const first = refreshPublicAppearance(fetchAppearance);
    const second = refreshPublicAppearance(fetchAppearance);
    expect(calls).toBe(1);
    resolve(normalizePublicAppearance({ canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "星河助手" } }));
    await Promise.all([first, second]);
    expect(useAppearanceStore.getState().appearance.canvas?.agentName).toBe("星河助手");
});

test("a late refresh cannot overwrite a newer admin save", async () => {
    let resolve!: (value: ReturnType<typeof normalizePublicAppearance>) => void;
    const pending = new Promise<ReturnType<typeof normalizePublicAppearance>>((done) => {
        resolve = done;
    });
    const refresh = refreshPublicAppearance(async () => pending);
    commitPublicAppearance({ canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "最新名称" } });
    resolve(normalizePublicAppearance({ canvas: { ...DEFAULT_CANVAS_APPEARANCE, agentName: "旧名称" } }));
    await refresh;
    expect(useAppearanceStore.getState().appearance.canvas?.agentName).toBe("最新名称");
});
