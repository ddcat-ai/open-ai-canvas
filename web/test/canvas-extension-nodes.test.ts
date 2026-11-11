import { describe, expect, test } from "bun:test";
import { colorGradeCssFilter, DEFAULT_COLOR_GRADE, isNeutralColorGrade } from "../src/lib/canvas/canvas-color-grade";
import { NODE_DEFAULT_SIZE, NODE_SPECS } from "../src/constant/canvas";
import { getNodeDefinition, getNodeGenerationMode, getNodeInputKind, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { migrateCanvasNodeModel } from "../src/lib/canvas/migrate-canvas-node-model";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const node = (type: string, id = type, content = ""): CanvasNodeData => ({ id, type: type as CanvasNodeData["type"], title: id, position: { x: 10, y: 20 }, width: 340, height: 240, metadata: { content } });

describe("统一画布节点模型", () => {
    test("迁移保留节点身份、原文、连接及未知插件，重复运行无改动", () => {
        const nodes = [node("markdown", "note", "# 导演笔记"), node("html", "web", "<h1>剧本</h1>"), node("svg", "shape", "<svg />"), node("chart", "data", '[{"数值":2}]'), node("plugin/custom", "plugin", "保留")];
        nodes[0].metadata = { ...nodes[0].metadata, storageKey: "resource:original", locked: true };
        const connections = [{ id: "edge", fromNodeId: "note", toNodeId: "plugin" }];
        const original = { nodes, connections, title: "作品" };
        const migrated = migrateCanvasNodeModel(original);
        expect(migrated.nodes.slice(0, 4).map((item) => item.type)).toEqual(["text", "text", "text", "text"]);
        expect(migrated.nodes.map((item) => item.metadata?.content)).toEqual(nodes.map((item) => item.metadata?.content));
        expect(migrated.nodes[0].metadata).toMatchObject({ textFormat: "markdown", storageKey: "resource:original", locked: true });
        expect(migrated.nodes[1].metadata?.textFormat).toBe("plain");
        expect(migrated.connections).toBe(connections);
        expect(migrated.nodes[4]).toBe(nodes[4]);
        expect(original.nodes[0].type).toBe("markdown");
        expect(migrateCanvasNodeModel(migrated)).toBe(migrated);
        for (const type of ["markdown", "html", "svg", "chart", "compare"]) expect(getNodeDefinition(type as CanvasNodeData["type"])).toBeUndefined();
    });
    test("对比节点迁为文本引用，原始两张图与连线不丢失", () => {
        const a = node("image", "a", "first.png"),
            b = node("image", "b", "second.png"),
            compare = node("compare", "ab");
        const connections = [
            { id: "b-ab", fromNodeId: "b", toNodeId: "ab" },
            { id: "a-ab", fromNodeId: "a", toNodeId: "ab" },
        ];
        const migrated = migrateCanvasNodeModel({ nodes: [a, b, compare], connections });
        expect(migrated.nodes[2].metadata?.content).toBe("对比参考：\nb @[node:b]\na @[node:a]");
        expect(migrated.nodes[0]).toBe(a);
        expect(migrated.nodes[1]).toBe(b);
        expect(migrated.connections).toBe(connections);
        expect(migrated.nodes[2]).toMatchObject({ id: "ab", type: "text", position: compare.position });
    });
    test("其余图片工具仍保留注册和输入合同", () => {
        for (const type of [CanvasNodeType.Panorama, CanvasNodeType.ColorGrade]) {
            expect(NODE_DEFAULT_SIZE[type]).toBeDefined();
            expect(NODE_SPECS[type]).toBeDefined();
            expect(getNodeGenerationMode(node(type))).toBeNull();
            expect(getNodeInputKind(type)).toBe("image");
        }
        expect(getNodeResourceKind(node(CanvasNodeType.Panorama))).toBeNull();
        expect(getNodeResourceKind(node(CanvasNodeType.ColorGrade))).toBe("image");
    });
});

test("基础调色保留中性值和统一滤镜", () => {
    expect(isNeutralColorGrade(DEFAULT_COLOR_GRADE)).toBe(true);
    expect(isNeutralColorGrade({ ...DEFAULT_COLOR_GRADE, brightness: 120 })).toBe(false);
    expect(colorGradeCssFilter({ brightness: 110, contrast: 90, saturate: 120, hueRotate: -15 })).toBe("brightness(110%) contrast(90%) saturate(120%) hue-rotate(-15deg)");
});
