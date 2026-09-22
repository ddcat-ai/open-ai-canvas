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
        expect(page).toContain("请先同意影策服务协议");
        expect(login).toContain("linuxDOLoginURL(next)");
        expect(api).toContain("acceptedTerms: boolean");
        expect(api).toContain("acceptedTerms?: boolean");
    });

    test("协议使用影策标题并提供正文承载区域", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/auth/register.tsx"), "utf8");

        expect(page).toContain('title="影策服务协议"');
        expect(page).toContain("SERVICE_AGREEMENT.map");
        expect(page).toContain("服务协议内容待补充。");
    });
});
