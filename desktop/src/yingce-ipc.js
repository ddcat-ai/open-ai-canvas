const { isTrustedMainFrame } = require("./trusted-ipc");

// The renderer receives account data, never the opaque remote session.
function registerYingceIpc({ ipcMain, client, desktopLogin, getWindows, getOrigin, canGenerate, getAccountScope, getLegacyWorkspaceImport = () => ({ enabled: false }), journal, activate = async () => true, logout = () => client.logout(), enter = () => false }) {
    async function activateUser(user) {
        if (!user || !await activate(user)) throw new Error("登录已被新的账号操作取代");
        if (!await enter()) throw new Error("本地账号工作区未能启动，请重试");
        return { user };
    }
    const methods = {
        cachedAccount: () => client.cachedUser?.() || null,
        beginLogin: async () => activateUser(await desktopLogin.begin()),
        cancelLogin: () => desktopLogin.cancel(),
        continueOffline: async () => {
            const user = client.cachedUser?.();
            if (!user) throw new Error("此设备没有可离线使用的账号");
            return activateUser(user);
        },
        session: () => client.session(),
        logout,
        catalog: () => client.modelCatalog(),
        legacyWorkspaceImport: () => getLegacyWorkspaceImport(),
        // One IPC call is one user intent. The main process owns the credential
        // and idempotency key; failures are returned without automatic retries.
        generate: async (input, event) => {
            if (!canGenerate?.(event)) throw new Error("账号工作区已切换，请重新发起生成");
            const intent = client.createGenerationIntent(input);
            if (!input.recovery || !journal) return intent.send();
            const scope = getAccountScope();
            const context = input.recovery;
            if (context.capability !== input.capability) throw new Error("生成恢复信息与请求不匹配");
            journal.begin(scope, context);
            let result;
            try { result = await intent.send(); }
            catch (error) {
                try { journal.fail(scope, context, error); } catch { /* Keep the pending record for manual reconciliation. */ }
                throw error;
            }
            try { journal.complete(scope, context, result); }
            catch {
                const error = new Error("生成请求已返回，但本地恢复记录保存失败；请核对结果后再手动发起新请求。");
                error.reason = "outcome_unknown";
                throw error;
            }
            return result;
        },
        generationJournal: (_input, event) => {
            if (!canGenerate?.(event)) throw new Error("账号工作区已切换");
            const owner = getAccountScope();
            return { owner, records: journal.list(owner) };
        },
        acknowledgeGeneration: (input, event) => {
            if (!canGenerate?.(event)) throw new Error("账号工作区已切换");
            const owner = getAccountScope();
            if (!input || input.owner !== owner) throw new Error("账号工作区已切换，无法确认之前的生成记录");
            return journal.acknowledge(owner, input.id);
        },
        enter,
    };
    ipcMain.handle("yingce:request", async (event, method, input) => {
        const origin = getOrigin();
        if (!getWindows().some((window) => isTrustedMainFrame(event, window, origin))) throw new Error("Untrusted Yingce caller");
        if (!Object.hasOwn(methods, method)) throw new Error("Unsupported Yingce request");
        try {
            return { ok: true, data: await methods[method](input, event) };
        } catch (error) {
            return { ok: false, error: {
                message: error instanceof Error ? error.message : "影策请求失败",
                status: Number.isInteger(error?.status) ? error.status : undefined,
                code: Number.isInteger(error?.code) ? error.code : undefined,
                reason: typeof error?.reason === "string" ? error.reason : undefined,
                ...(error?.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
            } };
        }
    });
}

module.exports = { registerYingceIpc };
