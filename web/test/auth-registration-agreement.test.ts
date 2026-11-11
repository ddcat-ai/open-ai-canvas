import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

describe("注册服务协议", () => {
    test("一体表单确认密码后展示协议入口，默认未同意且保留注册限流", () => {
        const source = read("components/auth/auth-login-form.tsx");
        const passwordIndex = source.indexOf('aria-label={t("auth.register.confirmPassword")}');
        const agreementIndex = source.indexOf("Checkbox checked={agreementAccepted}");
        const submitIndex = source.indexOf('htmlType="submit"');

        expect(passwordIndex).toBeGreaterThanOrEqual(0);
        expect(agreementIndex).toBeGreaterThan(passwordIndex);
        expect(submitIndex).toBeGreaterThan(agreementIndex);
        expect(source).toContain("[agreementAccepted, setAgreementAccepted] = useState(false)");
        expect(source).toContain("(Boolean(pending) && !agreementAccepted)");
        expect(source).toContain("if (submitting || retryCountdown > 0) return;");
    });

    test("一体表单注册与 Linux.do 注册传递同意状态", () => {
        const login = read("components/auth/auth-login-form.tsx");
        const api = read("services/api/auth.ts");

        expect(login).toContain("acceptedTerms: agreementAccepted");
        expect(login).toContain('reason === "account_not_registered"');
        expect(login).toContain("autoRegister: canRegister");
        // 未勾选协议时不携带同意标志，Linux.do 只能登录已绑定账号。
        expect(login).toContain("linuxDOLoginURL(next, agreementAccepted || undefined)");
        expect(login).toContain('message.warning(t("auth.register.agreeFirst", { title: agreement.title }))');
        expect(api).toContain("acceptedTerms: boolean");
        expect(api).toContain("acceptedTerms?: boolean");
    });

    test("协议标题与条款来自后台配置而不是硬编码常量", () => {
        const parts = read("components/auth/auth-form-parts.tsx");
        const login = read("components/auth/auth-login-form.tsx");

        expect(login).not.toContain("SERVICE_AGREEMENT");
        expect(parts).toContain("settings?.agreementTitle");
        expect(parts).toContain("settings?.agreementContent");
        expect(parts).toContain("title={title}");
        expect(parts).toContain("paragraphs.map");
        expect(login).toContain("<AuthAgreementDialog open={agreementOpen} title={agreement.title}");
        // 条款留空时的占位提示；断言关键词而非整句，允许后续补充指引文案。中文源文案在 zh-CN 目录。
        const zhCatalog = read("i18n/messages/zh-CN.ts");
        expect(parts).toContain('t("auth.register.agreementEmpty")');
        expect(zhCatalog).toContain("服务协议内容待补充");
    });

    test("读取设置失败时不猜协议标题，改为提示并允许重新读取", () => {
        const login = read("components/auth/auth-login-form.tsx");
        const panel = read("components/auth/auth-panel.tsx");
        const store = read("stores/use-auth-settings-store.ts");

        // 失败必须留下状态位，不能静默降级成品牌名拼接的协议名。
        expect(store).toContain('set({ status: "error" })');
        expect(panel).toContain("settingsFailed={failed}");
        const zhCatalog = read("i18n/messages/zh-CN.ts");
        expect(login).toContain('t("auth.register.settingsFailed")');
        expect(zhCatalog).toContain("读取注册设置失败，暂时无法确认服务协议名称与条款。");
        expect(login).toContain("onClick={onReloadSettings}");
        // 协议入口只在拿到设置后渲染，读不到配置就不展示协议名。
        expect(login).toContain("const showAgreement = Boolean(settings && (pending || canRegister || showOIDC));");
        expect(login).toContain("{showAgreement ? (");
    });

    test("公开认证设置暴露协议字段，管理接口可回传协议正文", () => {
        const auth = read("services/api/auth.ts");
        const wallet = read("services/api/wallet.ts");
        const panel = read("pages/admin/components/access-settings-panel.tsx");

        expect(auth).toContain("agreementTitle?: string;");
        expect(auth).toContain("agreementContent?: string;");
        expect(wallet).toContain("agreementTitle?: string");
        expect(wallet).toContain("agreementContent?: string");
        expect(panel).toContain("服务协议名称与条款");
        expect(panel).toContain("saveAgreement");
    });
});
