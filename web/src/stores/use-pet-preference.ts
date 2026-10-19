import { create } from "zustand";
import { getPetPreference, savePetPreference, type PetPreference } from "@/services/api/appearance";
import { DEFAULT_PET_PREFERENCE, sanitizePetPreference } from "@/lib/canvas/pet-menu";

type State = {
    scope: string;
    preference: PetPreference;
    loading: boolean;
    resolved: boolean;
    saving: boolean;
    error: string;
    pending: boolean;
    load: (scope: string, refresh?: boolean) => Promise<void>;
    update: (patch: Partial<PetPreference>) => void;
    retry: () => Promise<void>;
};
let epoch = 0,
    sequence = 0,
    worker = false,
    ready = false;
const key = (scope: string) => `yinghui:pet-preference:${scope}`;
function cache(scope: string, p: PetPreference, pending = false) {
    try {
        localStorage.setItem(key(scope), JSON.stringify({ ...p, pending }));
    } catch {
        /* Local storage may be unavailable; cloud remains authoritative. */
    }
}
function cached(scope: string) {
    try {
        return sanitizePetPreference(JSON.parse(localStorage.getItem(key(scope)) || "{}"));
    } catch {
        return { ...DEFAULT_PET_PREFERENCE };
    }
}
function cachedPending(scope: string) {
    try {
        return JSON.parse(localStorage.getItem(key(scope)) || "{}").pending === true;
    } catch {
        return false;
    }
}

export const usePetPreference = create<State>((set, get) => ({
    scope: "",
    preference: { ...DEFAULT_PET_PREFERENCE },
    loading: true,
    resolved: false,
    saving: false,
    error: "",
    pending: false,
    load: async (scope, refresh = false) => {
        const same = get().scope === scope;
        if (same && (!refresh || get().loading || get().pending || get().saving)) return;
        const token = ++epoch;
        ready = false;
        worker = false;
        const local = same ? get().preference : cached(scope),
            pending = scope !== "guest" && cachedPending(scope);
        set({ scope, preference: local, loading: true, resolved: same && get().resolved, saving: false, error: "", pending });
        if (scope === "guest") {
            ready = true;
            set({ loading: false, resolved: true });
            return;
        }
        try {
            const preference = await getPetPreference();
            if (epoch !== token) return;
            if (pending) {
                set({ loading: false, resolved: true, pending: true, error: "有尚未保存的本机设置，请重试保存" });
                return;
            }
            ready = true;
            cache(scope, preference);
            set({ preference, loading: false, resolved: true });
        } catch {
            if (epoch === token) set({ loading: false, resolved: true, error: "云端暂不可用，调整将暂存本机" });
        }
    },
    update: (patch) => {
        const state = get();
        if (state.loading) return;
        const preference = sanitizePetPreference({ ...state.preference, ...patch });
        sequence++;
        cache(state.scope, preference, state.scope !== "guest");
        set({ preference, pending: state.scope !== "guest", error: state.scope === "guest" ? "" : state.error });
        if (state.scope !== "guest" && ready) void flush();
    },
    retry: async () => {
        const state = get(),
            token = epoch,
            scope = state.scope;
        if (state.saving || scope === "guest") return;
        set({ saving: true, error: "" });
        try {
            const remote = await getPetPreference();
            if (epoch !== token) return;
            ready = true;
            set({ preference: { ...get().preference, revision: remote.revision }, saving: false, pending: true });
            void flush();
        } catch {
            if (epoch === token) set({ saving: false, error: "保存失败，已保留本机设置，请重试" });
        }
    },
}));
async function flush() {
    if (worker) return;
    worker = true;
    const token = epoch;
    try {
        while (usePetPreference.getState().pending && token === epoch) {
            const state = usePetPreference.getState(),
                version = sequence;
            usePetPreference.setState({ saving: true, error: "" });
            const saved = await savePetPreference(state.preference);
            if (token !== epoch) return;
            const current = usePetPreference.getState();
            const preference = version === sequence ? saved : { ...current.preference, revision: saved.revision };
            cache(state.scope, preference, version !== sequence);
            usePetPreference.setState({ preference, pending: version !== sequence, saving: false });
        }
    } catch {
        if (token === epoch) {
            ready = false;
            usePetPreference.setState({ saving: false, error: "云端未保存，已保留本机设置" });
        }
    } finally {
        if (token === epoch) worker = false;
    }
}
