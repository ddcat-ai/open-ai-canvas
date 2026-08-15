import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "../src/lib/canvas/canvas-resource-references";
import { creationAttachmentKind, creationFileAccepted, creationMediaAspectRatio, creationUploadAccept, type CreationAttachment } from "../src/pages/create/creation-assets";
import { buildCreationMentionReferences, reconcileCreationAttachmentLimit, removeCreationReferenceTokens } from "../src/pages/create/creation-references";

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

    test("媒体占位按本次选择的画幅展示并为异常值提供模式回退", () => {
        expect(creationMediaAspectRatio("16:9", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("1:1", "image")).toBe("1 / 1");
        expect(creationMediaAspectRatio("1920x1080", "image")).toBe("1920 / 1080");
        expect(creationMediaAspectRatio("auto", "video")).toBe("16 / 9");
        expect(creationMediaAspectRatio("auto", "image")).toBe("1 / 1");
    });
});
