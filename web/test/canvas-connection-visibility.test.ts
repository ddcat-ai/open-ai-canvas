import { describe, expect, test } from "bun:test";

import { filterCanvasDisplayConnections } from "@/lib/canvas/canvas-connection-visibility";
import { CanvasNodeType, type CanvasDisplayConnection } from "@/types/canvas";

function connection(id: string, fromNodeId: string, toNodeId: string): CanvasDisplayConnection {
    const node = (nodeId: string) => ({ id: nodeId, type: CanvasNodeType.Text, title: nodeId, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: {} });
    return { connection: { id, fromNodeId, toNodeId }, from: node(fromNodeId), to: node(toNodeId) };
}

describe("canvas connection visibility", () => {
    const connections = [connection("a", "one", "two"), connection("b", "two", "three"), connection("c", "four", "five")];

    test("keeps all connections when disabled", () => {
        expect(filterCanvasDisplayConnections(connections, { enabled: false })).toEqual(connections);
    });

    test("shows only direct connections for hovered and selected nodes", () => {
        expect(filterCanvasDisplayConnections(connections, { enabled: true, hoveredNodeId: "three", selectedNodeIds: new Set(["one"]) }).map((item) => item.connection.id)).toEqual(["a", "b"]);
    });

    test("keeps an explicitly selected connection visible", () => {
        expect(filterCanvasDisplayConnections(connections, { enabled: true, selectedConnectionId: "c" }).map((item) => item.connection.id)).toEqual(["c"]);
    });
});
