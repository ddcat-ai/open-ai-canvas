import { getActiveUserScope } from "@/lib/user-scope";
import { getCreationPreferences, patchCreationPreferences } from "@/services/api/creation-preferences";
import { normalizeCreationComposerPreferences, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";

type Fields = Record<string, string | number>;
let stopCurrent: (() => void) | undefined;
export function stopCreationPreferencesSync() {
    stopCurrent?.();
    stopCurrent = undefined;
}

export function creationPreferenceFields(value: unknown): Fields {
    const normalized = normalizeCreationComposerPreferences(value);
    const { activeConversationId: _active, image, ...preferences } = normalized;
    const { imageParameters: _parameters, ...imagePreferences } = image || {};
    const fields: Fields = {};
    const visit = (value: Record<string, unknown>, prefix = "") => {
        for (const [key, item] of Object.entries(value)) {
            if (item && typeof item === "object" && !Array.isArray(item)) visit(item as Record<string, unknown>, `${prefix}${key}.`);
            else if (typeof item === "string" || typeof item === "number") fields[prefix + key] = item;
        }
    };
    visit({ ...preferences, image: imagePreferences });
    return fields;
}

export function expandCreationPreferenceFields(fields: Fields): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(fields)) {
        const parts = path.split(".");
        if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) continue;
        let current = result;
        for (const part of parts.slice(0, -1)) current = (current[part] ||= {}) as Record<string, unknown>;
        current[parts.at(-1)!] = value;
    }
    return result;
}

export async function initializeCreationPreferencesSync(userId: string) {
    stopCreationPreferencesSync();
    if (!userId) return;
    const scope = getActiveUserScope();
    let stopped = false,
        applying = false,
        ready = false,
        saving = false,
        loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !stopped && scope === getActiveUserScope();
    const store = useCreationPreferencesStore;
    const schedule = () => {
        clearTimeout(timer);
        if (current()) timer = setTimeout(() => void flush(), 400);
    };
    const flush = async () => {
        // Keep edits pending until the read is applied so an older snapshot cannot replace an acknowledged save.
        if (!current() || !ready || loading || saving) return;
        const sent = { ...store.getState().pendingPreferenceChanges };
        if (!Object.keys(sent).length) return;
        saving = true;
        store.setState({ syncStatus: "saving" });
        try {
            await patchCreationPreferences(userId, expandCreationPreferenceFields(sent));
            if (!current()) return;
            const remaining = { ...store.getState().pendingPreferenceChanges };
            for (const [key, value] of Object.entries(sent)) if (remaining[key] === value) delete remaining[key];
            store.setState({ pendingPreferenceChanges: remaining, syncStatus: Object.keys(remaining).length ? "saving" : "synced" });
            if (Object.keys(remaining).length) schedule();
        } catch {
            if (current()) store.setState({ syncStatus: "error" });
        } finally {
            saving = false;
        }
    };
    const unsubscribe = store.subscribe((next, previous) => {
        if (!current() || applying || next.preferences === previous.preferences) return;
        const before = creationPreferenceFields(previous.preferences),
            after = creationPreferenceFields(next.preferences);
        const changed = Object.fromEntries(Object.entries(after).filter(([key, value]) => value !== before[key]));
        if (!Object.keys(changed).length) return;
        store.setState({ pendingPreferenceChanges: { ...next.pendingPreferenceChanges, ...changed }, syncStatus: ready ? "saving" : "local" });
        schedule();
    });
    const refresh = async () => {
        if (!current() || loading || saving) return;
        loading = true;
        store.setState({ syncStatus: "loading" });
        try {
            const { preferences } = await getCreationPreferences(userId);
            if (!current()) return;
            const local = store.getState();
            let pending = { ...local.pendingPreferenceChanges };
            const remote = creationPreferenceFields(preferences);
            if (!Object.keys(remote).length) pending = { ...creationPreferenceFields(local.preferences), ...pending };
            const merged = normalizeCreationComposerPreferences(expandCreationPreferenceFields({ ...remote, ...pending }));
            applying = true;
            store.setState({
                preferences: { ...merged, activeConversationId: local.preferences.activeConversationId, image: { ...merged.image, ...(local.preferences.image?.imageParameters ? { imageParameters: local.preferences.image.imageParameters } : {}) } },
                pendingPreferenceChanges: pending,
                syncStatus: Object.keys(pending).length ? "saving" : "synced",
            });
            applying = false;
            ready = true;
        } catch {
            if (current()) store.setState({ syncStatus: "error" });
        } finally {
            loading = false;
        }
        await flush();
    };
    const onFocus = () => {
        if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    stopCurrent = () => {
        stopped = true;
        clearTimeout(timer);
        unsubscribe();
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onFocus);
    };
    await refresh();
}
