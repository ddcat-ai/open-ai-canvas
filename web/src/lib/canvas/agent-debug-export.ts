// Export only diagnostics explicitly supplied by the chat, never app config or storage.
export function redactAgentDiagnostics(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactAgentDiagnostics);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret|headers)$/i.test(key) ? "[REDACTED]" : redactAgentDiagnostics(item)]));
    if (typeof value !== "string") return value;
    if (/^\s*[\[{]/.test(value)) {
        try { return JSON.stringify(redactAgentDiagnostics(JSON.parse(value))); } catch { /* Not serialized tool arguments. */ }
    }
    return value
        .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[\w-]{12,}/g, "[REDACTED]")
        .replace(/data:[^\s"']+/gi, "[MEDIA OMITTED]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
            try { const parsed = new URL(url); parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = ""; return parsed.toString(); } catch { return "[URL OMITTED]"; }
        })
        .replace(/((?:api[-_]?key|token|password|secret)\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
}

export function buildAgentDebugExport(diagnostics: Record<string, unknown>) {
    return JSON.stringify(redactAgentDiagnostics({ format: "canvas-agent-debug", version: 1, exportedAt: new Date().toISOString(), notice: "包含对话和提示词；已尽力过滤凭证与签名参数，分享前仍请检查隐私内容。", ...diagnostics }), null, 2);
}
