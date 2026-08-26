import { describe, expect, it } from "bun:test";

import { isPortraitImageInput, reconcilePortraitClearanceInputBindings, swapPortraitClearanceDirectBindings } from "@/lib/portrait-clearance/input-bindings";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function image(id: string, metadata: CanvasNodeData["metadata"] = {}) {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 420, height: 236, metadata: { content: `data:image/png;base64,${id}`, ...metadata } } satisfies CanvasNodeData;
}

function connection(id: string, fromNodeId: string, toNodeId = "clearance") {
    return { id, fromNodeId, toNodeId } satisfies CanvasConnection;
}

describe("portrait clearance input bindings", () => {
    it("preserves existing roles, fills new connections deterministically, and removes stale ids", () => {
        const nodes = [image("a"), image("b"), image("c")];
        const bindings = reconcilePortraitClearanceInputBindings("direct-compare", "clearance", [connection("conn-2", "b"), connection("conn-1", "a"), connection("conn-3", "c")], nodes, [{ nodeId: "b", role: "reference" }, { nodeId: "missing", role: "query" }]);
        expect(bindings).toEqual([{ nodeId: "b", role: "reference" }, { nodeId: "a", role: "query" }]);
    });

    it("uses candidate roles for additional network inputs and swaps only A/B", () => {
        const nodes = [image("a"), image("b"), image("c")];
        const bindings = reconcilePortraitClearanceInputBindings("network-search", "clearance", [connection("1", "a"), connection("2", "b"), connection("3", "c")], nodes);
        expect(bindings).toEqual([{ nodeId: "a", role: "query" }, { nodeId: "b", role: "candidate" }, { nodeId: "c", role: "candidate" }]);
        expect(swapPortraitClearanceDirectBindings([{ nodeId: "a", role: "query" }, { nodeId: "b", role: "reference" }, { nodeId: "c", role: "candidate" }])).toEqual([{ nodeId: "a", role: "reference" }, { nodeId: "b", role: "query" }, { nodeId: "c", role: "candidate" }]);
    });

    it("accepts a persisted storage key as usable image data but rejects empty image nodes", () => {
        expect(isPortraitImageInput(image("storage", { content: undefined, storageKey: "image:user:one" }))).toBe(true);
        expect(isPortraitImageInput(image("empty", { content: undefined }))).toBe(false);
    });
});
