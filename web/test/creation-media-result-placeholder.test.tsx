import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { creationResultAssetRatio, MediaResult } from "@/pages/create/creation-workspace-messages";
import type { CreationMessage } from "@/pages/create/creation-types";
import type { ImageAsset } from "@/stores/use-asset-store";

const noop = () => {};
const at = "2026-10-28T06:04:00.000Z";

function renderResult(item: Partial<CreationMessage>) {
    return renderToStaticMarkup(
        <MediaResult
            item={{ id: "assistant-1", role: "assistant", mode: "image", content: "图片已生成", createdAt: at, status: "done", taskIds: ["task-1"], settings: { ratio: "16:9", seconds: "", quality: "auto", videoQuality: "", count: "1" }, ...item }}
            onRetryFailure={noop}
            onRefreshResult={noop}
            onRecoverMedia={noop}
            onCreateVariant={noop}
            onContinueCanvas={noop}
            openingCanvas={false}
        />,
    );
}

describe("首页图片结果在加载完成前就占好位置", () => {
    test("图片还没加载出来时按生成比例预留尺寸并显示加载态", () => {
        const markup = renderResult({ resultStorageKeys: ["resource:image-1"], resultUrls: ["/api/resources/image-1/file"] });
        expect(markup).toContain('data-media-state="loading"');
        expect(markup).toContain("aspect-ratio:1.7777");
        expect(markup).toContain('aria-busy="true"');
    });

    test("已知素材尺寸时使用真实宽高比，避免加载完成后跳动", () => {
        const asset = {
            id: "generation_asset",
            kind: "image",
            title: "生成图片",
            category: "material",
            coverUrl: "",
            tags: [],
            status: "confirmed",
            source: "生成任务",
            createdAt: at,
            updatedAt: at,
            metadata: { source: "generation-task", taskId: "task-1", messageId: "assistant-1" },
            data: { dataUrl: "/api/resources/image-1/file", storageKey: "resource:image-1", width: 1824, height: 1024, bytes: 1, mimeType: "image/png" },
        } as ImageAsset;
        expect(creationResultAssetRatio([asset], "resource:image-1")).toBeCloseTo(1824 / 1024);
        expect(creationResultAssetRatio([asset], "resource:other")).toBeUndefined();
        expect(creationResultAssetRatio([{ ...asset, data: { ...asset.data, width: 0 } }], "resource:image-1")).toBeUndefined();
    });

    test("访问地址还在解析、也没有可用 hint 时同样渲染占位块，而不是空白", () => {
        const markup = renderResult({ resultStorageKeys: ["resource:image-1"] });
        expect(markup).toContain('<i class="creation-image-result" data-media-state="loading"');
        expect(markup).not.toContain("暂时没有可预览的结果");
    });
});
