import fs from "node:fs/promises";
import path from "node:path";

import type { Request, RequestHandler, Response } from "express";

import type { LocalRuntimeModule } from "../local-runtime.js";

const PROXY_BASE_URL = "http://127.0.0.1:8317";
const KEY_FILE_ENV = "FRAMEFIELD_CLIPROXY_API_KEY_FILE";
const DEFAULT_KEY_FILE = "cliproxyapi-client.key";
const MODEL_RESPONSE_LIMIT = 256 * 1024;
const TEXT_RESPONSE_LIMIT = 1024 * 1024;
const IMAGE_RESPONSE_LIMIT = 45 * 1024 * 1024;
const IMAGE_BINARY_LIMIT = 32 * 1024 * 1024;

export type SubscriptionCliProvider = "chatgpt" | "antigravity";
export type SubscriptionCliModelDescriptor = {
  provider: SubscriptionCliProvider;
  id: string;
  displayName: string;
  modality: "text" | "image";
  adapterSupported: true;
  currentlyObservedAvailable: "yes";
  source: "cli-proxy-api-models";
};

export type SubscriptionCliToolStatus = {
  id: "cli-proxy-api" | "codex" | "antigravity" | "gemini";
  displayName: string;
  installed: boolean;
};

export type SubscriptionCliStatus = {
  provider: "cli-proxy-api";
  state:
    "stopped" | "key_missing" | "authentication_failed" | "ready" | "error";
  installed: boolean;
  running: boolean;
  keyConfigured: boolean;
  endpoint: "127.0.0.1:8317";
  message: string;
  tools: SubscriptionCliToolStatus[];
  models: SubscriptionCliModelDescriptor[];
};

type SubscriptionCliHttpModuleOptions = {
  configDir: string;
  fetch?: typeof fetch;
  readKey?: () => Promise<string | undefined>;
  detectTools?: () => Promise<SubscriptionCliToolStatus[]>;
};

type ProxyResponse = { status: number; value?: unknown };

const MODEL_CATALOG: readonly Omit<
  SubscriptionCliModelDescriptor,
  "currentlyObservedAvailable"
>[] = [
  {
    provider: "chatgpt",
    id: "gpt-5.5",
    displayName: "Codex 订阅文本",
    modality: "text",
    adapterSupported: true,
    source: "cli-proxy-api-models",
  },
  {
    provider: "chatgpt",
    id: "gpt-image-2",
    displayName: "GPT Image 2",
    modality: "image",
    adapterSupported: true,
    source: "cli-proxy-api-models",
  },
  {
    provider: "antigravity",
    id: "gemini-3.1-flash-lite",
    displayName: "Antigravity 文本",
    modality: "text",
    adapterSupported: true,
    source: "cli-proxy-api-models",
  },
  {
    provider: "antigravity",
    id: "gemini-3.1-flash-image",
    displayName: "Nano Banana 2",
    modality: "image",
    adapterSupported: true,
    source: "cli-proxy-api-models",
  },
];

