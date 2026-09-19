import { describe, expect, test } from "bun:test";

import { CANVAS_BUILTIN_TEMPLATES, canvasTemplateFromDocument, instantiateCanvasTemplate } from "../src/lib/canvas/canvas-templates";

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

    test("模板媒体会在插入画布时解析为可渲染 URL", () => {
        const template = canvasTemplateFromDocument({
            id: "template-1",
            title: "带媒体模板",
            description: "",
            category: "image",
            tags: [],
            source: "published",
            version: 1,
            mediaURL: (mediaId) => `/api/canvas-templates/template-1/media/${mediaId}`,
            document: {
                schema: "yingce.canvas-template",
                schemaVersion: 2,
                nodes: [{ id: "image-1", type: "image", title: "预览", position: { x: 0, y: 0 }, width: 400, height: 400, metadata: { templateMediaIds: ["preview.webp"] } }],
                connections: [],
                media: [{ id: "preview.webp", nodeId: "image-1", kind: "image" }],
            },
        });
        const [node] = template.createGraph({ x: 0, y: 0 }).nodes;
        expect(node.metadata?.templateMediaURL).toBe("/api/canvas-templates/template-1/media/preview.webp");
        expect(node.metadata?.templateMediaKind).toBe("image");
    });
});
