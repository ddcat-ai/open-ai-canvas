import { expect, test } from "bun:test";
import vm from "node:vm";
import { buildThemeSkinInstallScript } from "../scripts/export-theme-skins";
import { LONGYING_INK_SKIN } from "@/themes/longying-ink/skin";
import { YUNHE_XIANGUAN_SKIN } from "@/themes/yunhe-xianguan/skin";

for (const scenario of ["success", "duplicate", "conflict", "unauthorized", "concurrent", "full", "save-failed", "readback-drift"]) {
    test(`主题皮肤安装器：${scenario}`, async () => {
        let setting: Record<string, unknown> = { brandName: "测试站点", skinId: "classic", skinThemes: [{ id: "classic" }], canvas: { agentName: "原助手" } };
        if (scenario === "duplicate") setting.skinThemes = [LONGYING_INK_SKIN, YUNHE_XIANGUAN_SKIN];
        if (scenario === "conflict") setting.skinThemes = [{ ...YUNHE_XIANGUAN_SKIN, name: "已有自定义名称" }];
        if (scenario === "full") setting.skinThemes = Array.from({ length: 15 }, (_, i) => ({ id: `skin-${i}` }));
        const before = structuredClone(setting);
        let writes = 0;
        let reads = 0;
        const errors: unknown[][] = [];
        await vm.runInNewContext(buildThemeSkinInstallScript(), {
            console: { log() {}, error: (...args: unknown[]) => errors.push(args) },
            fetch: async (url: string, options: { method: string; body?: string }) => {
                expect(url).toBe("/api/admin/settings/appearance");
                if (scenario === "unauthorized") return { ok: false, status: 401, json: async () => ({ code: 401 }) };
                if (options.method === "PATCH") {
                    writes++;
                    if (scenario === "save-failed") return { ok: false, status: 500, json: async () => ({ code: 1 }) };
                    setting = JSON.parse(options.body!);
                } else {
                    reads++;
                    if (scenario === "concurrent" && reads === 2) setting.brandName = "其他操作更新的名字";
                    if (scenario === "readback-drift" && reads === 3) setting.skinId = "unexpected";
                }
                return { ok: true, status: 200, json: async () => ({ code: 0, data: { setting: structuredClone(setting) } }) };
            },
        });
        if (scenario === "success") {
            expect(writes).toBe(1);
            expect(errors).toHaveLength(0);
            expect(setting.skinThemes).toEqual([...(before.skinThemes as unknown[]), LONGYING_INK_SKIN, YUNHE_XIANGUAN_SKIN]);
            expect({ ...setting, skinThemes: before.skinThemes }).toEqual(before);
        } else if (scenario === "duplicate") {
            expect(writes).toBe(0);
            expect(errors).toHaveLength(0);
        } else {
            expect(errors).toHaveLength(1);
            expect(writes).toBe(["save-failed", "readback-drift"].includes(scenario) ? 1 : 0);
        }
    });
}