export function createSubscriptionCliHttpModule(
  options: SubscriptionCliHttpModuleOptions,
): LocalRuntimeModule {
  const fetchImpl = options.fetch ?? fetch;
  const readKey = options.readKey ?? (() => readProxyKey(options.configDir));
  const detectTools = options.detectTools ?? detectSubscriptionTools;
  const inspect = (signal: AbortSignal) =>
    inspectSubscriptionCli(fetchImpl, readKey, detectTools, signal);
  return {
    descriptor: {
      id: "subscription-cli",
      displayName: "CLIProxyAPI",
      apiVersion: 1,
      scopes: [
        "subscription:status",
        "subscription:models",
        "subscription:complete",
        "subscription:generate",
      ],
    },
    routes: [
      {
        method: "GET",
        path: "/subscription-cli/status",
        scope: "subscription:status",
        handler: subscriptionHandler(async (_req, signal) => ({
          ok: true,
          status: await inspect(signal),
        })),
      },
      {
        method: "GET",
        path: "/subscription-cli/models",
        scope: "subscription:models",
        handler: subscriptionHandler(async (_req, signal) => {
          const status = await inspect(signal);
          return {
            ok: true,
            provider: "cli-proxy-api",
            state: status.state,
            models: status.models,
          };
        }),
      },
      {
        method: "POST",
        path: "/subscription-cli/completions",
        scope: "subscription:complete",
        handler: subscriptionHandler(async (req, signal) => {
          const input = parseCompletionInput(req.body);
          const key = await requireProxyKey(readKey);
          const response = await requestProxy(
            fetchImpl,
            "/v1/chat/completions",
            key,
            {
              model: input.model,
              messages: [{ role: "user", content: input.prompt }],
              max_tokens: 2048,
              stream: false,
            },
            TEXT_RESPONSE_LIMIT,
            120_000,
            signal,
          );
          ensureProxySuccess(response);
          const text = parseCompletionText(response.value);
          if (!text)
            throw new SubscriptionCliError(
              "subscription_response_invalid",
              "订阅文本服务未返回有效内容",
              502,
            );
          return {
            ok: true,
            provider: input.provider,
            model: input.model,
            text,
          };
        }),
      },
      {
        method: "POST",
        path: "/subscription-cli/images",
        scope: "subscription:generate",
        handler: subscriptionHandler(async (req, signal) => {
          const input = parseImageInput(req.body);
          const key = await requireProxyKey(readKey);
          const payload =
            input.provider === "chatgpt"
              ? {
                  model: input.model,
                  prompt: input.prompt,
                  n: 1,
                  size: subscriptionImageSize(input.aspectRatio),
                  ...(input.quality === "auto"
                    ? {}
                    : { quality: input.quality }),
                  response_format: "b64_json",
                }
              : {
                  model: input.model,
                  messages: [{ role: "user", content: input.prompt }],
                  modalities: ["text", "image"],
                  image_config: { aspect_ratio: input.aspectRatio },
                  stream: false,
                };
          const response = await requestProxy(
            fetchImpl,
            input.provider === "chatgpt"
              ? "/v1/images/generations"
              : "/v1/chat/completions",
            key,
            payload,
            IMAGE_RESPONSE_LIMIT,
            180_000,
            signal,
          );
          ensureProxySuccess(response);
          const image = parseImageDataUrl(response.value, input.provider);
          return {
            ok: true,
            provider: input.provider,
            model: input.model,
            images: [
              {
                dataUrl: image.dataUrl,
                mimeType: image.mimeType,
                bytes: image.bytes,
              },
            ],
          };
        }),
      },
    ],
    publicHealth: () => ({ subscriptionCliEndpoint: "127.0.0.1:8317" }),
  };
}

async function inspectSubscriptionCli(
  fetchImpl: typeof fetch,
  readKey: () => Promise<string | undefined>,
  detectTools: () => Promise<SubscriptionCliToolStatus[]>,
  signal: AbortSignal,
): Promise<SubscriptionCliStatus> {
  const [key, tools] = await Promise.all([
    readKey().catch(() => undefined),
    detectTools(),
  ]);
  const installed = tools.some(
    (tool) => tool.id === "cli-proxy-api" && tool.installed,
  );
  let response: ProxyResponse;
  try {
    response = await requestProxy(
      fetchImpl,
      "/v1/models",
      key,
      undefined,
      MODEL_RESPONSE_LIMIT,
      8_000,
      signal,
      true,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      provider: "cli-proxy-api",
      state: "stopped",
      installed,
      running: false,
      keyConfigured: Boolean(key),
      endpoint: "127.0.0.1:8317",
      message: "未连接 CLIProxyAPI，请先安装并启动本机服务",
      tools,
      models: [],
    };
  }
  if (!key) {
    return {
      provider: "cli-proxy-api",
      state: "key_missing",
      installed,
      running: true,
      keyConfigured: false,
      endpoint: "127.0.0.1:8317",
      message: "CLIProxyAPI 已启动，但本机访问密钥文件尚未配置",
      tools,
      models: [],
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      provider: "cli-proxy-api",
      state: "authentication_failed",
      installed,
      running: true,
      keyConfigured: true,
      endpoint: "127.0.0.1:8317",
      message: "CLIProxyAPI 本机访问密钥无效，或订阅登录已失效",
      tools,
      models: [],
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      provider: "cli-proxy-api",
      state: "error",
      installed,
      running: true,
      keyConfigured: true,
      endpoint: "127.0.0.1:8317",
      message: "CLIProxyAPI 状态异常",
      tools,
      models: [],
    };
  }
  const models = projectAdvertisedModels(response.value);
  return {
    provider: "cli-proxy-api",
    state: "ready",
    installed,
    running: true,
    keyConfigured: true,
    endpoint: "127.0.0.1:8317",
    message: models.length
      ? "CLIProxyAPI 已连接；仅开放已确认的订阅模型，不回退付费 API"
      : "CLIProxyAPI 已连接，但未发现已允许的订阅模型",
    tools,
    models,
  };
}

