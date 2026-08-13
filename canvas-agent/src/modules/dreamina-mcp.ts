import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LocalRuntimeConfig } from "../config.js";
import {
    dreaminaCliInputSchema,
    dreaminaCliToolShape,
    type DreaminaCliInput,
} from "../dreamina-cli-contract.js";
import { isStableDreaminaErrorCode } from "../dreamina-cli-process.js";

type RuntimeConfig = Pick<LocalRuntimeConfig, "url" | "token">;
type DreaminaToolResponse = { ok?: boolean; result?: unknown; code?: string };
type DreaminaMcpRequestOptions = { signal?: AbortSignal; timeoutMs?: number };
const MCP_DEADLINE_MS = 180_000;
const MCP_RESPONSE_LIMIT_BYTES = 256 * 1024;

export type DreaminaMcpDependencies = {
    postTool?: typeof postDreaminaCliTool;
};

export function registerDreaminaMcp(
    server: McpServer,
    config: RuntimeConfig,
    dependencies: DreaminaMcpDependencies = {},
) {
    const postTool = dependencies.postTool ?? postDreaminaCliTool;
    server.registerTool("dreamina_cli", {
        description: "仅当用户明确要求使用 Dreamina 本机 OAuth CLI 时调用。生成会消耗 Dreamina credits；不得替代宿主自定义渠道或火山即梦 AK/SK API。For image generation with automatic resolution, omit resolutionType instead of inventing a tier or passing auto; image_upscale still requires an explicit tier.",
        inputSchema: dreaminaCliToolShape.shape,
    }, async (input: unknown, extra) => {
        const result = await postTool(config, dreaminaCliInputSchema.parse(input), { signal: extra.signal });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

export async function postDreaminaCliTool(
    config: RuntimeConfig,
    input: DreaminaCliInput,
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
    let body: DreaminaToolResponse;
    try {
        const responsePromise = fetch(`${config.url}/dreamina/run`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-canvas-agent-token": config.token,
            },
            body: JSON.stringify(input),
            signal: controller.signal,
        });
        dispatched = true;
        const response = await responsePromise;
        body = await readBoundedJson(response);
    } catch {
        throw publicError(dispatched ? "dreamina_submission_unknown" : "dreamina_internal_error");
    } finally {
        clearTimeout(deadline);
        options.signal?.removeEventListener("abort", cancel);
    }
    if (!body.ok) {
        const code = typeof body.code === "string" && isStableDreaminaErrorCode(body.code)
            ? body.code
            : "dreamina_internal_error";
        throw publicError(code);
    }
    return body.result;
}

async function readBoundedJson(response: Response): Promise<DreaminaToolResponse> {
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
    return parsed as DreaminaToolResponse;
}

function publicError(code: string) {
    return new Error(`Dreamina CLI request failed (${code})`);
}
