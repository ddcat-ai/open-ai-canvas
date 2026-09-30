import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Agent, setGlobalDispatcher } from "undici";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Node 自带 undici 的 header/body 超时默认 300 秒，短于文本任务 8 分钟和视频任务 60 分钟。
// 设为 0 后只由 Go 侧任务期限取消 bridge；这里不再提前切断仍在排队或生成中的步骤。
setGlobalDispatcher(new Agent({
  connectTimeout: 30_000,
  headersTimeout: 0,
  bodyTimeout: 0,
}));

const providerID = "infinite-canvas";
const api = "openai-completions";

async function readRequest() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("Agent runtime input is empty");
  return JSON.parse(raw);
}

function emit(event, payload = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
}

function createMessage(model, result) {
  const content = [];
  if (result.text) content.push({ type: "text", text: result.text });
  for (const call of result.toolCalls ?? []) {
    content.push({
      type: "toolCall",
      id: call.id,
      name: call.name,
      arguments: call.arguments ?? {},
    });
  }
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: Number(result.usage?.input ?? 0),
      output: Number(result.usage?.output ?? 0),
      cacheRead: Number(result.usage?.cacheRead ?? 0),
      cacheWrite: Number(result.usage?.cacheWrite ?? 0),
      totalTokens: Number(result.usage?.totalTokens ?? 0),
      cost: result.usage?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((item) => item.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

async function bridge(request, path, body, signal) {
  const response = await fetch(new URL(path, request.bridgeURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${request.bridgeToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Agent bridge returned HTTP ${response.status}`);
  return data;
}

async function run() {
  const request = await readRequest();
  if (!request.bridgeURL || !request.bridgeToken || !request.model?.id) {
    throw new Error("Agent runtime is missing its bridge, session, or model configuration");
  }

  // 每次运行使用独立的空配置目录：SDK 的 auth.json / models.json / 锁文件都落在这里，
  // 不读取宿主 ~/.pi，也不会执行预置 auth.json 里的 !command。运行结束即删除。
  const isolatedDir = await mkdtemp(join(tmpdir(), "agent-runtime-"));
  process.env.HOME = isolatedDir;
  process.env.PI_CODING_AGENT_DIR = isolatedDir;
  process.on("exit", () => {
    try { rmSync(isolatedDir, { recursive: true, force: true }); } catch {}
  });
  request.agentDir = isolatedDir;
  const modelRuntime = await ModelRuntime.create({
    authPath: join(isolatedDir, "auth.json"),
    modelsPath: join(isolatedDir, "models.json"),
  });
  modelRuntime.registerProvider(providerID, {
    name: "影策模型任务",
    baseUrl: "http://agent-runtime.invalid/v1",
    apiKey: "managed-by-go-bridge",
    api,
    authHeader: false,
    models: [{
      id: request.model.id,
      name: request.model.name || request.model.id,
      api,
      reasoning: Boolean(request.model.reasoning),
      input: request.model.input?.length ? request.model.input : ["text", "image"],
      cost: request.model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Math.max(1, Number(request.model.contextWindow || 128000)),
      maxTokens: Math.max(1, Number(request.model.maxTokens || 8192)),
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const partial = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "pending",
        timestamp: Date.now(),
      };
      void (async () => {
        stream.push({ type: "start", partial });
        try {
          const result = await bridge(request, "/model", {
            modelId: model.id,
            messages: context.messages,
            tools: (context.tools ?? []).map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
            thinkingLevel: options?.reasoning ?? "off",
          }, options?.signal);
          for (const text of result.steeringMessages ?? []) {
            await session.steer(text);
          }
          const message = createMessage(model, result);
          if (result.text) {
            partial.content.push({ type: "text", text: result.text });
            stream.push({ type: "text_start", contentIndex: 0, partial });
            stream.push({ type: "text_delta", contentIndex: 0, delta: result.text, partial });
            stream.push({ type: "text_end", contentIndex: 0, content: result.text, partial });
          }
          let contentIndex = result.text ? 1 : 0;
          for (const call of result.toolCalls ?? []) {
            const toolCall = message.content.find((item) => item.type === "toolCall" && item.id === call.id);
            partial.content.push(toolCall);
            stream.push({ type: "toolcall_start", contentIndex, partial });
            stream.push({ type: "toolcall_end", contentIndex, toolCall, partial });
            contentIndex++;
          }
          stream.push({ type: "done", reason: message.stopReason, message });
          stream.end(message);
        } catch (error) {
          stream.push({ type: "error", reason: "error", error: {
            ...partial,
            stopReason: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
          } });
          stream.end();
        }
      })();
      return stream;
    },
  });

  const model = modelRuntime.getModel(providerID, request.model.id);
  if (!model) throw new Error("Agent model registration failed");

  let session;
  // 工具进入审批时主动中止本轮；这是暂停，不是失败。
  let pausedForApproval = false;
  const tools = (request.tools ?? []).map((tool) => ({
    name: tool.name,
    label: tool.label || tool.name,
    description: tool.description || tool.name,
    parameters: Type.Unsafe(tool.parameters ?? { type: "object", properties: {} }),
    executionMode: tool.executionMode || "sequential",
    async execute(toolCallId, params, signal) {
      const result = await bridge(request, "/tool", {
        callId: toolCallId,
        name: tool.name,
        arguments: params,
      }, signal);
      if (result.pause) {
        pausedForApproval = true;
        emit("approval_wait", { approvalId: result.approvalId, toolName: tool.name, callId: toolCallId });
        session.abort();
        return {
          content: [{ type: "text", text: result.content || "操作正在等待用户审批。" }],
          details: { approvalId: result.approvalId, paused: true },
          isError: true,
          terminate: true,
        };
      }
      // 工具结果必须是非空文本：交回 "null" 会让模型返回空回复。
      let text = typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? result ?? {});
      if (!text || text === "null") text = JSON.stringify({ error: "工具没有返回结果" });
      return {
        content: [{ type: "text", text }],
        details: result.details,
        isError: Boolean(result.isError),
        terminate: Boolean(result.terminate),
      };
    },
  }));

  let sessionManager;
  if (request.sessionJSONL) {
    if (!request.sessionFile) throw new Error("Agent session restore requires a session file path");
    await mkdir(dirname(request.sessionFile), { recursive: true, mode: 0o700 });
    await writeFile(request.sessionFile, request.sessionJSONL, { mode: 0o600, flag: "w" });
    sessionManager = SessionManager.open(request.sessionFile, undefined, request.cwd);
  } else {
    sessionManager = SessionManager.create(request.cwd, request.sessionDir);
  }
  // 严格隔离：不探索文件系统的 packages/skills/extensions
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.cwd,
    agentDir: request.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: request.skillPaths ?? [],
    systemPrompt: request.systemPrompt,
    settingsManager: SettingsManager.inMemory({}),
  });
  await resourceLoader.reload();

  const contextWindow = Math.max(1, Number(request.model?.contextWindow || 128000));
  const sessionConfig = {
    cwd: request.cwd,
    agentDir: request.agentDir,
    modelRuntime,
    model,
    resourceLoader,
    sessionManager,
    customTools: tools,
  };

  if (request.profile) {
    sessionConfig.profile = {
      revision: request.profile.revision,
      hash: request.profile.hash,
      layers: request.profile.layers || [],
    };
  }

  if (request.memory?.enabled) {
    sessionConfig.memory = {
      enabled: true,
      storePath: request.memory.storePath,
      userId: request.userId,
      canvasId: request.canvasId,
      maxEntries: request.memory.maxEntries || 1000,
    };
  }

  if (request.canvas) {
    sessionConfig.canvas = request.canvas;
  }

  if (request.features) {
    sessionConfig.features = {
      planning: request.features.planningEnabled ?? true,
      forms: request.features.formsEnabled ?? true,
      approval: request.features.approvalRequired ?? [],
    };
  }

  if (request.permissions) {
    sessionConfig.permissions = request.permissions;
  }

  // 只启用平台声明的工具，不使用 SDK 默认工具
  const platformToolNames = tools.map(t => t.name);
  sessionConfig.tools = platformToolNames;
  
  ({ session } = await createAgentSession(sessionConfig));

  const compactionConfig = request.compaction || {
    enabled: true,
    strategy: "balanced",
    reserveTokens: Math.max(1024, Math.ceil(contextWindow * 0.2)),
    keepRecentTokens: Math.min(20000, Math.max(1024, Math.floor(contextWindow * 0.2))),
  };

  session.settingsManager.applyOverrides({
    compaction: compactionConfig,
    // 重试只由 Go 模型桥决定（按上游真实 HTTP 状态区分临时故障与参数错误）；
    // 这里再重试一层会让 400 也被重发、让 500 被重试 3×3 次。
    retry: { enabled: false },
  });

  const eventChain = { current: Promise.resolve() };
  let runtimeError = null;
  const enqueueEvent = (payload) => {
    eventChain.current = eventChain.current.then(() => bridge(request, "/event", payload));
  };

  session.subscribe((event) => {
    // 转发完整的 Pi 事件流到 Go 后端
    if (event.type === "message_start") {
      const message = event.message;
      if (message?.role === "assistant") {
        enqueueEvent({
          type: "message_start",
          role: "assistant",
          messageId: event.messageId,
        });
      }
    } else if (event.type === "message_delta") {
      enqueueEvent({
        type: "message_delta",
        delta: event.delta,
        messageId: event.messageId,
      });
    } else if (event.type === "message_end") {
      const message = event.message;
      if (message?.role !== "assistant") return;
      if (pausedForApproval || message.stopReason === "aborted") return;
      if (message.stopReason === "error" || message.errorMessage) {
        runtimeError = new Error(message.errorMessage || "Agent assistant message failed");
        return;
      }
      enqueueEvent({
        type: "message_end",
        message,
        contextUsage: session.getContextUsage(),
      });
    } else if (event.type === "thinking_start") {
      enqueueEvent({
        type: "thinking_start",
        thinkingId: event.thinkingId,
      });
    } else if (event.type === "thinking_delta") {
      enqueueEvent({
        type: "thinking_delta",
        delta: event.delta,
        thinkingId: event.thinkingId,
      });
    } else if (event.type === "thinking_end") {
      enqueueEvent({
        type: "thinking_end",
        content: event.content,
        thinkingId: event.thinkingId,
      });
    } else if (event.type === "planning_start") {
      enqueueEvent({
        type: "planning_start",
        planId: event.planId,
      });
    } else if (event.type === "planning_update") {
      enqueueEvent({
        type: "planning_update",
        plan: event.plan,
        planId: event.planId,
      });
    } else if (event.type === "planning_end") {
      enqueueEvent({
        type: "planning_end",
        plan: event.plan,
        planId: event.planId,
      });
    } else if (event.type === "form_start") {
      enqueueEvent({
        type: "form_start",
        form: event.form,
        formId: event.formId,
      });
    } else if (event.type === "form_update") {
      enqueueEvent({
        type: "form_update",
        form: event.form,
        formId: event.formId,
      });
    } else if (event.type === "form_submit") {
      enqueueEvent({
        type: "form_submit",
        answers: event.answers,
        formId: event.formId,
      });
    } else if (event.type === "tool_call_start") {
      enqueueEvent({
        type: "tool_call_start",
        toolCall: event.toolCall,
        callId: event.callId,
      });
    } else if (event.type === "tool_call_end") {
      enqueueEvent({
        type: "tool_call_end",
        result: event.result,
        callId: event.callId,
      });
    } else if (event.type === "approval_requested") {
      enqueueEvent({
        type: "approval_requested",
        approval: event.approval,
        approvalId: event.approvalId,
      });
    } else if (event.type === "entry_appended") {
      eventChain.current = eventChain.current.then(async () => {
        const sessionFile = sessionManager.getSessionFile();
        if (!sessionFile) return;
        let sessionJSONL;
        try {
          sessionJSONL = await readFile(sessionFile, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") return;
          throw error;
        }
        return bridge(request, "/event", {
          type: "session_snapshot",
          sessionJSONL,
          contextUsage: session.getContextUsage(),
        });
      });
    } else if (event.type === "compaction_start" || event.type === "compaction_end") {
      enqueueEvent({ type: event.type, reason: event.reason, contextUsage: session.getContextUsage() });
    }
  });

  try {
    try {
      await session.prompt(request.prompt);
    } catch (error) {
      if (!pausedForApproval) throw error;
    }
    await eventChain.current;
    if (runtimeError && !pausedForApproval) throw runtimeError;
    const sessionFile = sessionManager.getSessionFile();
    const sessionJSONL = await readFile(sessionFile, "utf8");
    await bridge(request, "/event", {
      type: "session_snapshot",
      sessionJSONL,
      contextUsage: session.getContextUsage(),
    });
    emit("settled", {
      contextUsage: session.getContextUsage(),
      sessionFile,
      entries: sessionManager.getEntries().length,
    });
  } finally {
    session.dispose();
  }
}

run().catch((error) => {
  emit("runtime_error", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