async function requestProxy(
  fetchImpl: typeof fetch,
  route: "/v1/models" | "/v1/chat/completions" | "/v1/images/generations",
  key: string | undefined,
  payload: unknown,
  limit: number,
  timeoutMs: number,
  signal: AbortSignal,
  allowErrorStatus = false,
): Promise<ProxyResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${PROXY_BASE_URL}${route}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      redirect: "error",
      signal: controller.signal,
    });
    const value = await readBoundedJson(response, limit);
    if (!allowErrorStatus && !response.ok)
      throw proxyStatusError(response.status);
    return { status: response.status, value };
  } catch (error) {
    if (error instanceof SubscriptionCliError) throw error;
    if (controller.signal.aborted) {
      if (signal.aborted)
        throw new SubscriptionCliError(
          "subscription_cancelled",
          "订阅调用已取消",
          499,
        );
      throw new SubscriptionCliError(
        "subscription_timeout",
        "订阅调用超时；不会切换其他渠道或付费 API",
        504,
      );
    }
    throw new SubscriptionCliError(
      "subscription_unreachable",
      "未连接 CLIProxyAPI；不会切换其他渠道或付费 API",
      503,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function readBoundedJson(
  response: globalThis.Response,
  limit: number,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new SubscriptionCliError(
      "subscription_response_too_large",
      "订阅服务返回内容超过安全上限",
      502,
    );
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new SubscriptionCliError(
          "subscription_response_too_large",
          "订阅服务返回内容超过安全上限",
          502,
        );
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (!bytes.length) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new SubscriptionCliError(
      "subscription_response_invalid",
      "订阅服务返回结构无效",
      502,
    );
  }
}

function projectAdvertisedModels(
  value: unknown,
): SubscriptionCliModelDescriptor[] {
  const data = record(value)?.data;
  if (!Array.isArray(data) || data.length > 4096) return [];
  const advertised = new Set(
    data
      .map((item) => record(item)?.id)
      .filter((id): id is string => typeof id === "string"),
  );
  return MODEL_CATALOG.filter((model) => advertised.has(model.id)).map(
    (model) => ({ ...model, currentlyObservedAvailable: "yes" }),
  );
}

function parseCompletionInput(value: unknown) {
  const body = parseBody(value);
  assertExactKeys(body, ["confirmed", "model", "prompt", "provider"]);
  if (
    body.confirmed !== true ||
    (body.provider !== "chatgpt" && body.provider !== "antigravity") ||
    typeof body.model !== "string" ||
    typeof body.prompt !== "string"
  )
    throw requestInvalid();
  const expected = MODEL_CATALOG.find(
    (item) =>
      item.provider === body.provider &&
      item.id === body.model &&
      item.modality === "text",
  );
  if (!expected || !validPrompt(body.prompt)) throw requestInvalid();
  return {
    provider: body.provider,
    model: body.model,
    prompt: body.prompt.trim(),
  } as const;
}

function parseImageInput(value: unknown) {
  const body = parseBody(value);
  assertExactKeys(body, [
    "aspectRatio",
    "confirmed",
    "model",
    "prompt",
    "provider",
    "quality",
  ]);
  if (
    body.confirmed !== true ||
    (body.provider !== "chatgpt" && body.provider !== "antigravity") ||
    typeof body.model !== "string" ||
    typeof body.prompt !== "string" ||
    typeof body.aspectRatio !== "string" ||
    typeof body.quality !== "string"
  )
    throw requestInvalid();
  const expected = MODEL_CATALOG.find(
    (item) =>
      item.provider === body.provider &&
      item.id === body.model &&
      item.modality === "image",
  );
  const allowedRatios = new Set([
    "1:1",
    "21:9",
    "16:9",
    "3:2",
    "4:3",
    "9:16",
    "2:3",
    "3:4",
  ]);
  const allowedQuality = new Set(["auto", "low", "medium", "high"]);
  if (
    !expected ||
    !validPrompt(body.prompt) ||
    !allowedRatios.has(body.aspectRatio) ||
    !allowedQuality.has(body.quality)
  )
    throw requestInvalid();
  return {
    provider: body.provider,
    model: body.model,
    prompt: body.prompt.trim(),
    aspectRatio: body.aspectRatio,
    quality: body.quality,
  } as const;
}

function parseBody(value: unknown): Record<string, unknown> {
  if (!Buffer.isBuffer(value)) throw requestInvalid();
  try {
    const parsed = JSON.parse(value.toString("utf8")) as unknown;
    const body = record(parsed);
    if (!body) throw requestInvalid();
    return body;
  } catch (error) {
    if (error instanceof SubscriptionCliError) throw error;
    throw requestInvalid();
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  )
    throw requestInvalid();
}

function validPrompt(value: string) {
  const prompt = value.trim();
  return (
    prompt.length > 0 && prompt.length <= 100_000 && !prompt.includes("\0")
  );
}

function parseCompletionText(value: unknown) {
  const choice = Array.isArray(record(value)?.choices)
    ? (record(value)?.choices as unknown[])[0]
    : undefined;
  const content = record(record(choice)?.message)?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = record(part);
      return typeof item?.text === "string" ? item.text : "";
    })
    .join("")
    .trim();
}

