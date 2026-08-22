import { describe, expect, test } from "bun:test";

import { parseChartSource } from "../src/components/canvas/nodes/chart-node";
import { colorGradeCssFilter, DEFAULT_COLOR_GRADE, isNeutralColorGrade } from "../src/lib/canvas/canvas-color-grade";
import { NODE_DEFAULT_SIZE, NODE_SPECS } from "../src/constant/canvas";
import { getNodeGenerationMode, getNodeInputKind, getNodeLabel, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const EXTENSION_TYPES = [
    CanvasNodeType.Markdown,
    CanvasNodeType.Svg,
    CanvasNodeType.Html,
    CanvasNodeType.Panorama,
    CanvasNodeType.Compare,
    CanvasNodeType.Chart,
    CanvasNodeType.ColorGrade,
] as const;

function node(type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: `${type}-1`, type, title: "", position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("扩展节点注册完整性", () => {
    test("7 个扩展节点在四张表里都有登记", () => {
        EXTENSION_TYPES.forEach((type) => {
            expect(getNodeLabel(type), `${type} 缺少注册表定义`).toBeTruthy();
            expect(NODE_DEFAULT_SIZE[type], `${type} 缺少默认尺寸`).toBeTruthy();
            expect(NODE_SPECS[type], `${type} 缺少节点规格`).toBeTruthy();
        });
    });

    test("展示节点不参与生成，自身不发起生成行为", () => {
        EXTENSION_TYPES.forEach((type) => {
            expect(getNodeGenerationMode(node(type)), `${type} 不应有生成模式`).toBeNull();
        });
    });
});

describe("扩展节点的素材与输入判据", () => {
    test("文本类扩展节点有内容才算素材", () => {
        [CanvasNodeType.Markdown, CanvasNodeType.Svg, CanvasNodeType.Html].forEach((type) => {
            expect(getNodeResourceKind(node(type, { content: "x" }))).toBe("text");
            expect(getNodeResourceKind(node(type, {}))).toBeNull();
            expect(getNodeInputKind(type)).toBe("text");
        });
    });

    test("查看器类节点消费图片但自身不是素材", () => {
        [CanvasNodeType.Panorama, CanvasNodeType.Compare].forEach((type) => {
            expect(getNodeResourceKind(node(type, { content: "x" })), `${type} 不应作为素材`).toBeNull();
            expect(getNodeInputKind(type)).toBe("image");
        });
    });

    test("图表节点吃文本但不产出素材", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Chart, { content: "[]" }))).toBeNull();
        expect(getNodeInputKind(CanvasNodeType.Chart)).toBe("text");
    });

    test("调色节点即使自身没有 content 也必须算图片素材", () => {
        // 它的图来自上游。若按「有没有 content」判断，它会永远进不了生成输入——
        // 这是个不报错的静默失效，所以单独钉住。
        expect(getNodeResourceKind(node(CanvasNodeType.ColorGrade, {}))).toBe("image");
        expect(getNodeInputKind(CanvasNodeType.ColorGrade)).toBe("image");
    });
});

describe("调色参数", () => {
    test("缺省参数视为未调色", () => {
        expect(isNeutralColorGrade(DEFAULT_COLOR_GRADE)).toBe(true);
        expect(isNeutralColorGrade({ ...DEFAULT_COLOR_GRADE, brightness: 120 })).toBe(false);
        expect(isNeutralColorGrade({ ...DEFAULT_COLOR_GRADE, hueRotate: -10 })).toBe(false);
    });

    test("预览与导出共用同一个 filter 字符串", () => {
        expect(colorGradeCssFilter({ brightness: 110, contrast: 90, saturate: 120, hueRotate: -15 }))
            .toBe("brightness(110%) contrast(90%) saturate(120%) hue-rotate(-15deg)");
    });
});

describe("图表数据解析", () => {
    test("解析 JSON 数组，数值列作为系列", () => {
        const parsed = parseChartSource('[{"月份":"1月","销量":120,"退货":8},{"月份":"2月","销量":150,"退货":5}]');
        expect(parsed?.xKey).toBe("月份");
        expect(parsed?.series).toEqual(["销量", "退货"]);
        expect(parsed?.rows.length).toBe(2);
    });

    test("解析 CSV，并把数字字符串转成数值", () => {
        const parsed = parseChartSource("城市,人口\n北京,2189\n上海,2487");
        expect(parsed?.xKey).toBe("城市");
        expect(parsed?.series).toEqual(["人口"]);
        expect(parsed?.rows[0].人口).toBe(2189);
    });

    test("全是数值列时回落行号作横轴", () => {
        const parsed = parseChartSource("[{\"a\":1,\"b\":2},{\"a\":3,\"b\":4}]");
        expect(parsed?.xKey).toBe("__index");
        expect(parsed?.rows[0].__index).toBe(1);
    });

    // 数据来自模型输出，非法输入是常态而不是异常；抛出来会连带整个画布白屏。
    test("非法或无系列的输入返回 null 而不抛", () => {
        expect(parseChartSource("")).toBeNull();
        expect(parseChartSource("{ 这不是 JSON")).toBeNull();
        expect(parseChartSource("just a sentence")).toBeNull();
        expect(parseChartSource("[]")).toBeNull();
        expect(parseChartSource('{"a":1}')).toBeNull();
        expect(parseChartSource('[{"名称":"甲"},{"名称":"乙"}]')).toBeNull();
        expect(parseChartSource("只有一行")).toBeNull();
    });
});
