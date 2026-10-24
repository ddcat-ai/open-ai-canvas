import { expect, test } from "bun:test";

test("创作页消息流编辑并重新发送时完整恢复参考附件与参数", async () => {
    const [createPage, messagesView] = await Promise.all([
        Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/create/creation-workspace-messages.tsx", import.meta.url)).text(),
    ]);

    expect(messagesView).toContain("onEditUserMessage: (message: CreationMessage) => void");
    expect(messagesView).toContain("onClick={() => onEditUserMessage(item)}");
    expect(createPage).toContain("restoreMessageDraft(message);");
    expect(createPage).toContain("const nextAttachments = item.attachments ? [...item.attachments] : [];");
    expect(createPage).toContain("setAttachments(nextAttachments);");
    expect(createPage).toContain("attachmentsRef.current = nextAttachments;");
});
