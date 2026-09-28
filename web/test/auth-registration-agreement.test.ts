import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("注册服务协议", () => {
    test("确认密码后展示协议入口，默认未同意且保留注册限流", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/auth/register.tsx"), "utf8");
        const passwordIndex = source.indexOf('label="确认密码"');
        const agreementIndex = source.indexOf("Checkbox checked={agreementAccepted}");
        const submitIndex = source.indexOf('htmlType="submit"');

        expect(passwordIndex).toBeGreaterThanOrEqual(0);
        expect(agreementIndex).toBeGreaterThan(passwordIndex);
        expect(submitIndex).toBeGreaterThan(agreementIndex);
        expect(source).toContain("[agreementAccepted, setAgreementAccepted] = useState(false)");
        expect(source).toContain("disabled={disabled || registerCountdown > 0 || !agreementAccepted}");
        expect(source).toContain("if (registering.current || registerCountdown > 0) return;");
        expect(source).toContain("disabled={!agreementAccepted}");
    });

    test("普通注册与 Linux.do 注册传递同意状态，登录入口保留原合同", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/auth/register.tsx"), "utf8");
        const login = readFileSync(resolve(import.meta.dir, "../src/pages/auth/login.tsx"), "utf8");
        const api = readFileSync(resolve(import.meta.dir, "../src/services/api/auth.ts"), "utf8");

        expect(page).toContain("acceptedTerms: agreementAccepted");
        expect(page).toContain("agreementAccepted ? linuxDOLoginURL(next, true) : undefined");
        expect(page).toContain("message.warning(`请先同意${agreementTitle}`)");
        expect(login).toContain("linuxDOLoginURL(next)");
        expect(api).toContain("acceptedTerms: boolean");
        expect(api).toContain("acceptedTerms?: boolean");
    });

    test("协议标题与条款来自后台配置而不是硬编码常量", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/auth/register.tsx"), "utf8");

        expect(page).not.toContain("SERVICE_AGREEMENT");
        expect(page).toContain("settings?.agreementTitle");
        expect(page).toContain("settings?.agreementContent");
        expect(page).toContain("title={agreementTitle}");
        expect(page).toContain("agreementParagraphs.map");
        // 条款留空时的占位提示；断言关键词而非整句，允许后续补充指引文案。
        expect(page).toContain("服务协议内容待补充");
    });

    test("读取设置失败时不猜协议标题，改为提示并允许重新读取", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/auth/register.tsx"), "utf8");

        // 失败必须留下状态位，不能静默降级成品牌名拼接的协议名。
        expect(page).toContain("[settingsFailed, setSettingsFailed] = useState(false)");
        expect(page).toContain("setSettingsFailed(true)");
        expect(page).toContain("读取注册设置失败，暂时无法确认服务协议名称与条款。");
        expect(page).toContain("setSettingsReloadKey((value) => value + 1)");
        // 协议入口只在拿到设置后渲染，读不到配置就不展示协议名。
        expect(page).toContain("{settings ? (");
    });

    test("公开认证设置暴露协议字段，管理接口可回传协议正文", () => {
        const auth = readFileSync(resolve(import.meta.dir, "../src/services/api/auth.ts"), "utf8");
        const wallet = readFileSync(resolve(import.meta.dir, "../src/services/api/wallet.ts"), "utf8");
        const panel = readFileSync(resolve(import.meta.dir, "../src/pages/admin/components/access-settings-panel.tsx"), "utf8");

        expect(auth).toContain("agreementTitle?: string; agreementContent?: string");
        expect(wallet).toContain("agreementTitle?: string");
        expect(wallet).toContain("agreementContent?: string");
        expect(panel).toContain("服务协议名称与条款");
        expect(panel).toContain("saveAgreement");
    });
});
