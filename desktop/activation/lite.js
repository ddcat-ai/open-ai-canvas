(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const login = $("login");
    const cancel = $("cancel");
    const offline = $("offline");
    const status = $("status");
    let busy = false;

    async function request(method, input) {
        const result = await window.desktop.yingceRequest(method, input);
        if (!result.ok) throw new Error(result.error?.message || "影策请求失败");
        return result.data;
    }

    function setBusy(value) {
        busy = value;
        login.disabled = value;
        offline.disabled = value;
        cancel.hidden = !value;
    }

    login.addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        status.textContent = "正在打开影策控制台…";
        try {
            await request("beginLogin");
        } catch (error) {
            status.textContent = error.message || "登录未完成，请重试。";
        } finally {
            setBusy(false);
        }
    });

    cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        try { await request("cancelLogin"); }
        catch (error) { status.textContent = error.message || "无法取消登录。"; }
        finally { cancel.disabled = false; }
    });

    offline.addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        status.textContent = "正在打开本地工作区…";
        try { await request("continueOffline"); }
        catch (error) { status.textContent = error.message || "本地工作区暂时无法打开。"; }
        finally { setBusy(false); }
    });

    void request("cachedAccount").then((user) => {
        if (!user?.id) return;
        offline.hidden = false;
        status.textContent = `${user.displayName || user.username || "已登录账号"} 可继续使用本机资料。`;
    }).catch(() => undefined);
}());
