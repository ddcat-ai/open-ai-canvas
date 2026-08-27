import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "../src/lib/canvas/canvas-resource-references";
import { creationAttachmentKind, creationFileAccepted, creationMediaAspectRatio, creationUploadAccept, type CreationAttachment } from "../src/pages/create/creation-assets";
import { buildCreationMentionReferences, displayCreationPrompt, reconcileCreationAttachmentLimit, removeCreationReferenceTokens, replaceCreationAttachmentReference, selectedCreationReferences } from "../src/pages/create/creation-references";

function imageAttachment(id: string): CreationAttachment {
    return {
        id,
        name: `${id}.png`,
        type: "image/png",
        dataUrl: `data:image/png;base64,${id}`,
        previewUrl: `data:image/png;base64,${id}`,
    };
}

describe("creation references", () => {
    test("removes attachments and prompt tokens beyond the current model limit", () => {
        const attachments = [imageAttachment("first"), imageAttachment("second"), imageAttachment("third")];
        const references = buildCreationMentionReferences([], attachments);
        const result = reconcileCreationAttachmentLimit(attachments, references, 1);
        const prompt = references.map(canvasResourceMentionToken).join(" ");
        const nextPrompt = removeCreationReferenceTokens(prompt, result.removedReferences);

        expect(result.attachments).toEqual([attachments[0]]);
        expect(result.removedReferences.map((reference) => reference.attachmentId)).toEqual(["second", "third"]);
        expect(nextPrompt).toContain(canvasResourceMentionToken(references[0]));
        expect(nextPrompt).not.toContain(canvasResourceMentionToken(references[1]));
        expect(nextPrompt).not.toContain(canvasResourceMentionToken(references[2]));
    });

    test("returns the original attachment list when it is already within the limit", () => {
        const attachments = [imageAttachment("first")];
        const result = reconcileCreationAttachmentLimit(attachments, buildCreationMentionReferences([], attachments), 1);

        expect(result.attachments).toBe(attachments);
        expect(result.removedReferences).toEqual([]);
    });

    test("文本创作允许媒体和常用文档，图片创作仍只接受图片", () => {
        expect(creationFileAccepted("text", { name: "story.pdf", type: "application/pdf" })).toBe(true);
        expect(creationFileAccepted("text", { name: "clip.mp4", type: "video/mp4" })).toBe(true);
        expect(creationFileAccepted("image", { name: "story.pdf", type: "application/pdf" })).toBe(false);
        expect(creationUploadAccept("text")).toContain(".docx");
    });

    test("文档附件会作为文本资源参与引用", () => {
        const attachment: CreationAttachment = { id: "document", name: "script.pdf", type: "application/pdf", url: "https://example.com/script.pdf", storageKey: "resource:document", bytes: 1024, previewUrl: "" };
        const [reference] = buildCreationMentionReferences([], [attachment]);

        expect(creationAttachmentKind(attachment)).toBe("file");
        expect(reference.kind).toBe("text");
        expect(reference.label).toBe("文件1");
    });

    test("不同附件类型分别按自己的引入顺序编号", () => {
        const audio: CreationAttachment = { id: "audio", name: "audio.mp3", type: "audio/mpeg", url: "blob:audio", storageKey: "audio:key", previewUrl: "" };
        const references = buildCreationMentionReferences([], [imageAttachment("first"), audio, imageAttachment("second")]);

        expect(references.map((reference) => reference.label)).toEqual(["图片1", "音频1", "图片2"]);
    });

    test("媒体占位按本次选择的画幅展示并为异常值提供模式回退", () => {
        expect(creationMediaAspectRatio("16:9", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("1:1", "image")).toBe("1 / 1");
        expect(creationMediaAspectRatio("1920x1080", "image")).toBe("1920 / 1080");
        expect(creationMediaAspectRatio("auto", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("auto", "image")).toBe("1 / 1");
    });

    test("替换图片时保留目标位置且提示词无需修改", () => {
        const attachments = [imageAttachment("first"), imageAttachment("second"), imageAttachment("third")];
        const references = buildCreationMentionReferences([], attachments);
        const oldToken = canvasResourceMentionToken(references[1]);
        const replacement = imageAttachment("replacement");

        const result = replaceCreationAttachmentReference(`让 ${oldToken} 靠近 ${oldToken}`, attachments, "second", replacement);
        const nextReferences = buildCreationMentionReferences([], result.attachments);
        const replacementReference = nextReferences.find((reference) => reference.attachmentId === replacement.id)!;
        const replacementToken = canvasResourceMentionToken(replacementReference);

        expect(result.attachments.map((attachment) => attachment.id)).toEqual(["first", "replacement", "third"]);
        expect(replacementReference.label).toBe("图片2");
        expect(result.prompt).toBe(`让 ${replacementToken} 靠近 ${replacementToken}`);
        expect(result.prompt).not.toContain(oldToken);
        expect(displayCreationPrompt(result.prompt, nextReferences)).toBe("让 @图片2 靠近 @图片2");
    });

    test("删除中间附件后只移除该附件引用，后续附件仍按稳定身份保留", () => {
        const attachments = ["first", "second", "third", "fourth", "fifth"].map(imageAttachment);
        const references = buildCreationMentionReferences([], attachments);
        const third = references[2];
        const fifth = references[4];
        const prompt = `删除前比较 ${canvasResourceMentionToken(third)} 和 ${canvasResourceMentionToken(fifth)}`;
        const remaining = attachments.filter((attachment) => attachment.id !== "third");
        const nextPrompt = removeCreationReferenceTokens(prompt, [third]);
        const nextReferences = buildCreationMentionReferences([], remaining);

        expect(nextPrompt).not.toContain(canvasResourceMentionToken(third));
        expect(nextPrompt).toContain(canvasResourceMentionToken(fifth));
        expect(selectedCreationReferences(nextPrompt, nextReferences).map((reference) => reference.attachmentId)).toEqual(["fifth"]);
        expect(displayCreationPrompt(nextPrompt, nextReferences)).toBe("删除前比较  和 @图片4");
    });

    test("替换会归一化可见标签并去除已存在的重复附件", () => {
        const attachments = [imageAttachment("source"), imageAttachment("target"), imageAttachment("third")];
        const result = replaceCreationAttachmentReference("让 @图片2 参考 @图片2。", attachments, "target", attachments[0]);
        const references = buildCreationMentionReferences([], result.attachments);
        const sourceReference = references.find((reference) => reference.attachmentId === "source")!;

        expect(result.attachments.map((attachment) => attachment.id)).toEqual(["third", "source"]);
        expect(sourceReference.label).toBe("图片2");
        expect(result.prompt).toBe(`让 ${canvasResourceMentionToken(sourceReference)} 参考 ${canvasResourceMentionToken(sourceReference)}。`);
    });

    test("目标附件不存在时拒绝替换", () => {
        expect(() => replaceCreationAttachmentReference("", [imageAttachment("first")], "missing", imageAttachment("next"))).toThrow("要替换的参考内容不存在");
    });
});
