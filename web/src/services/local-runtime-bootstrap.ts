const LEGACY_STORAGE_KEYS = ["canvas-agent-url", "canvas-agent-token"] as const;
const LEGACY_QUERY_KEYS = ["agentUrl", "agentToken"] as const;

export type LocalRuntimeBootstrapState = {
    legacyDeepLinkRejected: boolean;
};

let currentState: LocalRuntimeBootstrapState = { legacyDeepLinkRejected: false };

export function readLocalRuntimeBootstrapState() {
    return { ...currentState };
}

type LocalRuntimeBootstrapEnvironment = {
    readonly href: string;
    replaceUrl(url: string): void;
    removeStorageItem(key: string): void;
};

export function runLocalRuntimeBootstrap(
    environment: LocalRuntimeBootstrapEnvironment,
    loadApplication: (state: LocalRuntimeBootstrapState) => void,
) {
    const url = new URL(environment.href);
    const legacyDeepLinkRejected = LEGACY_QUERY_KEYS.some((key) => url.searchParams.has(key));
    if (legacyDeepLinkRejected) {
        for (const key of LEGACY_QUERY_KEYS) url.searchParams.delete(key);
        environment.replaceUrl(`${url.pathname}${url.search}${url.hash}`);
    }
    for (const key of LEGACY_STORAGE_KEYS) environment.removeStorageItem(key);

    const state = { legacyDeepLinkRejected };
    currentState = state;
    loadApplication(state);
    return state;
}
