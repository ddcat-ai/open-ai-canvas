import { afterEach, describe, expect, test } from "bun:test";
import { useThemeStore } from "../src/stores/use-theme-store";
import { useCanvasThemeStore } from "../src/stores/canvas/use-canvas-theme-store";

const workspaceBefore = useThemeStore.getState().theme;
const canvasBefore = useCanvasThemeStore.getState().theme;
afterEach(() => {
    useThemeStore.setState({ theme: workspaceBefore });
    useCanvasThemeStore.setState({ theme: canvasBefore, active: false });
});

describe("canvas theme ownership", () => {
    test("editing the canvas theme never mutates the workspace preference", () => {
        useThemeStore.setState({ theme: "light" });
        useCanvasThemeStore.setState({ active: true });
        useCanvasThemeStore.getState().setTheme("dark");
        expect(useThemeStore.getState().theme).toBe("light");
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
        useCanvasThemeStore.setState({ active: false });
        expect(useThemeStore.getState().theme).toBe("light");
    });
    test("workspace switches cannot change canvas preference", () => {
        useCanvasThemeStore.setState({ theme: "light" });
        useThemeStore.getState().setTheme("dark");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("rejects malformed canvas themes", () => {
        useCanvasThemeStore.setState({ theme: "light", active: true });
        useCanvasThemeStore.getState().setTheme("invalid" as "light");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("persistence source contract excludes transient route state", async () => {
        const source = await Bun.file(new URL("../src/stores/canvas/use-canvas-theme-store.ts", import.meta.url)).text();
        expect(source).toContain('partialize: ({ theme }) => ({ theme })');
    });
});
