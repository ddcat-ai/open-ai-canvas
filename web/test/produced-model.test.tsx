import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNode } from "@/components/canvas/canvas-node";
import { applyGeneratedMediaResultMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { commitProducedModel, producedModelCandidateForGeneration, producedModelLabel, submittedProducedModel } from "@/lib/canvas/produced-model";
import { searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { reconcileImageBatchRoot } from "@/lib/canvas/canvas-image-batch-retry";
import { effectiveConfigForCustomChannels, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const config = {
    channels: [
        {
            id: "system-1",
            name: "系统渠道",
            scope: "system",
            models: ["gpt-image-1"],
            modelCosts: [{ model: "gpt-image-1", displayName: "图像 Pro", logicalModelId: "logical-image" }],
        },
        {
            id: "user-1",
            name: "我的渠道",
            scope: "user",
            models: ["flux-dev"],
            modelCosts: [{ model: "flux-dev" }],
        },
    ],
} as AiConfig;

function node(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return {
        id: "node-1",
        type: CanvasNodeType.Video,
        title: "镜头",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata,
    };
}

describe("produced model", () => {
    test("freezes the submitted model instead of the dropdown selection", () => {
        const next = applyGeneratedMediaResultMetadata(
            node({
                model: "user-1::changed-later",
                producedModel: "user-1::old",
                producedModelCandidate: "system-1::gpt-image-1",
                content: "https://example.test/old.mp4",
            }),
            videoMetadata({
                url: "https://example.test/new.mp4",
                storageKey: "video:new",
                width: 1280,
                height: 720,
                bytes: 12,
                mimeType: "video/mp4",
            }),
            {},
            "logical-image",
        );

        expect(next.producedModel).toBe("system-1::gpt-image-1");
        expect(next.producedModelCandidate).toBeUndefined();
        expect(next.model).toBe("user-1::changed-later");
    });

    test("uses the task model when the node never recorded a candidate", () => {
        const next = commitProducedModel({ model: "user-1::draft" }, "logical-image");
        expect(next.producedModel).toBe("logical-image");
        expect(next.model).toBe("user-1::draft");
    });

    test("workflow success records the submitted workflow name instead of the unused catalog model", () => {
        expect(producedModelCandidateForGeneration({ model: "system-1::gpt-image-1", taskWorkflowProvider: "runninghub" })).toBeUndefined();
        expect(submittedProducedModel("RunningHub · 分镜")).toBe("RunningHub · 分镜");
        const next = commitProducedModel({ producedModel: "system-1::gpt-image-1", producedModelCandidate: undefined }, "RunningHub · 分镜");
        expect(next.producedModel).toBe("RunningHub · 分镜");
        expect(producedModelLabel(config, next.producedModel)).toBe("RunningHub · 分镜");
    });

    test("batch root projects the primary result model and clears it when no result remains", () => {
        const root = { ...node({ isBatchRoot: true, batchChildIds: ["child"], producedModel: "old" }), type: CanvasNodeType.Image };
        const child = { ...node({ batchRootId: root.id, status: "success", content: "https://example.test/image", producedModel: "new" }), id: "child", type: CanvasNodeType.Image };
        expect(reconcileImageBatchRoot(root, [root, child]).metadata?.producedModel).toBe("new");
        const failed = { ...child, metadata: { ...child.metadata, content: undefined, status: "error" as const } };
        expect(reconcileImageBatchRoot(root, [root, failed]).metadata?.producedModel).toBeUndefined();
    });

    test("resolves a display name and otherwise shows the model id", () => {
        const resolved = effectiveConfigForCustomChannels(config, true);
        expect(producedModelLabel(resolved, "system-1::gpt-image-1")).toBe("图像 Pro");
        expect(producedModelLabel(resolved, "user-1::flux-dev")).toBe("flux-dev");
        expect(producedModelLabel(resolved, "logical-image")).toBe("图像 Pro");
        expect(producedModelLabel(resolved, "deleted::gpt-image-1")).toBe("gpt-image-1");
        expect(producedModelLabel(resolved, "missing-model")).toBe("missing-model");
        expect(producedModelLabel(resolved, "system-1::gpt-image-1")).not.toBe("系统模型");
    });

    test("search matches the produced model label and the selected model", () => {
        const image = node({ model: "wan-video", producedModel: "system-1::gpt-image-1" });
        image.type = CanvasNodeType.Image;
        expect(searchCanvasNodes([image], "图像 Pro", 80, config).map((item) => item.id)).toEqual(["node-1"]);
        expect(searchCanvasNodes([image], "gpt-image-1", 80, config).map((item) => item.id)).toEqual(["node-1"]);
        expect(searchCanvasNodes([image], "wan-video", 80, config).map((item) => item.id)).toEqual(["node-1"]);
    });
});

describe("produced model badge", () => {
    const noop = () => {};
    function renderMedia(type: CanvasNodeType, showImageInfo: boolean, mediaActive = false, renderLOD: "full" | "compact" = "full") {
        return renderToStaticMarkup(
            <CanvasNode
                data={{
                    id: "media",
                    type,
                    title: "结果",
                    position: { x: 0, y: 0 },
                    width: 320,
                    height: 180,
                    metadata: {
                        content: "https://example.test/media",
                        storageKey: "resource:1",
                        producedModel: "user-1::flux-dev",
                        naturalWidth: 1280,
                        naturalHeight: 720,
                        bytes: 2048,
                    },
                }}
                scale={1}
                isSelected={false}
                mediaActive={mediaActive}
                isRelated={false}
                isFocusRelated={false}
                isConnectionTarget={false}
                showImageInfo={showImageInfo}
                renderLOD={renderLOD}
                onMouseDown={noop}
                onHoverStart={noop}
                onHoverEnd={noop}
                onConnectStart={noop}
                onResize={noop}
                onContentChange={noop}
                onContextMenu={noop}
            />,
        );
    }

    test("shows the model at the lower left only while media info is enabled", () => {
        expect(renderMedia(CanvasNodeType.Image, false)).not.toContain("flux-dev");
        const image = renderMedia(CanvasNodeType.Image, true);
        expect(image).toContain("flux-dev");
        expect(image).toContain("1280 x 720");
        const video = renderMedia(CanvasNodeType.Video, true, true);
        expect(video).toContain("bottom-16");
        expect(video).toContain("flux-dev");
        expect(video).not.toContain("1280 x 720");
        expect(renderMedia(CanvasNodeType.Audio, true)).toContain("flux-dev");
        expect(renderMedia(CanvasNodeType.Image, true, false, "compact")).not.toContain("flux-dev");
    });
});
