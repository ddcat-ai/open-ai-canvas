const ACTIVE_USER_SCOPE_KEY = "infinite-canvas:active-user-scope";
const GUEST_SCOPE = "guest";

export function getActiveUserScope() {
    if (typeof window === "undefined") return GUEST_SCOPE;
    return window.localStorage.getItem(ACTIVE_USER_SCOPE_KEY) || GUEST_SCOPE;
}

export function setActiveUserScope(userId?: string | null) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACTIVE_USER_SCOPE_KEY, userId || GUEST_SCOPE);
}

export function scopedStorageKey(name: string) {
    return `${name}:user:${getActiveUserScope()}`;
}

export const scopedLocalStorage = {
    getItem: (name: string) => {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(scopedStorageKey(name));
    },
    setItem: (name: string, value: string) => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(scopedStorageKey(name), value);
    },
    removeItem: (name: string) => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(scopedStorageKey(name));
    },
};
