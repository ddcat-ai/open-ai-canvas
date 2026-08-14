import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LocalRuntimeConfig } from "../config.js";
import {
    dreaminaGenerationInputSchema,
    dreaminaMcpToolShape,
    type DreaminaGenerationInput,
} from "../dreamina-cli-contract.js";
import {
    parseDreaminaPublicRunError,
    parseDreaminaPublicRuntimeResult,
} from "../dreamina-public-result.js";

type RuntimeConfig = Pick<LocalRuntimeConfig, "url" | "token">;
type DreaminaMcpRequestOptions = { signal?: AbortSignal; timeoutMs?: number };
const MCP_DEADLINE_MS = 180_000;
const MCP_RESPONSE_LIMIT_BYTES = 256 * 1024;

export type DreaminaMcpDependencies = {
    postPublicTool?: typeof postDreaminaCliTool;
};

export function registerDreaminaMcp(
    server: McpServer,
    config: RuntimeConfig,
    dependencies: DreaminaMcpDependencies = {},
) {
    const postPublicTool = dependencies.postPublicTool ?? postDreaminaCliTool;
    server.registerTool("dreamina_cli", {
        description: "仅当用户明确要求使用 Dreamina 本机 OAuth CLI 时调用。生成会消耗 Dreamina credits；不得替代宿主自定义渠道或火山即梦 AK/SK API。For image generation with automatic resolution, omit resolutionType instead of inventing a tier or passing auto; image_upscale still requires an explicit tier.",
        inputSchema: dreaminaMcpToolShape.shape,
    }, async (input: unknown, extra) => {
        const parsedInput = dreaminaGenerationInputSchema.parse(input);
        if (extra.signal?.aborted) throw publicError("dreamina_cancelled");
        let unsafeResult;
        try {
            unsafeResult = await postPublicTool(config, parsedInput, { signal: extra.signal });
        } catch {
            throw publicError("dreamina_submission_unknown");
        }
        let result;
        try {
            result = parseDreaminaPublicRuntimeResult(unsafeResult);
        } catch {
            throw publicError("dreamina_submission_unknown");
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

export async function postDreaminaCliTool(
    config: RuntimeConfig,
    input: DreaminaGenerationInput,
    options: DreaminaMcpRequestOptions = {},
) {
    if (options.signal?.aborted) throw publicError("dreamina_cancelled");
    const controller = new AbortController();
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? MCP_DEADLINE_MS, MCP_DEADLINE_MS));
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(cancel, timeoutMs);
    deadline.unref();
    let dispatched = false;
    let statusCode = 0;
    let body: unknown;
    try {
        const responsePromise = fetch(`${config.url}/dreamina/run`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-canvas-agent-token": config.token,
            },
            body: JSON.stringify(input),
            signal: controller.signal,
            redirect: "manual",
        });
        dispatched = true;
        const response = await responsePromise;
        statusCode = response.status;
        body = await readBoundedJson(response);
    } catch {
        throw publicError(dispatched ? "dreamina_submission_unknown" : "dreamina_internal_error");
    } finally {
        clearTimeout(deadline);
        options.signal?.removeEventListener("abort", cancel);
    }
    const envelope = parsePublicEnvelope(statusCode, body);
    if (!envelope.ok) throw publicError(envelope.code);
    return envelope.result;
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MCP_RESPONSE_LIMIT_BYTES) throw new Error("response too large");
    if (!response.body) throw new Error("missing response body");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MCP_RESPONSE_LIMIT_BYTES) throw new Error("response too large");
            chunks.push(Buffer.from(value));
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid response");
    return parsed;
}

function parsePublicEnvelope(statusCode: number, value: unknown):
    | { ok: true; result: ReturnType<typeof parseDreaminaPublicRuntimeResult> }
    | { ok: false; code: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "dreamina_submission_unknown" };
    const source = value as Record<string, unknown>;
    const successStatus = statusCode >= 200 && statusCode < 300;
    if (source.ok === true && exactKeys(source, ["ok", "result"])) {
        if (!successStatus) return { ok: false, code: "dreamina_submission_unknown" };
        try {
            return { ok: true, result: parseDreaminaPublicRuntimeResult(source.result) };
        } catch {
            return { ok: false, code: "dreamina_submission_unknown" };
        }
    }
    if (source.ok === false && exactKeys(source, ["ok", "code", "message"])) {
        if (successStatus) return { ok: false, code: "dreamina_submission_unknown" };
        const error = parseDreaminaPublicRunError(source.code, source.message);
        return error.code !== "dreamina_submission_unknown" && error.statusCode === statusCode
            ? { ok: false, code: error.code }
            : { ok: false, code: "dreamina_submission_unknown" };
    }
    return { ok: false, code: "dreamina_submission_unknown" };
}

function exactKeys(source: Record<string, unknown>, expected: string[]) {
    const keys = Object.keys(source);
    return keys.length === expected.length && expected.every((key) => Object.hasOwn(source, key));
}

function publicError(code: string) {
    return new Error(`Dreamina CLI request failed (${code})`);
}
