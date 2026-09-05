import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  createSubscriptionCliHttpModule,
  type SubscriptionCliToolStatus,
} from "../src/modules/subscription-cli-http.js";

const installedTools: SubscriptionCliToolStatus[] = [
  { id: "cli-proxy-api", displayName: "CLIProxyAPI", installed: true },
  { id: "codex", displayName: "Codex CLI", installed: true },
  { id: "antigravity", displayName: "Antigravity CLI", installed: false },
  { id: "gemini", displayName: "Gemini CLI", installed: false },
];

test("subscription module exposes only the fixed CLIProxyAPI routes and scopes", () => {
  const module = fixtureModule(async () => jsonResponse(200, { data: [] }));
  assert.deepEqual(module.descriptor, {
    id: "subscription-cli",
    displayName: "CLIProxyAPI",
    apiVersion: 1,
    scopes: [
      "subscription:status",
      "subscription:models",
      "subscription:complete",
      "subscription:generate",
    ],
  });
  assert.deepEqual(
    module.routes.map((route) => [route.method, route.path, route.scope]),
    [
      ["GET", "/subscription-cli/status", "subscription:status"],
      ["GET", "/subscription-cli/models", "subscription:models"],
      ["POST", "/subscription-cli/completions", "subscription:complete"],
      ["POST", "/subscription-cli/images", "subscription:generate"],
    ],
  );
});

test("status projects only the four controlled subscription models", async () => {
  const module = fixtureModule(async () =>
    jsonResponse(200, {
      data: [
        { id: "gpt-5.5" },
        { id: "gpt-image-2" },
        { id: "gemini-3.1-flash-lite" },
        { id: "gemini-3.1-flash-image" },
        { id: "uncontrolled-model" },
      ],
    }),
  );
  const result = await invoke(module, "/subscription-cli/status");
  assert.equal(result.status.state, "ready");
  assert.deepEqual(
    result.status.models.map((item: { id: string }) => item.id),
    [
      "gpt-5.5",
      "gpt-image-2",
      "gemini-3.1-flash-lite",
      "gemini-3.1-flash-image",
    ],
  );
  assert.equal(JSON.stringify(result).includes("test-local-client-key"), false);
});

test("completion uses the fixed loopback endpoint, bearer key and exact allowlist", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const module = fixtureModule(async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse(200, {
      choices: [{ message: { content: "订阅文本结果" } }],
    });
  });
  const result = await invoke(module, "/subscription-cli/completions", {
    confirmed: true,
    provider: "chatgpt",
    model: "gpt-5.5",
    prompt: "生成提示词",
  });
  assert.deepEqual(result, {
    ok: true,
    provider: "chatgpt",
    model: "gpt-5.5",
    text: "订阅文本结果",
  });
  assert.equal(requests[0].url, "http://127.0.0.1:8317/v1/chat/completions");
  assert.equal(
    new Headers(requests[0].init?.headers).get("authorization"),
    "Bearer test-local-client-key-0001",
  );
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "生成提示词" }],
    max_tokens: 2048,
    stream: false,
  });
});

test("image calls use provider-specific fixed endpoints and return validated data URLs", async () => {
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
  const paths: string[] = [];
  const module = fixtureModule(async (input) => {
    const url = String(input);
    paths.push(url);
    return url.endsWith("/images/generations")
      ? jsonResponse(200, { data: [{ b64_json: png }] })
      : jsonResponse(200, {
          choices: [
            {
              message: {
                images: [
                  { image_url: { url: `data:image/png;base64,${png}` } },
                ],
              },
            },
          ],
        });
  });
  const chatgpt = await invoke(module, "/subscription-cli/images", {
    confirmed: true,
    provider: "chatgpt",
    model: "gpt-image-2",
    prompt: "一只猫",
    aspectRatio: "1:1",
    quality: "high",
  });
  const antigravity = await invoke(module, "/subscription-cli/images", {
    confirmed: true,
    provider: "antigravity",
    model: "gemini-3.1-flash-image",
    prompt: "一只狗",
    aspectRatio: "16:9",
    quality: "auto",
  });
  assert.equal(chatgpt.images[0].dataUrl, `data:image/png;base64,${png}`);
  assert.equal(antigravity.images[0].dataUrl, `data:image/png;base64,${png}`);
  assert.deepEqual(paths, [
    "http://127.0.0.1:8317/v1/images/generations",
    "http://127.0.0.1:8317/v1/chat/completions",
  ]);
});

test("unconfirmed, mismatched and unsupported subscription requests fail closed before fetch", async () => {
  let calls = 0;
  const module = fixtureModule(async () => {
    calls += 1;
    return jsonResponse(200, {});
  });
  for (const body of [
    { confirmed: false, provider: "chatgpt", model: "gpt-5.5", prompt: "test" },
    {
      confirmed: true,
      provider: "chatgpt",
      model: "gemini-3.1-flash-lite",
      prompt: "test",
    },
    {
      confirmed: true,
      provider: "chatgpt",
      model: "gpt-5.5",
      prompt: "test",
      fallback: true,
    },
  ]) {
    const result = await invoke(
      module,
      "/subscription-cli/completions",
      body,
      400,
    );
    assert.deepEqual(result, {
      ok: false,
      code: "subscription_request_invalid",
      message: "订阅调用参数无效",
    });
  }
  assert.equal(calls, 0);
});

function fixtureModule(fetchImpl: typeof fetch) {
  return createSubscriptionCliHttpModule({
    configDir: "C:\\fixture",
    fetch: fetchImpl,
    readKey: async () => "test-local-client-key-0001",
    detectTools: async () => installedTools,
  });
}

async function invoke(
  module: ReturnType<typeof createSubscriptionCliHttpModule>,
  routePath: string,
  body?: unknown,
  expectedStatus = 200,
): Promise<any> {
  const route = module.routes.find((item) => item.path === routePath);
  assert(route);
  const req = new EventEmitter() as EventEmitter & { body?: Buffer };
  req.body = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const res = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    writableEnded: boolean;
    statusCode: number;
    json(value: unknown): void;
    status(code: number): typeof res;
  };
  res.destroyed = false;
  res.writableEnded = false;
  res.statusCode = 200;
  let resolve!: (value: any) => void;
  const output = new Promise<any>((done) => {
    resolve = done;
  });
  res.json = (value) => {
    res.writableEnded = true;
    resolve(value);
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  route.handler(req as never, res as never, () => undefined);
  const value = await output;
  assert.equal(res.statusCode, expectedStatus);
  return value;
}

function jsonResponse(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
