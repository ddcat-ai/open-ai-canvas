import { describe, expect, test } from "bun:test";

import { failedImageBatchChildren, markImageBatchRetrying, reconcileImageBatchRoot, restoreUnsubmittedImageBatchChild } from "../src/lib/canvas/canvas-image-batch-retry";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeStatus } from "../src/types/canvas";

function imageNode(id: string, status: CanvasNodeStatus, metadata: Partial<NonNullable<CanvasNodeData["metadata"]>> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { status, ...metadata },
    };
}

describe("canvas image batch retry", () => {
    test("只按批次顺序返回属于当前根节点的失败图片", () => {
        const root = imageNode("root", "error", { isBatchRoot: true, batchChildIds: ["failed-2", "success", "failed-1", "loading", "foreign"] });
        const nodes = [
            root,
            imageNode("failed-1", "error", { batchRootId: root.id }),
            imageNode("failed-2", "error", { batchRootId: root.id }),
            imageNode("success", "success", { batchRootId: root.id, content: "image:success" }),
            imageNode("loading", "loading", { batchRootId: root.id }),
            imageNode("foreign", "error", { batchRootId: "another-root" }),
        ];

        expect(failedImageBatchChildren(root, nodes).map((node) => node.id)).toEqual(["failed-2", "failed-1"]);
    });

    test("任一子图成功后恢复根节点主图，同时保留其他失败子图", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["failed", "success"], errorDetails: "旧错误" });
        const failed = imageNode("failed", "error", { batchRootId: root.id, errorDetails: "上游失败" });
        const success = imageNode("success", "success", {
            batchRootId: root.id,
            content: "image:success",
            storageKey: "resource:success",
            mimeType: "image/png",
            naturalWidth: 1024,
            naturalHeight: 1024,
        });

        const next = reconcileImageBatchRoot(root, [root, failed, success]);

        expect(next.metadata).toMatchObject({ status: "success", content: "image:success", storageKey: "resource:success", primaryImageId: "success", batchFailedCount: 1 });
        expect(next.metadata.errorDetails).toBeUndefined();
        expect(failed.metadata.status).toBe("error");
    });

    test("全部子图失败时把代表错误同步回根节点", () => {
        const root = imageNode("root", "loading", { isBatchRoot: true, batchChildIds: ["failed-1", "failed-2"] });
        const failed = imageNode("failed-1", "error", {
            batchRootId: root.id,
            errorDetails: "No available compatible accounts",
            generationErrorCode: "upstream_unavailable",
        });

        const next = reconcileImageBatchRoot(root, [root, failed, imageNode("failed-2", "error", { batchRootId: root.id, errorDetails: "另一错误" })]);

        expect(next.metadata).toMatchObject({ status: "error", errorDetails: "No available compatible accounts", generationErrorCode: "upstream_unavailable", batchFailedCount: 2 });
        expect(next.metadata.content).toBeUndefined();
        expect(next.metadata.primaryImageId).toBeUndefined();
    });

    test("开始批量重试时根节点和全部失败子图同步进入生成中", () => {
        const root = imageNode("root", "error", { isBatchRoot: true, batchChildIds: ["failed-1", "success", "failed-2"], batchFailedCount: 2, errorDetails: "全部失败" });
        const failed1 = imageNode("failed-1", "error", { batchRootId: root.id, errorDetails: "失败 1" });
        const success = imageNode("success", "success", { batchRootId: root.id, content: "image:success" });
        const failed2 = imageNode("failed-2", "error", { batchRootId: root.id, errorDetails: "失败 2" });

        const next = markImageBatchRetrying(root.id, [failed1.id, failed2.id], [root, failed1, success, failed2]);

        expect(next.find((node) => node.id === root.id)?.metadata).toMatchObject({ status: "loading", batchFailedCount: 2 });
        expect(next.find((node) => node.id === failed1.id)?.metadata?.status).toBe("loading");
        expect(next.find((node) => node.id === failed2.id)?.metadata?.status).toBe("loading");
        expect(next.find((node) => node.id === success.id)?.metadata).toMatchObject({ status: "success", content: "image:success" });
    });

    test("未提交请求的失败子图从预备加载状态恢复原错误", () => {
        const original = imageNode("failed", "error", { batchRootId: "root", errorDetails: "原始失败" });
        const loading = imageNode("failed", "loading", { batchRootId: "root" });

        expect(restoreUnsubmittedImageBatchChild(loading, original).metadata).toMatchObject({ status: "error", errorDetails: "原始失败" });
        expect(restoreUnsubmittedImageBatchChild(imageNode("failed", "success", { content: "image:success" }), original).metadata?.status).toBe("success");
    });
});