function parseImageDataUrl(value: unknown, provider: SubscriptionCliProvider) {
  let encoded = "";
  if (provider === "chatgpt") {
    const data = record(value)?.data;
    const first = Array.isArray(data) ? record(data[0]) : undefined;
    encoded =
      typeof first?.b64_json === "string"
        ? first.b64_json
        : typeof first?.url === "string"
          ? first.url
          : "";
  } else {
    const choices = record(value)?.choices;
    const first = Array.isArray(choices) ? record(choices[0]) : undefined;
    const images = record(first?.message)?.images;
    const image = Array.isArray(images) ? record(images[0]) : undefined;
    const imageUrl = record(image?.image_url)?.url;
    encoded = typeof imageUrl === "string" ? imageUrl : "";
  }
  encoded = encoded.trim();
  if (encoded.startsWith("data:")) {
    const comma = encoded.indexOf(",");
    if (comma < 0 || !/;base64$/i.test(encoded.slice(0, comma)))
      throw imageInvalid();
    encoded = encoded.slice(comma + 1);
  }
  if (!encoded || encoded.length > Math.ceil(IMAGE_BINARY_LIMIT / 3) * 4 + 16)
    throw imageInvalid();
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.byteLength > IMAGE_BINARY_LIMIT)
    throw imageInvalid();
  const mimeType = imageMimeType(bytes);
  if (!mimeType) throw imageInvalid();
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    mimeType,
    bytes: bytes.byteLength,
  };
}

function imageMimeType(
  value: Buffer,
): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (
    value.length >= 8 &&
    value
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    value.length >= 3 &&
    value[0] === 0xff &&
    value[1] === 0xd8 &&
    value[2] === 0xff
  )
    return "image/jpeg";
  if (
    value.length >= 12 &&
    value.subarray(0, 4).toString("ascii") === "RIFF" &&
    value.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

function subscriptionImageSize(ratio: string) {
  if (["21:9", "16:9", "3:2", "4:3"].includes(ratio)) return "1536x1024";
  if (["9:16", "2:3", "3:4"].includes(ratio)) return "1024x1536";
  return "1024x1024";
}

async function readProxyKey(configDir: string) {
  const configured = process.env[KEY_FILE_ENV];
  const keyFile = configured
    ? safeAbsoluteFile(configured)
    : path.join(configDir, DEFAULT_KEY_FILE);
  try {
    const info = await fs.stat(keyFile);
    if (!info.isFile() || info.size > 4096) return undefined;
    const key = (await fs.readFile(keyFile, "utf8")).trim();
    if (key.length < 16 || key.length > 512 || /[\r\n\0]/.test(key))
      return undefined;
    return key;
  } catch {
    return undefined;
  }
}

async function requireProxyKey(readKey: () => Promise<string | undefined>) {
  const key = await readKey().catch(() => undefined);
  if (!key)
    throw new SubscriptionCliError(
      "subscription_key_missing",
      "CLIProxyAPI 本机访问密钥文件尚未配置",
      503,
    );
  return key;
}

function safeAbsoluteFile(value: string) {
  if (!value || value !== value.trim() || !path.isAbsolute(value))
    throw new Error("CLIProxyAPI key file path is invalid");
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root)
    throw new Error("CLIProxyAPI key file path is invalid");
  return resolved;
}

