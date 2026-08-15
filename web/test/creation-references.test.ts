import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "../src/lib/canvas/canvas-resource-references";
import type { CreationAttachment } from "../src/pages/create/creation-assets";
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
});
