import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const start = source.indexOf("    const submit = async (");
const end = source.indexOf("\n    useEffect(() => {\n        if (!retrySequence)", start);
if (start < 0 || end < 0) throw new Error("submit function boundary missing");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

async function delayedSubmit(change: "conversation" | "account" | "none") {
    let release!: (runtime: unknown) => void;
    const loading = new Promise((resolve) => { release = resolve; });
    let visibleDraft = "A original prompt";
    let visibleAttachments = ["original-reference"];
    let scope = "alice";
    let consumerStarts = 0;
    const activeIdRef = { current: "a" };
    const sourceConversation = { id: "a", title: "A", messages: [] };
    const deps = {
        mode: "image", smartCreationActive: false, smartCreationProvider: null,
        submitGateRef: { current: { tryAcquire: () => true } }, retryPreparingRef: { current: new Set() }, createCreationSubmitGateRelease: () => () => undefined,
        prompt: visibleDraft, busy: false, activeConversation: sourceConversation, selectedModel: "image-model", attachments: [], videoReferenceLimits: undefined,
        reconcileCreationAttachmentLimit: (items: unknown) => ({ attachments: items }), mentionReferences: [], maxReferences: 6, count: "1", ratio: "1:1", quality: "auto", seconds: "6", videoQuality: "720",
        imageProfile: { quality: { default: "auto" } }, selectedCreationReferences: () => [], splitCreationAttachments: () => ({ referenceImages: [], referenceVideos: [], referenceAudios: [] }), inferVideoOperation: () => "",
        loadCreationRuntime: () => loading, expandCreationPrompt: (value: unknown) => value, toast: { error: () => undefined, warning: () => undefined }, followLatestMessageRef: { current: false },
        newMessage: (role: unknown, content: unknown, extra: object) => ({ id: role, role, content, ...extra }), updateConversationMessage: () => undefined, updateActive: (updater: (value: unknown) => unknown) => updater(sourceConversation),
        setPrompt: (value: string) => { visibleDraft = value; }, setAttachments: (value: string[]) => { visibleAttachments = value; }, setDraftReferences: () => undefined, setBusy: () => undefined,
        activeIdRef, getActiveUserScope: () => scope,
    };
    const submit = new Function(...Object.keys(deps), `${code}\nreturn submit;`)(...Object.values(deps));
    const running = submit();
    if (change !== "none") { activeIdRef.current = "b"; visibleDraft = "B new draft"; visibleAttachments = ["B reference"]; }
    if (change === "account") scope = "bob";
    release({ skillRuntime: { prepare: async () => ({ prompt: "A original prompt", metadata: {} }) }, beginGenerationConsumer: () => { consumerStarts++; throw new Error("isolated stop before generation"); } });
    await running.catch((error: Error) => { if (error.message !== "isolated stop before generation") throw error; });
    return { visibleDraft, visibleAttachments, consumerStarts };
}

test("直出图片/视频等待运行时期间切换历史，不清空新会话草稿与引用", async () => {
    expect(await delayedSubmit("conversation")).toEqual({ visibleDraft: "B new draft", visibleAttachments: ["B reference"], consumerStarts: 1 });
});

test("仍在原会话时正常清除已提交草稿", async () => {
    expect(await delayedSubmit("none")).toEqual({ visibleDraft: "", visibleAttachments: [], consumerStarts: 1 });
});

test("准备直出请求期间切换账号，不以新账号发起旧生成", async () => {
    expect(await delayedSubmit("account")).toEqual({ visibleDraft: "B new draft", visibleAttachments: ["B reference"], consumerStarts: 0 });
});
