import { expect, test } from "bun:test";

const legacyToken = "legacy-master-token-canary";

test("legacy query and storage secrets are removed before application modules load", async () => {
    const module = await import("../src/services/local-runtime-bootstrap").catch(() => ({}));
    const runBootstrap = (
        module as {
            runLocalRuntimeBootstrap?: (environment: BootstrapEnvironment, loadApplication: (state: { legacyDeepLinkRejected: boolean }) => void) => { legacyDeepLinkRejected: boolean };
        }
    ).runLocalRuntimeBootstrap;
    expect(typeof runBootstrap).toBe("function");
    if (!runBootstrap) return;

    let href = `http://127.0.0.1:3001/canvas/demo?keep=1&agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=${legacyToken}#timeline`;
    const storage = new Map([
        ["canvas-agent-url", "http://127.0.0.1:17371"],
        ["canvas-agent-token", legacyToken],
        ["unrelated", "keep"],
    ]);
    let rendered = false;
    const state = runBootstrap(
        {
            get href() {
                return href;
            },
            replaceUrl(url) {
                href = new URL(url, href).toString();
            },
            removeStorageItem(key) {
                storage.delete(key);
            },
        },
        (bootstrapState) => {
            rendered = true;
            expect(href).toBe("http://127.0.0.1:3001/canvas/demo?keep=1#timeline");
            expect(storage.has("canvas-agent-url")).toBe(false);
            expect(storage.has("canvas-agent-token")).toBe(false);
            expect(storage.get("unrelated")).toBe("keep");
            expect(JSON.stringify(bootstrapState)).not.toContain(legacyToken);
        },
    );

    expect(rendered).toBe(true);
    expect(state).toEqual({ legacyDeepLinkRejected: true });
    expect(href).not.toContain(legacyToken);
    const readState = (
        module as {
            readLocalRuntimeBootstrapState?: () => { legacyDeepLinkRejected: boolean };
        }
    ).readLocalRuntimeBootstrapState;
    expect(typeof readState).toBe("function");
    expect(readState?.()).toEqual({ legacyDeepLinkRejected: true });
});

type BootstrapEnvironment = {
    readonly href: string;
    replaceUrl(url: string): void;
    removeStorageItem(key: string): void;
};
