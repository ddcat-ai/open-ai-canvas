const ACTIVE_USER_SCOPE_KEY = "yingce:active-user-scope";
const GUEST_SCOPE = "guest";
let userScopedPersistenceSuppressionDepth = 0;
let activeUserScope = GUEST_SCOPE;
let observedStorageScope = GUEST_SCOPE;
let sessionVersion = 0;
let sessionInvalidated = false;
let sessionController = new AbortController();
let sessionWindow: Window | undefined;
let removeWindowListeners: (() => void) | undefined;
let storageHintAvailable = true;
const invalidationListeners = new Set<() => void>();

export type UserSessionSnapshot = {
    scope: string;
    version: number;
    signal: AbortSignal;
};

function readStorageScope() {
    try {
        return window.localStorage.getItem(ACTIVE_USER_SCOPE_KEY) || GUEST_SCOPE;
    } catch {
        return undefined;
    }
}

function advanceSessionVersion() {
    sessionVersion += 1;
    sessionController.abort();
    sessionController = new AbortController();
}

function observeStorageScope(scope: string | undefined) {
    if (scope === undefined || scope === observedStorageScope) return;
    observedStorageScope = scope;
    // 只使旧标签失效，不接管它的内存数据。重新认证并清空内存后才能切换持久化 scope。
    sessionInvalidated = true;
    advanceSessionVersion();
    for (const listener of invalidationListeners) listener();
}

function ensureSessionWindow() {
    const browser = typeof window === "undefined" ? undefined : window;
    if (sessionWindow === browser) return;
    removeWindowListeners?.();
    sessionWindow = browser;
    advanceSessionVersion();
    sessionInvalidated = false;
    storageHintAvailable = true;
    activeUserScope = browser ? (readStorageScope() ?? GUEST_SCOPE) : GUEST_SCOPE;
    observedStorageScope = activeUserScope;
    if (!browser?.addEventListener) return;
    const onStorage = (event: StorageEvent) => {
        if (event.key === ACTIVE_USER_SCOPE_KEY || event.key === null) {
            observeStorageScope(event.key === null ? GUEST_SCOPE : event.newValue || GUEST_SCOPE);
        }
    };
    const onFocus = () => observeStorageScope(readStorageScope());
    browser.addEventListener("storage", onStorage);
    browser.addEventListener("focus", onFocus);
    browser.addEventListener("pageshow", onFocus);
    removeWindowListeners = () => {
        browser.removeEventListener("storage", onStorage);
        browser.removeEventListener("focus", onFocus);
        browser.removeEventListener("pageshow", onFocus);
    };
}

function checkStorageScope() {
    ensureSessionWindow();
    if (sessionWindow && storageHintAvailable) observeStorageScope(readStorageScope());
}

function changedSessionError() {
    return new DOMException("账号已切换，请等待当前账号恢复后重试", "AbortError");
}

export function subscribeUserSessionInvalidation(listener: () => void) {
    ensureSessionWindow();
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
}

export function captureUserSession(allowInvalidated = false): UserSessionSnapshot {
    checkStorageScope();
    if (sessionInvalidated && !allowInvalidated) throw changedSessionError();
    return { scope: activeUserScope, version: sessionVersion, signal: sessionController.signal };
}

export function assertCurrentUserSession(snapshot: UserSessionSnapshot, allowInvalidated = false) {
    checkStorageScope();
    if (snapshot.version !== sessionVersion || snapshot.signal.aborted || (sessionInvalidated && !allowInvalidated)) throw changedSessionError();
}

export function isUserSessionInvalidated() {
    ensureSessionWindow();
    return sessionInvalidated;
}

export function withUserScopedPersistenceSuppressed<T>(operation: () => T) {
    userScopedPersistenceSuppressionDepth += 1;
    try {
        return operation();
    } finally {
        userScopedPersistenceSuppressionDepth -= 1;
    }
}

export function isUserScopedPersistenceSuppressed() {
    return userScopedPersistenceSuppressionDepth > 0;
}

export function getActiveUserScope() {
    ensureSessionWindow();
    return activeUserScope;
}

export function setActiveUserScope(userId?: string | null, expectedSession?: UserSessionSnapshot) {
    ensureSessionWindow();
    if (expectedSession) assertCurrentUserSession(expectedSession, true);
    const scope = userId || GUEST_SCOPE;
    if (activeUserScope !== scope || sessionInvalidated) advanceSessionVersion();
    activeUserScope = scope;
    observedStorageScope = scope;
    sessionInvalidated = false;
    if (!sessionWindow) return;
    try {
        window.localStorage.setItem(ACTIVE_USER_SCOPE_KEY, scope);
        storageHintAvailable = true;
    } catch {
        // 禁用或写满 localStorage 时，本标签仍以已认证的内存身份为准。
        storageHintAvailable = false;
    }
}

export function scopedStorageKey(name: string, scope = getActiveUserScope()) {
    return `${name}:user:${scope}`;
}

export const scopedLocalStorage = {
    getItem: (name: string) => {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(scopedStorageKey(name));
    },
    setItem: (name: string, value: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.setItem(scopedStorageKey(name), value);
    },
    removeItem: (name: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.removeItem(scopedStorageKey(name));
    },
};
