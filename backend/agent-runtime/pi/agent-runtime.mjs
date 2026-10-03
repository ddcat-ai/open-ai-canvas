import { rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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

const providerID = "infinite-canvas";
const api = "openai-completions";

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  // JSONL 常跨多个管道 chunk；逐块转字符串会损坏跨边界的中文 UTF-8。
  const raw = Buffer.concat(chunks).toString("utf8");
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
  const modelRuntime = await ModelRuntime.create({
    authPath: join(isolatedDir, "auth.json"),
    modelsPath: join(isolatedDir, "models.json"),
  });
  let compactionActive = false;
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
          // Persist the step identity and native pre-model checkpoint before any billed call.
          await eventChain.current;
          const stepId = replayStepId || randomUUID();
          replayStepId = null;
          sessionManager.appendCustomEntry("canvas-model-step", { runId: request.runId, turnId: request.turnId, stepId, purpose: compactionActive ? "compaction" : "dialogue", promptSHA256: createHash("sha256").update(request.prompt).digest("hex") });
          await bridge(request, "/event", {
            type: "session_snapshot",
            sessionJSONL: [sessionManager.getHeader(), ...sessionManager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
          }, options?.signal);
          const result = await bridge(request, "/model", {
            stepId,
            modelId: model.id,
            purpose: compactionActive ? "compaction" : "dialogue",
            systemPrompt: compactionActive
              ? `${context.systemPrompt || ""}\n保留已经确认的商品事实、素材角色、站点与目标语言、目标语言卖点及中文审核对照、统一风格、已完成/待执行任务、用户最新约束。不能把竞品属性当商品事实；不得把审批或收费事实改写成已获授权。`
              : context.systemPrompt,
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
      // Tool execution may complete the run (ask_user). Deliver all preceding
      // assistant/tool-start events before that terminal state is committed.
      await eventChain.current;
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
  let replayStepId = null;
  let resumeCompaction = false;
  if (request.sessionJSONL) {
    const sessionFile = join(sessionDir, "session.jsonl");
    await writeFile(sessionFile, request.sessionJSONL, { mode: 0o600, flag: "wx" });
    sessionManager = SessionManager.open(sessionFile, sessionDir, workDir);
  } else {
    sessionManager = SessionManager.create(workDir, sessionDir);
  }
  if (request.resumeFromCheckpoint) {
    const marker = sessionManager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === "canvas-model-step" && entry.data?.runId === request.runId);
    if (!marker?.data?.stepId) throw new Error("旧运行缺少可证明的模型步骤检查点，已停止自动恢复；请核对任务记录。");
    replayStepId = marker.data.stepId;
    resumeCompaction = marker.data.purpose === "compaction";
    sessionManager.branch(marker.id);
  }
  if (!request.sessionJSONL && request.bootstrapMessages?.length) {
    // 一次性迁移旧的纯用户/助手历史；从第一次持久快照起只使用 Pi 分支。
    for (const message of request.bootstrapMessages) {
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || message.tool_calls) {
        throw new Error("旧会话消息不能安全迁移为原生记录，请新建对话并核对已有任务。");
      }
      if (message.role === "user") sessionManager.appendMessage({ role: "user", content: message.content, timestamp: Date.now() });
      else sessionManager.appendMessage(createMessage(model, { text: message.content }));
    }
  }
  // An approval abort may leave a paused tool result and later calls from the
  // same assistant message unfinished. Restore the real results before a new
  // user prompt or model request; the provider requires every call ID to pair.
  if (request.sessionJSONL && !request.resumeFromCheckpoint) {
    const branch = sessionManager.getBranch();
    const assistantIndex = branch.findLastIndex(entry => entry.type === "message" && entry.message?.role === "assistant" && entry.message.content?.some(part => part.type === "toolCall"));
    if (assistantIndex >= 0) {
      const assistant = branch[assistantIndex];
      const calls = assistant.message.content.filter(part => part.type === "toolCall");
      const following = branch.slice(assistantIndex + 1);
      const results = following.filter(entry => entry.type === "message" && entry.message?.role === "toolResult");
      const pausedIndex = results.findIndex(entry => entry.message.details?.paused);
      const retained = pausedIndex < 0 ? results : results.slice(0, pausedIndex);
      const pending = calls.filter(call => !retained.some(entry => entry.message.toolCallId === call.id));
      if (pending.length && following.some(entry => entry.type === "message" && entry.message?.role !== "toolResult")) {
        throw new Error("旧会话存在未闭合工具调用，不能继续提交模型请求；请核对任务记录。");
      }
      if (pending.length) {
        const marker = branch.slice(0, assistantIndex).findLast(entry => entry.type === "custom" && entry.customType === "canvas-model-step");
        const rejectedParent = request.rejectedParentRunId && marker?.data?.runId === request.rejectedParentRunId && request.rejectedParentRunId !== request.runId;
        if (marker?.data?.runId !== request.runId && !rejectedParent) {
          throw new Error("另一运行的工具调用未闭合，不能代它执行；请核对任务记录。");
        }
        if (pausedIndex >= 0) sessionManager.branch(retained.at(-1)?.id || assistant.id);
        let stopped = false;
        for (const call of pending) {
          if (rejectedParent) {
            sessionManager.appendMessage({
              role: "toolResult", toolCallId: call.id, toolName: call.name,
              content: [{ type: "text", text: JSON.stringify({ phase: "user_rejected", taskSubmitted: false, charged: false, text: "上一轮方案被用户关闭或修改，本操作及其后续操作未执行；按本轮要求重新规划，不重发旧操作。" }) }],
              isError: true, timestamp: Date.now(),
            });
            continue;
          }
          if (!(request.tools ?? []).some(tool => tool.name === call.name)) throw new Error(`未声明的待恢复工具: ${call.name}`);
          const replayOnly = pausedIndex >= 0 && results[pausedIndex].message.toolCallId === call.id;
          const result = await bridge(request, "/tool", { callId: call.id, name: call.name, arguments: call.arguments ?? {}, ...(replayOnly ? { replayOnly: true } : {}) });
          let content = typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? result ?? {});
          if (!content || content === "null") content = JSON.stringify({ error: "工具没有返回结果" });
          sessionManager.appendMessage({
            role: "toolResult", toolCallId: call.id, toolName: call.name,
            content: [{ type: "text", text: content }], details: result.details,
            isError: Boolean(result.isError || result.pause), timestamp: Date.now(),
          });
          await bridge(request, "/event", {
            type: "session_snapshot",
            sessionJSONL: [sessionManager.getHeader(), ...sessionManager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
          });
          if (result.pause) {
            emit("approval_wait", { approvalId: result.approvalId, toolName: call.name, callId: call.id });
            stopped = true;
            break;
          }
          if (result.terminate) {
            stopped = true;
            break;
          }
        }
        if (stopped) {
          emit("settled", { sessionFile: sessionManager.getSessionFile(), entries: sessionManager.getEntries().length });
          return;
        }
      }
    }
  }
  const turnHash = createHash("sha256").update(request.prompt).digest("hex");
  const priorTurn = sessionManager.getBranch().findLast(entry => entry.type === "custom_message" && entry.customType === "server-turn-context" && entry.details?.runId === request.runId && entry.details?.turnId === request.turnId && entry.details?.promptSHA256 === turnHash);
  let resumePendingPrompt = false;
  let hasTurnPrompt = false;
  if (priorTurn) {
    const branch = sessionManager.getBranch();
    hasTurnPrompt = branch.slice(branch.indexOf(priorTurn)+1).some(entry => entry.type === "message" && entry.message?.role === "user");
    resumePendingPrompt = hasTurnPrompt && !request.resumeFromCheckpoint;
  }
  if (!priorTurn && !request.resumeFromCheckpoint) {
    sessionManager.appendCustomMessageEntry("server-turn-context", request.turnContext || "服务端本轮检查点。", false, {runId:request.runId,turnId:request.turnId,promptSHA256:turnHash});
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

  const eventChain = { current: Promise.resolve() };
  let runtimeError = null;
  // 事件链串行执行。已有一次快照在排队时，它执行时读到的已是最新文件，
  // 不必为每条新条目再整份上传一次。
  let snapshotQueued = false;
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
    } else if (event.type === "compaction_start") {
      compactionActive = true;
      enqueueEvent({ type: event.type, reason: event.reason, keepRecentTokens: compactionConfig.keepRecentTokens });
    } else if (event.type === "compaction_end") {
      compactionActive = false;
      // appendCompaction 已由 SDK 完成；快照和完成事件一起交给 Go 事务保存。
      enqueueEvent({
        type: event.type, reason: event.reason, result: event.result,
        aborted: event.aborted, errorMessage: event.errorMessage, willRetry: event.willRetry,
        keepRecentTokens: compactionConfig.keepRecentTokens,
        sessionJSONL: event.result ? [sessionManager.getHeader(), ...sessionManager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n" : undefined,
        contextUsage: session.getContextUsage(),
      });
    }
  });

  try {
    try {
      if (request.resumeFromCheckpoint || resumePendingPrompt) {
        // The public core continuation does not append a second user prompt.
        // Server-side retries remain authoritative; a resumed overflow fails closed.
        if (resumeCompaction) {
          const lastAssistant = sessionManager.getBranch().findLast(entry => entry.type === "message" && entry.message?.role === "assistant")?.message;
          await session.compact();
          if (!hasTurnPrompt) await session.prompt(request.prompt);
          else if (lastAssistant?.stopReason !== "stop") await session.agent.continue();
        } else {
          await session.agent.continue();
        }
      } else {
        await session.prompt(request.prompt);
      }
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
