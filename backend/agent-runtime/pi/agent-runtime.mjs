import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const providerID = "yingce";
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
      ...(call.item_id ? { itemId: call.item_id } : {}),
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
  // 会话文件和工作目录同样放在这里：它们只是本轮的工作副本，真实来源是服务端
  // 数据库里的会话快照（请求带 sessionJSONL，运行中回传）。不使用服务端的路径：
  // 独立容器里没有服务端的数据目录；空工作目录也不会被发现任何项目级配置或技能。
  const isolatedDir = await mkdtemp(join(tmpdir(), "agent-runtime-"));
  process.env.HOME = isolatedDir;
  process.env.PI_CODING_AGENT_DIR = isolatedDir;
  process.on("exit", () => {
    try { rmSync(isolatedDir, { recursive: true, force: true }); } catch {}
  });
  const agentDir = isolatedDir;
  const workDir = join(isolatedDir, "work");
  const sessionDir = join(isolatedDir, "sessions");
  await mkdir(workDir, { mode: 0o700 });
  await mkdir(sessionDir, { mode: 0o700 });
  // Lifecycle state, not prompt wording, identifies SDK summarization calls.
  // Keep the id through the closing event delivery so the requested/end pair
  // can always be correlated, while the closing phase no longer labels a
  // following normal model request as a summary request.
  let activeCompaction = null;
  const eventChain = { current: Promise.resolve() };
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
        // 审批暂停时 session.abort() 是异步生效的，SDK 可能在它生效前就开下一轮。
        // 这一轮不能发给服务端：运行正在等审批，再跑一步会多计一次费，
        // 新的工具调用还会和待审批的调用对不上，让整轮以检查点校验失败收场。
        if (pausedForApproval) {
          stream.push({ type: "error", reason: "aborted", error: { ...partial, stopReason: "aborted", errorMessage: "paused for approval" } });
          stream.end();
          return;
        }
        try {
          const purpose = activeCompaction?.phase === "summarizing" ? "compaction" : "conversation";
          // Deliver lifecycle events/snapshots before scheduling the next request.
          // In particular, compaction must be visible before its model call begins.
          await eventChain.current;
          const result = await bridge(request, "/model", {
            modelId: model.id,
            purpose,
            systemPrompt: context.systemPrompt,
            messages: context.messages,
            tools: (context.tools ?? []).map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
            thinkingLevel: options?.reasoning ?? "off",
            contextUsage: session.getContextUsage(),
          }, options?.signal);
          if (result.pause === true && result.reason === "awaiting_approval") {
            pausedForApproval = true;
            emit("approval_wait", { reason: result.reason });
            stream.push({ type: "error", reason: "aborted", error: { ...partial, stopReason: "aborted", errorMessage: "paused for approval" } });
            stream.end();
            return;
          }
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
    const sessionFile = join(sessionDir, "session.jsonl");
    await writeFile(sessionFile, request.sessionJSONL, { mode: 0o600, flag: "wx" });
    sessionManager = SessionManager.open(sessionFile, sessionDir, workDir);
  } else {
    sessionManager = SessionManager.create(workDir, sessionDir);
  }
  // 严格隔离：不探索文件系统的 packages/skills/extensions/项目配置。
  // 技能由服务端的读取工具提供，这里不再按路径加载；projectTrusted=false 让 SDK
  // 不读取 <cwd>/.pi 设置，也不向上层目录收集 .agents/skills。
  // 同一个设置管理器也交给 createAgentSession，否则 SDK 会另建一个读文件的实例。
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
  const resourceLoader = new DefaultResourceLoader({
    cwd: workDir,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: [],
    systemPrompt: request.systemPrompt,
    settingsManager,
  });
  await resourceLoader.reload();

  const contextWindow = Math.max(1, Number(request.model?.contextWindow || 128000));
  const sessionConfig = {
    cwd: workDir,
    agentDir,
    settingsManager,
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

  let runtimeError = null;
  // 事件链串行执行。已有一次快照在排队时，它执行时读到的已是最新文件，
  // 不必为每条新条目再整份上传一次。
  let snapshotQueued = false;
  const enqueueEvent = (payload) => {
    const pending = eventChain.current.then(() => bridge(request, "/event", payload));
    eventChain.current = pending;
    return pending;
  };
  const enqueueSessionSnapshot = () => {
    if (snapshotQueued) return;
    snapshotQueued = true;
    eventChain.current = eventChain.current.then(async () => {
      snapshotQueued = false;
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
      enqueueSessionSnapshot();
    } else if (event.type === "compaction_start" || event.type === "compaction_end") {
      // Persist the compaction entry before reporting it to the server. If event
      // delivery fails, the summary and retained tail are still recoverable.
      if (event.type === "compaction_start") activeCompaction = { id: crypto.randomUUID(), phase: "summarizing" };
      const compaction = activeCompaction;
      if (event.type === "compaction_end" && compaction) compaction.phase = "closing";
      if (event.type === "compaction_end") enqueueSessionSnapshot();
      const eventDelivery = enqueueEvent({
        type: event.type,
        compactionId: compaction?.id,
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
        hasResult: Boolean(event.result),
        tokensBefore: event.result?.tokensBefore,
        estimatedTokensAfter: event.result?.estimatedTokensAfter,
        contextUsage: session.getContextUsage(),
      });
      if (event.type === "compaction_end" && compaction) {
        eventDelivery.then(
          () => {
            if (activeCompaction === compaction) activeCompaction = null;
          },
          () => {
            if (activeCompaction === compaction) activeCompaction = null;
          },
        );
      }
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
