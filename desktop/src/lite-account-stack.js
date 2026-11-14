const path = require("node:path");

// Each candidate owns all resources that may outlive startup. The lifecycle
// retains it until stop succeeds, including when startup is superseded.
function createLiteAccountStack({ account, origin, createBackend, createBrowserHost,
    createBridge, authenticate, installCookie, syncSystemCatalog, syncChannels, onBridgeStatus, log = () => {} }) {
    const accountDir = path.dirname(account.dataDir);
    const bridgeDir = path.join(accountDir, "doubao-bridge");
    const profileDir = path.join(bridgeDir, "profiles");
    const controller = new AbortController();
    let published = false;
    let stopping = false;
    let localSession = "";
    let syncQueue = Promise.resolve();
    let hostStarting;
    let background;
    const host = createBrowserHost(account.scope);
    const backend = createBackend(account.dataDir);
    const bridge = createBridge({
        dataDir: path.join(bridgeDir, "data"), profileDir, origin,
        getBrowserHostInfo: () => {
            if (!hostStarting) hostStarting = host.start();
            return hostStarting;
        },
        onStatus: (status) => {
            if (!published || stopping) return;
            onBridgeStatus?.(status);
            if (["ready", "login-needed"].includes(status.phase)) queueSync();
        },
    });

    function queueSync() {
        if (!published || stopping) return syncQueue;
        syncQueue = syncQueue.then(async () => {
            if (stopping) return;
            await syncChannels({ backend, bridge, credentials: account.credentials, localSession, signal: controller.signal });
        }).catch((error) => { if (!controller.signal.aborted) log(error); });
        return syncQueue;
    }

    return {
        scope: account.scope, backend, bridge, host, relayKey: account.credentials.relayKey,
        legacyProfile: account.legacyProfile === true,
        legacySourceScope: account.legacySourceScope || "",
        get localSession() { return localSession; },
        async start(signal) {
            signal.throwIfAborted();
            await backend.start();
            signal.throwIfAborted();
            localSession = await authenticate({ baseUrl: backend.baseUrl, credentials: account.credentials, signal });
            signal.throwIfAborted();
            await installCookie(account.scope, localSession);
            signal.throwIfAborted();
            if (syncSystemCatalog) {
                try {
                    await syncSystemCatalog({ backend, credentials: account.credentials, localSession, signal });
                } catch (error) {
                    signal.throwIfAborted();
                    log(error);
                }
            }
            signal.throwIfAborted();
        },
        publish() {
            published = true;
            queueSync();
            background = Promise.resolve().then(() => {
                if (!stopping) return bridge.start();
            }).catch((error) => {
                if (!stopping) { log(error); bridge.scheduleRestart(); }
            });
        },
        sync: queueSync,
        async retryBridge() {
            if (!published || stopping) return false;
            await bridge.start();
            return published && !stopping;
        },
        async stop() {
            published = false;
            stopping = true;
            controller.abort();
            // In-flight local writes must settle before the backend is stopped.
            await syncQueue;
            const results = await Promise.allSettled([
                Promise.resolve().then(() => bridge.stop()),
                Promise.resolve().then(() => host.stop()),
                Promise.resolve().then(() => backend.stop()),
            ]);
            await background;
            const failure = results.find((result) => result.status === "rejected");
            if (failure) throw failure.reason;
        },
    };
}

module.exports = { createLiteAccountStack };
