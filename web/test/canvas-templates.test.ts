import { describe, expect, test } from "bun:test";

import { CANVAS_BUILTIN_TEMPLATES, instantiateCanvasTemplate } from "../src/lib/canvas/canvas-templates";

describe("画布模板库", () => {
    test("每个内置模板都能生成至少一个节点和合法连线", () => {
        for (const template of CANVAS_BUILTIN_TEMPLATES) {
            const graph = instantiateCanvasTemplate(template, { x: 0, y: 0 });
            const nodeIds = new Set(graph.nodes.map((node) => node.id));
            expect(graph.nodes.length).toBeGreaterThan(0);
            expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
            expect(graph.connections.every((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId))).toBe(true);
        }
    });

    test("两次导入同一模板不会复用节点或连线 id", () => {
        const template = CANVAS_BUILTIN_TEMPLATES[0];
        const first = instantiateCanvasTemplate(template, { x: 0, y: 0 });
        const second = instantiateCanvasTemplate(template, { x: 0, y: 0 });
        const firstIds = new Set([...first.nodes.map((node) => node.id), ...first.connections.map((connection) => connection.id)]);
        const secondIds = [...second.nodes.map((node) => node.id), ...second.connections.map((connection) => connection.id)];
        expect(secondIds.some((id) => firstIds.has(id))).toBe(false);
    });
});
