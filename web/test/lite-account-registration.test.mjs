import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const read = (name) => readFileSync(new URL(`../../desktop/activation/${name}`, import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function createActivationWindow(desktop) {
    const dom = new Window({ url: "http://localhost/peekreel-activation" });
    dom.desktop = desktop;
    const html = read("lite.html").replace(/<script src="\/peekreel-activation\/lite\.js"><\/script>/, "");
    dom.document.write(html);
    new Function("window", "document", "globalThis", read("lite.js"))(dom, dom.document, dom);
    return dom;
}

test("activation starts PKCE login and shows the returned error", async () => {
    let finishLogin;
    const calls = [];
    const dom = createActivationWindow({
        yingceRequest: async (method) => {
            calls.push(method);
            if (method === "beginLogin") return new Promise((resolve) => (finishLogin = resolve));
            return { ok: true, data: null };
        },
    });
    const byId = (id) => dom.document.getElementById(id);

    try {
        byId("login").click();
        expect(byId("login").disabled).toBe(true);
        expect(byId("cancel").hidden).toBe(false);
        expect(byId("status").textContent).toBe("正在打开影策控制台…");

        finishLogin({ ok: false, error: { message: "登录未完成" } });
        await tick();
        expect(byId("status").textContent).toBe("登录未完成");
        expect(byId("login").disabled).toBe(false);
        expect(byId("cancel").hidden).toBe(true);
        expect(calls).toContain("beginLogin");
    } finally {
        dom.happyDOM.abort();
    }
});

test("activation offers offline resume only after finding a cached account", async () => {
    const calls = [];
    const dom = createActivationWindow({
        yingceRequest: async (method) => {
            calls.push(method);
            if (method === "cachedAccount") return { ok: true, data: { id: "user-1", displayName: "本地账号" } };
            return { ok: true, data: null };
        },
    });
    const byId = (id) => dom.document.getElementById(id);

    try {
        await tick();
        expect(byId("offline").hidden).toBe(false);
        expect(byId("status").textContent).toContain("本地账号");

        byId("offline").click();
        await tick();
        expect(calls).toEqual(["cachedAccount", "continueOffline"]);
        expect(byId("status").textContent).toBe("正在打开本地工作区…");
    } finally {
        dom.happyDOM.abort();
    }
});
