import { describe, expect, test } from "bun:test";
import { appendCreationReference, creationAttachmentFromResult, CREATION_IMAGE_DRAG_TYPE, hasCreationReferenceDrop, readCreationReferenceDrop } from "../src/pages/create/creation-reference-drop";
import { creationAttachmentFromImage, splitCreationAttachments, type CreationAttachment } from "../src/pages/create/creation-assets";
import { buildCreationMentionReferences } from "../src/pages/create/creation-references";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { creationHistoryMedia, restoreHistoryMedia } from "../src/services/creation-history-media";
import { defaultConfig } from "../src/stores/use-config-store";
import type { ImageAsset } from "../src/stores/use-asset-store";
import type { CreationMessage } from "../src/pages/create/creation-types";

const message: CreationMessage = {
    id: "done",
    role: "assistant",
    mode: "image",
    status: "done",
    content: "",
    createdAt: "2026-11-17",
    resultStorageKeys: ["resource:first", "resource:second"],
    resultUrls: ["https://expired.invalid/first", "https://expired.invalid/second"],
};
const image = (key: string) => creationAttachmentFromResult({ messageId: "done", resultKey: `resource:${key}` }, [message], []);

describe("创作参考图拖拽", () => {
    test("dragover 在文件不可读时仍识别文件，普通文字不拦截", () => {
        expect(hasCreationReferenceDrop({ types: ["Files"] })).toBe(true);
        expect(hasCreationReferenceDrop({ types: [CREATION_IMAGE_DRAG_TYPE, "text/html"] })).toBe(true);
        expect(hasCreationReferenceDrop({ types: ["text/plain"] })).toBe(false);
    });
    test("同步提取多个文件并保持拖入顺序", () => {
        const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.jpg", { type: "image/jpeg" })];
        expect(readCreationReferenceDrop({ types: ["Files"], files: files as unknown as FileList, getData: () => "" })).toEqual({ kind: "files", files });
    });
    test("只接受内部图片身份，不接受外部 URL 注入", () => {
        const transfer = (value: string) => ({ types: [CREATION_IMAGE_DRAG_TYPE], files: [] as unknown as FileList, getData: () => value });
        expect(readCreationReferenceDrop(transfer("not-json"))).toBeNull();
        expect(readCreationReferenceDrop(transfer('{"messageId":{},"resultKey":"resource:first"}'))).toBeNull();
        expect(readCreationReferenceDrop(transfer('{"messageId":"done","resultKey":"resource:first","url":"https://untrusted.invalid"}'))).toEqual({ kind: "result", image: { messageId: "done", resultKey: "resource:first" } });
    });
    test("多图结果选中哪张就引用哪张，并使用稳定资源地址", async () => {
        const result = await image("second");
        expect(result.storageKey).toBe("resource:second");
        expect(result.previewUrl).toEndWith("/resources/second/file");
        expect(result.previewUrl).not.toContain("expired");
        expect(splitCreationAttachments([result]).referenceImages).toEqual([result]);
    });
    test("未知图片、其他账号未加载的消息和未完成结果拒绝引用", async () => {
        await expect(image("missing")).rejects.toThrow();
        await expect(creationAttachmentFromResult({ messageId: "other", resultKey: "resource:first" }, [message], [])).rejects.toThrow();
        await expect(creationAttachmentFromResult({ messageId: "done", resultKey: "resource:first" }, [{ ...message, status: "pending" }], [])).rejects.toThrow();
    });
    for (const withAsset of [false, true]) {
        for (const withStaleUrl of [false, true]) {
            test(`本机旧结果刷新后重新解析预览地址（素材=${withAsset}，旧地址=${withStaleUrl}）`, async () => {
                const storageKey = "image:test-scope:local";
                const localMessage = { ...message, resultStorageKeys: [storageKey], resultUrls: withStaleUrl ? ["blob:revoked"] : [] };
                const asset: ImageAsset = {
                    id: "local-asset",
                    kind: "image",
                    title: "本机生成图片",
                    category: "material",
                    coverUrl: "blob:revoked",
                    tags: [],
                    status: "confirmed",
                    source: "生成任务",
                    createdAt: message.createdAt,
                    updatedAt: message.createdAt,
                    data: { storageKey, dataUrl: "blob:revoked", mimeType: "image/png", width: 32, height: 24, bytes: 5 },
                };
                const resolvedKeys: string[] = [];
                const result = await creationAttachmentFromResult({ messageId: message.id, resultKey: storageKey }, [localMessage], withAsset ? [asset] : [], async (key) => {
                    resolvedKeys.push(key);
                    return "blob:restored";
                });
                expect(resolvedKeys).toEqual([storageKey]);
                expect(result).toMatchObject({ storageKey, url: "blob:restored", dataUrl: "blob:restored", previewUrl: "blob:restored" });
                if (withAsset) expect(result).toMatchObject({ id: "asset:local-asset", width: 32, height: 24 });
            });
        }
    }
    test("本机结果文件缺失时明确失败，不追加失效 blob 地址", async () => {
        const storageKey = "image:test-scope:missing";
        await expect(creationAttachmentFromResult({ messageId: message.id, resultKey: storageKey }, [{ ...message, resultStorageKeys: [storageKey], resultUrls: ["blob:revoked"] }], [], async () => "")).rejects.toThrow("尚未保存完成");
    });
    test("重复拖拽或已从素材库添加的同一资源不会重复或改变顺序", async () => {
        const existing = [{ ...(await image("first")), id: "asset:library" }, await image("second")];
        expect(appendCreationReference(existing, await image("first"), 2)).toBe(existing);
    });
    test("追加保留已有参考顺序；超过数量和不支持图片均拒绝", async () => {
        const first = await image("first"),
            second = await image("second");
        expect(appendCreationReference([first], second, 2)).toEqual([first, second]);
        expect(() => appendCreationReference([first], second, 1)).toThrow("最多支持 1");
        expect(() => appendCreationReference([], first, 0)).toThrow("最多支持 0");
    });
    test("视频和音频不会占用视频模式的图片数量", async () => {
        const audio: CreationAttachment = { id: "audio", type: "audio/mpeg", name: "a.mp3", url: "/a.mp3", storageKey: "resource:audio", previewUrl: "" };
        expect(appendCreationReference([audio], await image("first"), 1)).toEqual([audio, await image("first")]);
    });
    test("文本模式总附件满额时拒绝追加图片，重复引用仍不占用新容量", async () => {
        const files: CreationAttachment[] = Array.from({ length: 6 }, (_, index) => ({ id: `file:${index}`, name: `${index}.txt`, type: "text/plain", url: `/file-${index}.txt`, storageKey: `resource:file-${index}`, previewUrl: "", bytes: 1 }));
        const first = await image("first");
        expect(() => appendCreationReference(files, first, 6, 6)).toThrow("最多支持 6 个参考内容");
        const withImage = [...files.slice(0, 5), first];
        expect(appendCreationReference(withImage, first, 6, 6)).toBe(withImage);
        expect(appendCreationReference(files.slice(0, 5), first, 6, 6)).toHaveLength(6);
    });
    test("两种拖入参考经任务参数、历史序列化及重开后仍保留同一图片和顺序", async () => {
        const uploaded = creationAttachmentFromImage(new File(["image"], "local.png", { type: "image/png" }), {
            storageKey: "resource:uploaded",
            url: "/api/resources/uploaded/file",
            mimeType: "image/png",
            width: 32,
            height: 24,
            bytes: 5,
        });
        const attachments = appendCreationReference([uploaded], await image("second"), 2);
        const { referenceImages } = splitCreationAttachments(attachments);
        const config = { ...defaultConfig, model: "test::image", imageModel: "test::image", channels: [{ id: "test", name: "本地合同测试", baseUrl: "/api", apiKey: "", apiFormat: "openai" as const, scope: "system" as const, models: ["image"] }] };
        // 只构造任务合同；不调用 createTask，不上传或请求供应商。
        const task = await prepareBackendGenerationTask({ mode: "image", prompt: "保留两张参考图", config, referenceImages });
        expect(task.input.referenceImages.map((item) => item.storageKey)).toEqual(["resource:uploaded", "resource:second"]);
        const userMessage: CreationMessage = { id: "dropped-references", role: "user", mode: "image", content: "保留两张参考图", createdAt: message.createdAt, attachments, references: buildCreationMentionReferences([], attachments) };
        const payload = await creationHistoryMedia("test-scope", new AbortController().signal, () => true)(userMessage);
        expect(JSON.stringify(payload)).not.toContain("expired.invalid");
        const restored = restoreHistoryMedia(JSON.parse(JSON.stringify(payload)) as CreationMessage);
        expect(restored.attachments?.map((item) => item.storageKey)).toEqual(["resource:uploaded", "resource:second"]);
        expect(restored.references?.map((item) => item.storageKey)).toEqual(["resource:uploaded", "resource:second"]);
        const restoredImages = splitCreationAttachments(restored.attachments!).referenceImages;
        expect(restoredImages.map((item) => item.dataUrl)).toEqual(["/api/resources/uploaded/file", "/api/resources/second/file"]);
        const retry = await prepareBackendGenerationTask({ mode: "image", prompt: userMessage.content, config, referenceImages: restoredImages, retryOf: "failed-task" });
        expect(retry.input.referenceImages).toEqual(task.input.referenceImages);
    });
});
