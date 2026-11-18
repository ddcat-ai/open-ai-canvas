import { describe, expect, test } from "bun:test";
import { agentReferenceIds, buildTryOnJobs, defaultTryOnDraft, needsAgentPlan, parseTryOnFaceRead, tryOnAgentPrompt, type TryOnDraft, type TryOnImage } from "@/pages/ecommerce/tryon/tryon-plan";

const image = (slot: TryOnImage["slot"], id: string): TryOnImage => ({ id, resourceId: id, slot, name: id, previewUrl: `/api/resources/${id}/file` });
const market = { platform: "taobao", platformLabel: "淘宝", language: "zh-CN", languageLabel: "中文" };
const knowledge = { source: "builtin" as const, entries: [], knowledge: "" };
const draft = (fn: TryOnDraft["fn"], images: TryOnImage[]): TryOnDraft => ({ ...defaultTryOnDraft(), fn, consent: true, images: { [fn]: images } });

describe("换脸只换五官", () => {
    const source = draft("face-swap", [image("model", "m1"), image("face", "f1")]);

    test("换脸先读图：模特图在前、脸部参考在后，智能换头不读图", () => {
        expect(needsAgentPlan(source)).toBe(true);
        expect(agentReferenceIds(source)).toEqual(["m1", "f1"]);
        expect(needsAgentPlan(draft("smart-face", [image("model", "m1")]))).toBe(true);
        expect(agentReferenceIds(draft("smart-face", [image("model", "m1")]))).toEqual(["m1"]);
        expect(needsAgentPlan(draft("smart-head", [image("model", "m1")]))).toBe(false);
        const prompt = tryOnAgentPrompt(source, knowledge, market);
        expect(prompt).toContain("不能包含发际线");
        expect(prompt).toContain('"box"');
    });

    test("读图结果：发型写成文字锁定，裁好的五官图替换脸部参考，参考人的光头不带入", () => {
        const read = parseTryOnFaceRead('```json\n{"models":[{"hair":"黑色短发侧分，发量浓密"}],"faces":[{"hair":"光头","box":[300,200,700,640]}]}\n```', source);
        expect(read.boxes).toEqual([[300, 200, 700, 640]]);
        const [job] = buildTryOnJobs(source, { shots: [], faceRead: { ...read, crops: ["crop1"] } });
        expect(job.references.map((item) => item.resourceId)).toEqual(["m1", "crop1"]);
        expect(job.prompt).toContain("黑色短发侧分");
        expect(job.prompt).toContain("不能变成光头");
        expect(job.prompt).toContain("（光头）不能出现在成片上");
        expect(job.prompt).toContain("只裁出五官区域");
    });

    test("框不可信或看不清时不裁、不写；没有识别出发型时报错走纯提示词", () => {
        const read = parseTryOnFaceRead('{"models":[{"hair":"长卷发"}],"faces":[{"hair":"看不清","box":[500,500,510,505]}]}', source);
        expect(read.boxes).toEqual([null]);
        expect(read.faceHair).toEqual([""]);
        expect(() => parseTryOnFaceRead('{"models":[{"hair":"看不清"}],"faces":[]}', source)).toThrow();
        const [job] = buildTryOnJobs(source);
        expect(job.references.map((item) => item.resourceId)).toEqual(["m1", "f1"]);
        expect(job.prompt).toContain("只换脸不换头");
    });

    test("智能换脸带上原图发型锁定，智能换头不带", () => {
        const smart = draft("smart-face", [image("model", "m1")]);
        const read = parseTryOnFaceRead('{"models":[{"hair":"栗色长直发中分"}],"faces":[]}', smart);
        const [job] = buildTryOnJobs(smart, { shots: [], faceRead: read });
        expect(job.prompt).toContain("栗色长直发中分");
        const [head] = buildTryOnJobs(draft("smart-head", [image("model", "m1")]), { shots: [], faceRead: read });
        expect(head.prompt).not.toContain("栗色长直发中分");
    });
});
