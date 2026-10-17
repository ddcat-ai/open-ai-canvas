/** Kept stable between input comparison and resource-promotion rewriting. */
export function canvasBatchInputToken(nodeId: string, content: string) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
    return `${nodeId}:${content.length}:${hash >>> 0}`;
}

const signatureFields = new Set(["batchInputSignature", "batchResultInputSignature", "generatedInputSignature"]);

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Only rebase identities proven to be the same resource in this upload, never current row inputs. */
export function rebaseCanvasBatchInputSignatures<T>(before: T, prepared: T, uploaded: ReadonlyMap<string, string>): T {
    if (!uploaded.size) return prepared;
    const tokens = new Map<string, string>();
    const collect = (left: unknown, right: unknown) => {
        if (Array.isArray(left) && Array.isArray(right)) {
            left.forEach((child, index) => collect(child, right[index]));
            return;
        }
        const a = record(left),
            b = record(right);
        if (!a || !b) return;
        if (typeof a.id === "string" && a.id === b.id) {
            // Canvas image nodes and frozen ReferenceImage entries both carry the original node ID.
            const source = a.type === "image" && record(a.metadata) ? record(a.metadata) : typeof a.dataUrl === "string" ? a : undefined;
            const target = a.type === "image" && record(b.metadata) ? record(b.metadata) : typeof a.dataUrl === "string" ? b : undefined;
            const oldKey = source?.storageKey,
                newKey = target?.storageKey;
            if (typeof oldKey === "string" && typeof newKey === "string" && oldKey !== newKey && uploaded.get(oldKey) === newKey) {
                tokens.set(canvasBatchInputToken(a.id, oldKey), canvasBatchInputToken(a.id, newKey));
            }
        }
        Object.entries(a).forEach(([key, child]) => collect(child, b[key]));
    };
    collect(before, prepared);
    if (!tokens.size) return prepared;

    const rewriteSignature = (value: string) => {
        let signature: unknown;
        try {
            signature = JSON.parse(value);
        } catch {
            return value;
        }
        if (!Array.isArray(signature) || signature.length !== 3 || !Array.isArray(signature[1]) || !Array.isArray(signature[2])) return value;
        let changed = false;
        const images = signature[1].map((token: unknown) => {
            const replacement = typeof token === "string" ? tokens.get(token) : undefined;
            if (replacement === undefined) return token;
            changed = true;
            return replacement;
        });
        return changed ? JSON.stringify([signature[0], images, signature[2]]) : value;
    };
    const rewrite = (value: unknown): unknown => {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) {
            const next = value.map(rewrite);
            return next.some((child, index) => child !== value[index]) ? next : value;
        }
        const current = value as Record<string, unknown>;
        const entries = Object.entries(current).map(([key, child]) => [key, signatureFields.has(key) && typeof child === "string" ? rewriteSignature(child) : rewrite(child)] as const);
        return entries.some(([key, child]) => child !== current[key]) ? Object.fromEntries(entries) : value;
    };
    return rewrite(prepared) as T;
}
