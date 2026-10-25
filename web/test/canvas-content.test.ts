import { expect, test } from "bun:test";
import { canvasContentHash, sameCanvasContent } from "@/lib/canvas/canvas-content";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

test("empty active conversation converges after server removes null", async () => {
    const local = {
        id: "canvas",
        title: "QA",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        createdAt: "2026-10-23",
        updatedAt: "2026-10-23",
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    } as CanvasProject;
    const remote = { ...local, activeChatId: undefined, revision: 2 };
    expect(sameCanvasContent(local, remote)).toBe(true);
    expect(await canvasContentHash(local)).toBe(await canvasContentHash(remote));
    const selected = { ...local, activeChatId: "chat-1" };
    expect(sameCanvasContent(selected, remote)).toBe(false);
    expect(await canvasContentHash(selected)).not.toBe(await canvasContentHash(remote));
});
