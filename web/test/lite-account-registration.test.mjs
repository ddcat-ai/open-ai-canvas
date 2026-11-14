import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const read = (name) => readFileSync(new URL(`../../desktop/activation/${name}`, import.meta.url), "utf8");

test("registration explains disabled and unavailable settings after switching tabs", async () => {
    const dom = new Window({ url: "http://localhost/peekreel-activation" });
    let resolveSettings;
    let calls = 0;
    dom.desktop = { yingceRequest: async () => {
        calls++;
        if (calls === 1) return new Promise((resolve) => { resolveSettings = resolve; });
        return { ok: true, data: { firstUser: false, registrationEnabled: false } };
    } };
    try {
        dom.document.write(read("lite.html"));
        dom.eval(read("lite-policy.js"));
        dom.eval(read("lite.js"));
        const byId = (id) => dom.document.getElementById(id);
        byId("register-tab").click();
        expect(byId("status").textContent).toContain("正在获取注册设置");
        expect(byId("reload").disabled).toBe(true);
        resolveSettings({ ok: false, error: { message: "网络不可用" } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(byId("status").textContent).toBe("网络不可用");
        expect(byId("reload").hidden).toBe(false);
        expect(byId("reload").disabled).toBe(false);
        byId("login-tab").click();
        byId("register-tab").click();
        expect(byId("status").textContent).toBe("网络不可用");
        byId("reload").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(byId("status").textContent).toContain("未开放注册");
        expect(byId("submit").disabled).toBe(true);
        byId("login-tab").click();
        byId("register-tab").click();
        expect(byId("status").textContent).toContain("未开放注册");
        expect(calls).toBe(2);
    } finally {
        dom.happyDOM.abort();
    }
});

test("registration settings can be refreshed after the server opens registration", async () => {
    const dom = new Window({ url: "http://localhost/peekreel-activation" });
    let calls = 0;
    dom.desktop = { yingceRequest: async () => {
        calls++;
        return { ok: true, data: calls === 1
            ? { firstUser: false, registrationEnabled: false, emailRegistration: true }
            : { firstUser: false, registrationEnabled: true, emailRegistration: true } };
    } };
    try {
        dom.document.write(read("lite.html"));
        dom.eval(read("lite-policy.js"));
        dom.eval(read("lite.js"));
        const byId = (id) => dom.document.getElementById(id);
        byId("register-tab").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(byId("submit").disabled).toBe(true);
        expect(byId("reload").hidden).toBe(false);

        byId("reload").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls).toBe(2);
        expect(byId("submit").disabled).toBe(false);
        const methodOptions = dom.document.querySelector('[name="method"]').options;
        expect(methodOptions.length).toBe(1);
        expect(methodOptions[0].value).toBe("email");
    } finally {
        dom.happyDOM.abort();
    }
});
