import { expect, test } from "bun:test";

test("password recovery keeps the approved login placement and dedicated route", async () => {
    const [loginSource, recoverySource, routerSource, sceneSource, authAPISource, emailSettingsSource, zhCatalog] = await Promise.all([
        Bun.file(new URL("../src/pages/auth/login.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/auth/forgot-password.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/router.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/auth/auth-scene.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/email-settings-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/i18n/messages/zh-CN.ts", import.meta.url)).text(),
    ]);

    // 文案经 i18n 键渲染，中文源文案保存在 zh-CN 目录中。
    expect(loginSource).toContain('label={t("auth.login.passwordLabel")}');
    expect(loginSource).toContain('t("auth.login.forgot")');
    expect(zhCatalog).toContain('forgot: "忘记密码？"');
    expect(loginSource).toContain("forgotPasswordURL");
    expect(routerSource).toContain('{ path: "/forgot-password"');
    expect(sceneSource).toContain('recovery: "ACCOUNT RECOVERY"');
    expect(recoverySource).toContain('t("auth.recovery.sent")');
    expect(zhCatalog).toContain("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱");
    expect(recoverySource).toContain('autoComplete="one-time-code"');
    expect(recoverySource).toContain('autoComplete="new-password"');
    expect(authAPISource).toContain('http.post<{ sent: boolean }>("/auth/password-reset-code"');
    expect(authAPISource).toContain('http.post<{ reset: boolean }>("/auth/password-reset"');
    expect(emailSettingsSource).toContain("发送注册与密码找回验证码");
});
