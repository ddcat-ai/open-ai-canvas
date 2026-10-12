import { describe, expect, test } from "bun:test";

import { ensureRemoteResourceReferences, restoreRemoteTextNodeContents } from "@/services/user-data-sync-media";

describe("画布资源引用同步", () => {
    test("文本节点保留正文，只同步资源定位键", async () => {
        const node = {
            type: "text",
            metadata: {
                content: "这是上传文件的正文",
                prompt: "这是上传文件的正文",
                storageKey: "resource:text-file",
                mimeType: "text/plain",
            },
        };

        const synced = await ensureRemoteResourceReferences(node);

        expect(synced.metadata.content).toBe(node.metadata.content);
        expect(synced.metadata.prompt).toBe(node.metadata.prompt);
        expect(synced.metadata.storageKey).toBe("resource:text-file");
    });

    test("媒体节点仍将展示字段转换为资源地址", async () => {
        const node = {
            type: "image",
            metadata: {
                content: "blob:image",
                storageKey: "resource:image-file",
            },
        };

        const synced = await ensureRemoteResourceReferences(node);

        expect(synced.metadata.content).toContain("/resources/image-file/file");
    });

    test("加载旧画布时恢复已被保存成资源 URL 的文本正文", async () => {
        const project = {
            nodes: [
                {
                    type: "text",
                    metadata: {
                        content: "/api/resources/text-file/file",
                        prompt: "上传文件的原始正文",
                        storageKey: "resource:text-file",
                    },
                },
            ],
        };

        const restored = await restoreRemoteTextNodeContents(project, async () => null);

        expect(restored.nodes[0].metadata.content).toBe("上传文件的原始正文");
    });

    test("没有可恢复的 prompt 时从资源文件读取正文", async () => {
        const project = {
            nodes: [{ type: "text", metadata: { content: "/api/resources/text-file/file", storageKey: "resource:text-file" } }],
        };

        const restored = await restoreRemoteTextNodeContents(project, async () => "从资源恢复的正文");

        expect(restored.nodes[0].metadata.content).toBe("从资源恢复的正文");
        expect(restored.nodes[0].metadata.prompt).toBe("从资源恢复的正文");
    });
});
