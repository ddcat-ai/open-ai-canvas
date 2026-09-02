import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "./config.js";
import { registerDreaminaMcp } from "./modules/dreamina-mcp.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";

// PATCH(agent-mcp-error-passthrough): the runtime error envelope is
// { ok:false, code, message } - `error` is only used by some paths, so code and
// message must be part of the contract or they cannot be surfaced at all.
type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string; code?: string; message?: string };

export async function startMcpServer(options: { canvasOnly?: boolean } = {}) {
    const config = loadConfig(true);
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });
    registerMcpTools(server, config, {
        canvasOnly: options.canvasOnly ?? process.argv.slice(3).includes("--canvas-only"),
    });
    await server.connect(new StdioServerTransport());
}

export function registerMcpTools(server: McpServer, config: CanvasAgentConfig, options: { canvasOnly?: boolean } = {}) {
    toolNames.forEach((name) => registerCanvasTool(server, config, name));
    if (!options.canvasOnly) registerDreaminaMcp(server, config);
}

function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await postCanvasAgentTool(config, name, schema.parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown) {
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token }, body: JSON.stringify({ name, input }) });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) {
        // PATCH(agent-mcp-error-passthrough): The runtime answers failures with
        // {ok:false, code, message} - there is no `error` field, so the original
        // `body.error || "tool call failed"` hid the real cause and every problem
        // looked identical. Surface code + message instead.
        const detail = [body.error, body.message].filter(Boolean).join(" - ");
        throw new Error([
            `tool call failed (${String(body.code ?? res.status)})`,
            detail,
        ].filter(Boolean).join(": "));
    }
    return body.result;
}

export { postDreaminaCliTool } from "./modules/dreamina-mcp.js";
