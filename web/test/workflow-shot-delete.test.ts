import { expect, test } from "bun:test";

test("镜头编辑器在保存按钮左侧提供带确认的删除操作", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    const deleteButton = source.indexOf(">删除镜头</Button>");
    const saveButton = source.indexOf(">保存脚本</Button>");

    expect(source).toContain("deleteProjectShot(projectId, shotId)");
    expect(source).toContain("脚本版本、资产引用和生成产物都会被删除");
    expect(source).toContain("okButtonProps: { danger: true }");
    expect(deleteButton).toBeGreaterThan(-1);
    expect(saveButton).toBeGreaterThan(deleteButton);
});

test("镜头删除 API 使用项目和镜头双重路径作用域", async () => {
    const source = await Bun.file(new URL("../src/services/api/projects.ts", import.meta.url)).text();

    expect(source).toContain("api.delete(`/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}`)");
});
