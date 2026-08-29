import { expect, test } from "bun:test";

test("章节页直接生成到分镜制作，并通过共享选择器执行技能", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/chapters.tsx", import.meta.url)).text();
    expect(source).not.toContain("导入分镜");
    expect(source).not.toContain("importStoryboardToCanvas");
    expect(source).not.toContain("在画布中分镜");
    expect(source).toContain("生成到分镜制作");
    expect(source).toContain("replaceProjectUnitShots");
    expect(source).toContain("/storyboard`");
    expect(source).toContain('<SkillRuntimePicker profile="shortDrama"');
    expect(source.match(/<ModelPicker config=\{effectiveConfig\} capability="text"/g)).toHaveLength(2);
    expect(source).toContain("chapterAnalysisInput(selectedTextModel)");
    expect(source).toContain("const textModel = selectedTextModel");
    expect(source).toContain("generateChapterStoryboard");
});

test("镜头画面使用已绑定资产的 @ 引用编辑器", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    expect(source).toContain('name="plotDescription"');
    expect(source).toContain('<ShotAssetMentionTextarea variant="scene"');
    expect(source).toContain("resolveShotAssetMentionPrompt(basePrompt, shotAssetReferenceContext)");
    expect(source).toContain("<Image.PreviewGroup>");
});

test("技能选择器占满表单宽度", async () => {
    const source = await Bun.file(new URL("../src/components/skills/skill-runtime-picker.tsx", import.meta.url)).text();
    expect(source).toContain('style={{ width: "100%" }}');
});

test("画布分镜生成统一经过 Skill Runtime", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-storyboard.ts", import.meta.url)).text();
    expect(source).toContain('profile: "shortDrama"');
    expect(source).toContain("skillRuntime.prepare");
    expect(source).toContain("...skillExecution.metadata");
    expect(source).not.toContain("getSkillFile");
    expect(source).not.toContain("getSkillBundle");
});
