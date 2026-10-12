type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const RESOURCE_KEY = /^resource:([^/]+)$/;
const RESOURCE_URL = /\/api\/resources\/([^/]+)\/file(?:[/?#]|$)/;
const LOCATOR_KEY = /(?:storage|resource|preview|poster|thumbnail|content|url|locator|asset)/i;

function resourceId(value: string) {
    const storageMatch = value.match(RESOURCE_KEY);
    if (storageMatch) return storageMatch[1];
    return value.match(RESOURCE_URL)?.[1] || "";
}

function isMediaLocatorKey(key: string) {
    return LOCATOR_KEY.test(key);
}

function collect(value: unknown, ids: Set<string>, key = "") {
    if (typeof value === "string") {
        if (isMediaLocatorKey(key)) {
            const id = resourceId(value);
            if (id) ids.add(id);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collect(item, ids, key));
        return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([childKey, childValue]) => collect(childValue, ids, childKey));
}

export function canvasResourceIds(value: unknown) {
    const ids = new Set<string>();
    collect(value, ids);
    return ids;
}

function clear(value: JsonValue, missing: Set<string>, serverReported: boolean, key = ""): JsonValue | undefined {
    if (Array.isArray(value)) return value.map((item) => clear(item, missing, serverReported, key)).filter((item): item is JsonValue => item !== undefined);
    if (!value || typeof value !== "object") {
        if (typeof value === "string" && isMediaLocatorKey(key) && missing.has(resourceId(value))) return undefined;
        return value;
    }

    const entries = Object.entries(value);
    const invalidMedia =
        !serverReported &&
        entries.some(([childKey, childValue]) => {
            if (typeof childValue !== "string" || !isMediaLocatorKey(childKey)) return false;
            return missing.has(resourceId(childValue));
        });
    const output: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of entries) {
        if (childKey === "assetId" && invalidMedia && !serverReported) continue;
        if (serverReported && childKey !== "assetId" && isMediaLocatorKey(childKey)) continue;
        if (typeof childValue === "string" && isMediaLocatorKey(childKey) && missing.has(resourceId(childValue))) continue;
        if (childKey === "status" && childValue === "success" && invalidMedia) {
            output[childKey] = "idle";
            continue;
        }
        const next = clear(childValue, missing, serverReported, childKey);
        if (next !== undefined) output[childKey] = next;
    }
    return output;
}

export function clearMissingCanvasResources<T>(value: T, missingIds: Set<string>, _scope = "", serverReported = false): T {
    return clear(value as unknown as JsonValue, missingIds, serverReported) as T;
}