async function detectSubscriptionTools(): Promise<SubscriptionCliToolStatus[]> {
  const definitions: Array<{
    id: SubscriptionCliToolStatus["id"];
    displayName: string;
    commands: string[];
  }> = [
    {
      id: "cli-proxy-api",
      displayName: "CLIProxyAPI",
      commands: ["CLIProxyAPI", "cli-proxy-api"],
    },
    { id: "codex", displayName: "Codex CLI", commands: ["codex"] },
    { id: "antigravity", displayName: "Antigravity CLI", commands: ["agy"] },
    { id: "gemini", displayName: "Gemini CLI", commands: ["gemini"] },
  ];
  return Promise.all(
    definitions.map(async (item) => ({
      id: item.id,
      displayName: item.displayName,
      installed: Boolean(await findExecutable(item.commands)),
    })),
  );
}

async function findExecutable(commands: string[]) {
  const directories = String(process.env.PATH || "")
    .split(path.delimiter)
    .map((item) => item.replace(/^"|"$/g, ""))
    .filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const command of commands) {
      for (const extension of extensions) {
        const candidate = path.join(
          directory,
          process.platform === "win32" && !path.extname(command)
            ? `${command}${extension}`
            : command,
        );
        try {
          const info = await fs.stat(candidate);
          if (info.isFile()) return candidate;
        } catch {
          // Continue searching the controlled PATH candidates.
        }
      }
    }
  }
  return undefined;
}

function ensureProxySuccess(response: ProxyResponse) {
  if (response.status < 200 || response.status >= 300)
    throw proxyStatusError(response.status);
}

function proxyStatusError(status: number) {
  if (status === 401)
    return new SubscriptionCliError(
      "subscription_authentication_failed",
      "订阅登录或本机访问密钥已失效",
      401,
    );
  if (status === 403)
    return new SubscriptionCliError(
      "subscription_permission_denied",
      "当前订阅账号未开放所选模型",
      403,
    );
  if (status === 429)
    return new SubscriptionCliError(
      "subscription_rate_limited",
      "订阅额度不足或请求频率受限",
      429,
    );
  if (status >= 500)
    return new SubscriptionCliError(
      "subscription_upstream_unavailable",
      "订阅上游暂时不可用；不会切换其他渠道或付费 API",
      502,
    );
  return new SubscriptionCliError(
    "subscription_request_failed",
    "订阅调用失败；不会切换其他渠道或付费 API",
    502,
  );
}

function subscriptionHandler(
  action: (req: Request, signal: AbortSignal) => Promise<unknown>,
): RequestHandler {
  return (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.once("aborted", cancel);
    res.once("close", cancel);
    void action(req, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && !res.writableEnded) res.json(value);
      })
      .catch((error) => sendSubscriptionError(res, error))
      .finally(() => {
        req.removeListener("aborted", cancel);
        res.removeListener("close", cancel);
      });
  };
}

function sendSubscriptionError(res: Response, error: unknown) {
  if (res.writableEnded || res.destroyed) return;
  const projected =
    error instanceof SubscriptionCliError
      ? error
      : new SubscriptionCliError(
          "subscription_internal_error",
          "订阅本机服务调用失败",
          500,
        );
  res
    .status(projected.statusCode)
    .json({ ok: false, code: projected.code, message: projected.message });
}

class SubscriptionCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "SubscriptionCliError";
  }
}

function requestInvalid() {
  return new SubscriptionCliError(
    "subscription_request_invalid",
    "订阅调用参数无效",
    400,
  );
}

function imageInvalid() {
  return new SubscriptionCliError(
    "subscription_image_invalid",
    "订阅生图未返回有效图片",
    502,
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
