import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const columnsSource = await readFile(new URL("../src/pages/admin/users/users-columns.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/pages/admin/users/users-panel.tsx", import.meta.url), "utf8");

test("用户行区分停用与永久删除，并说明保留与阻止范围", () => {
    expect(columnsSource).toContain('label: "删除用户"');
    expect(columnsSource).toContain("user.id === actorId");
    expect(panelSource).toContain("onDelete: deleteUser");
    expect(panelSource).toContain("getAdminUserDeletePreflight(user.id)");
    expect(panelSource).toContain("await deleteAdminUser(user.id)");
    expect(panelSource).toContain("await disableAdminUser(user.id)");
    expect(panelSource).toContain("确认永久删除");
    expect(panelSource).toContain("历史账务与审计记录会保留并去标识化");
    expect(panelSource).toContain("素材、画布和任务不会自动清理");
    expect(panelSource).toContain("暂时无法删除用户");
});
