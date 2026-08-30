import { describe, expect, it } from "bun:test";

import { connectedNodeCenterFromEdgeDrop } from "@/lib/canvas/canvas-connected-node-placement";

describe("connectedNodeCenterFromEdgeDrop", () => {
    it("uses an output drop as the new target node's left-edge midpoint", () => {
        expect(connectedNodeCenterFromEdgeDrop({ x: 900, y: 320 }, { width: 720, height: 405 }, "source")).toEqual({ x: 1260, y: 320 });
    });

    it("uses an input drop as the new source node's right-edge midpoint", () => {
        expect(connectedNodeCenterFromEdgeDrop({ x: 900, y: 320 }, { width: 340, height: 120 }, "target")).toEqual({ x: 730, y: 320 });
    });
});
