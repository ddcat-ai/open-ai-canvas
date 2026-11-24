import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageParameterFields } from "../src/components/image-parameter-fields";
import { batchQuoteTotal, currentGenerationBatchLimit, generationBatchLimit } from "../src/lib/generation-batch-limit";
import { projectImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { workbenchBatchLimit } from "../src/pages/workbench/workbench-batches";
import type { AiConfig } from "../src/stores/use-config-store";
import { useUserStore } from "../src/stores/use-user-store";

// 单次只能出 1 张的模型：count 参数 max=1，画布和创作页按拆单数选择张数。
const declaredParameters: ImageParameter[] = [
    { name: "size", label: "画面比例", type: "string", values: ["1:1", "16:9"], default: "1:1", binding: "aspectRatio", enabled: true },
    { name: "count", label: "生成张数", type: "integer", min: 1, max: 1, step: 1, default: 1, binding: "imageCount", enabled: true, description: "固定 1 张" },
];

function declaredProfile() {
    const base = defaultImageCapabilityConfig();
    return projectImageParameters({ ...base, size: { ...base.size, parameter: "aspect_ratio" } }, declaredParameters);
}

function renderFields(count: string, countLimit?: number) {
    return renderToStaticMarkup(createElement(ImageParameterFields, { profile: declaredProfile(), config: { count } as AiConfig, countLimit, onChange: () => {} }));
}

describe("generationBatchLimit", () => {
    test("按账号同时任务数取上限，至少 1", () => {
        expect(generationBatchLimit(10)).toBe(10);
        expect(generationBatchLimit(5)).toBe(5);
        expect(generationBatchLimit(2.9)).toBe(2);
        expect(generationBatchLimit(1)).toBe(1);
        expect(generationBatchLimit(0)).toBe(1);
        expect(generationBatchLimit(Number.NaN)).toBe(1);
    });
});

describe("currentGenerationBatchLimit", () => {
    test("读取当前账号的同时任务数", () => {
        const previousLimits = useUserStore.getState().runtimeLimits;
        try {
            useUserStore.getState().setRuntimeLimits({ activeTaskLimit: 10, resourceUploadMB: 50 });
            expect(currentGenerationBatchLimit()).toBe(10);
            useUserStore.getState().setRuntimeLimits({ activeTaskLimit: 3, resourceUploadMB: 50 });
            expect(currentGenerationBatchLimit()).toBe(3);
            useUserStore.getState().setRuntimeLimits({ activeTaskLimit: 0, resourceUploadMB: 50 });
            expect(currentGenerationBatchLimit()).toBe(1);
        } finally {
            useUserStore.getState().setRuntimeLimits(previousLimits);
        }
    });
});

describe("batchQuoteTotal", () => {
    test("单单报价按实际提交单数累加，至少按 1 单", () => {
        expect(batchQuoteTotal(500_000, 1)).toBe(0.5);
        expect(batchQuoteTotal(500_000, 5)).toBe(2.5);
        expect(batchQuoteTotal(0, 5)).toBe(0);
        expect(batchQuoteTotal(1_000_000, 0)).toBe(1);
        expect(batchQuoteTotal(1_000_000, Number.NaN)).toBe(1);
    });
});

describe("workbenchBatchLimit", () => {
    test("图片工作台仍按账号同时任务数取上限", () => {
        expect(workbenchBatchLimit("image", 1, 10)).toBe(10);
        expect(workbenchBatchLimit("video", 1, 10)).toBe(8);
    });

    test("视频不超过 8，图片不超过 12，并发很小时至少 1", () => {
        expect(workbenchBatchLimit("video", 1, 100)).toBe(8);
        expect(workbenchBatchLimit("image", 1, 100)).toBe(12);
        expect(workbenchBatchLimit("image", 4, 100)).toBe(12);
        expect(workbenchBatchLimit("image", 1, 0)).toBe(1);
        expect(workbenchBatchLimit("video", 1, 0)).toBe(1);
    });
});

describe("ImageParameterFields 的张数上限", () => {
    test("传 countLimit 时单次只能出 1 张的模型也能选张数，并用拆单数取值", () => {
        const limited = renderFields("3", 4);
        expect(limited).toContain("生成张数");
        expect(limited).toContain(">3<");
        // 张数是拆单数，模型单次张数说明不再适用。
        expect(limited).not.toContain("固定 1 张");
    });

    test("不传 countLimit 时保持原逻辑，单次 1 张的模型不显示张数", () => {
        expect(renderFields("3")).not.toContain("生成张数");
    });
});
