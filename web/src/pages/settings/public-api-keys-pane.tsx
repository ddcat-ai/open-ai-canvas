import { Alert, App, Button, Input, Popconfirm, Select, Tag } from "antd";
import { BookOpen, Check, Clipboard, Code2, Copy, ExternalLink, FileJson, Image, KeyRound, List, Plus, RefreshCw, ShieldCheck, Terminal, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { listLogicalModels, type PublicLogicalModel } from "@/services/api/logical-models";
import { createPublicAPIKey, listPublicAPIKeys, revokePublicAPIKey, type CreatedPublicAPIKey, type PublicAPIKey } from "@/services/api/public-api";

type DeveloperView = "keys" | "models" | "docs";

const developerViews: Array<{ key: DeveloperView; label: string; description: string; icon: typeof KeyRound }> = [
    { key: "keys", label: "API Key", description: "创建和撤销调用凭证", icon: KeyRound },
    { key: "models", label: "模型目录", description: "查看可调用模型", icon: List },
    { key: "docs", label: "调用说明", description: "接口、参数和示例", icon: BookOpen },
];

function publicAPIBaseURL() {
    if (typeof window === "undefined") return "/api/v1";
    return `${window.location.origin}/api/v1`;
}

function formatCredits(value?: number) {
    if (!Number.isFinite(value) || !value) return "按规格计费";
    return `${(value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分起`;
}

function modelCapabilitySummary(model: PublicLogicalModel) {
    const spec = model.capabilitySpec;
    const pieces: string[] = [];
    if (model.capability === "image") {
        const presets = spec.imageSize?.presets?.map((item) => item.size).filter(Boolean) || [];
        if (presets.length > 0) pieces.push(`支持 ${presets.slice(0, 3).join("、")}${presets.length > 3 ? " 等尺寸" : ""}`);
        if (spec.options?.quality) pieces.push("支持质量选项");
    } else {
        const ratios = spec.options?.aspect_ratio?.values?.filter((item): item is string => typeof item === "string") || [];
        if (ratios.length > 0) pieces.push(`比例 ${ratios.slice(0, 3).join("、")}`);
        if (spec.options?.duration) pieces.push("支持时长参数");
        if (spec.options?.resolution) pieces.push("支持分辨率参数");
    }
    return pieces.join(" · ") || "使用模型默认参数";
}

function buildGenerationExample(model: PublicLogicalModel | undefined) {
    const selectedModel = model?.code || (model?.capability === "video" ? "your-video-model" : "your-image-model");
    const type = model?.capability === "video" ? "video" : "image";
    const body =
        type === "video"
            ? `{"model":"${selectedModel}","type":"video","prompt":"雨夜街头，镜头缓慢向前推进","aspect_ratio":"16:9","duration":5,"resolution":"720p"}`
            : `{"model":"${selectedModel}","type":"image","prompt":"一只在雨中的猫","size":"1024x1024","quality":"high"}`;
    return `curl ${publicAPIBaseURL()}/generations \\
  -H 'Authorization: Bearer sk_live_...' \\
  -H 'Idempotency-Key: demo-${type}-001' \\
  -H 'Content-Type: application/json' \\
  -d '${body}'`;
}

function CodeBlock({ code, label = "示例代码", onCopy }: { code: string; label?: string; onCopy: () => void }) {
    return (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-[#111318] text-[#e7e9ee]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/55">
                <span className="flex items-center gap-2">
                    <Terminal className="size-3.5" />
                    {label}
                </span>
                <Button type="text" size="small" className="!text-white/70 hover:!text-white" icon={<Copy className="size-3.5" />} onClick={onCopy}>
                    复制
                </Button>
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-6">{code}</pre>
        </div>
    );
}

function EndpointCard({ method, path, description }: { method: string; path: string; description: string }) {
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-surface-secondary/35 p-3 sm:flex-row sm:items-center">
            <Tag color={method === "POST" ? "blue" : "default"} className="m-0 w-fit font-mono text-xs">
                {method}
            </Tag>
            <code className="text-sm font-medium">{path}</code>
            <span className="text-xs text-muted-foreground sm:ml-auto">{description}</span>
        </div>
    );
}

function FieldTable({ rows }: { rows: Array<[string, string, string]> }) {
    return (
        <div className="overflow-hidden rounded-xl border border-border/70 text-xs">
            <div className="grid grid-cols-[minmax(100px,0.8fr)_minmax(100px,0.7fr)_minmax(180px,1.5fr)] gap-3 border-b border-border/70 bg-surface-secondary/45 px-3 py-2 font-medium text-muted-foreground">
                <span>字段</span>
                <span>类型</span>
                <span>说明</span>
            </div>
            {rows.map(([name, type, description]) => (
                <div key={name} className="grid grid-cols-[minmax(100px,0.8fr)_minmax(100px,0.7fr)_minmax(180px,1.5fr)] gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0">
                    <code>{name}</code>
                    <span className="text-muted-foreground">{type}</span>
                    <span className="text-muted-foreground">{description}</span>
                </div>
            ))}
        </div>
    );
}

export function PublicAPIKeysPane() {
    const { message } = App.useApp();
    const [view, setView] = useState<DeveloperView>("keys");
    const [keys, setKeys] = useState<PublicAPIKey[]>([]);
    const [models, setModels] = useState<PublicLogicalModel[]>([]);
    const [name, setName] = useState("第三方调用 Key");
    const [modelAllowlist, setModelAllowlist] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<CreatedPublicAPIKey | null>(null);
    const [modelError, setModelError] = useState("");

    const availableModels = useMemo(() => models.filter((model) => model.available && (model.capability === "image" || model.capability === "video")), [models]);
    const imageModels = useMemo(() => availableModels.filter((model) => model.capability === "image"), [availableModels]);
    const videoModels = useMemo(() => availableModels.filter((model) => model.capability === "video"), [availableModels]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listPublicAPIKeys();
            setKeys(result.keys || []);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 API Key 失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    const loadModels = useCallback(async () => {
        setModelsLoading(true);
        setModelError("");
        try {
            const result = await listLogicalModels();
            setModels(result.models);
        } catch (error) {
            setModelError(error instanceof Error ? error.message : "读取模型目录失败");
        } finally {
            setModelsLoading(false);
        }
    }, []);

    useEffect(() => {
        void Promise.all([load(), loadModels()]);
    }, [load, loadModels]);

    const refresh = async () => {
        await Promise.all([load(), loadModels()]);
        message.success("开发者 API 信息已刷新");
    };

    const create = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning("请填写 Key 名称");
            return;
        }
        setCreating(true);
        try {
            const result = await createPublicAPIKey({ name: trimmed, modelAllowlist: modelAllowlist.length ? modelAllowlist : undefined });
            setCreated(result);
            setName("第三方调用 Key");
            setModelAllowlist([]);
            await load();
            message.success("API Key 已创建，请立即复制明文");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建 API Key 失败");
        } finally {
            setCreating(false);
        }
    };

    const revoke = async (id: string) => {
        try {
            await revokePublicAPIKey(id);
            setKeys((items) => items.map((item) => (item.id === id ? { ...item, status: "revoked" } : item)));
            message.success("API Key 已撤销");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "撤销 API Key 失败");
        }
    };

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            message.success("已复制");
        } catch {
            message.error("复制失败，请手动复制");
        }
    };

    const modelsJSON = `curl ${publicAPIBaseURL()}/models \\
  -H 'Authorization: Bearer sk_live_...'`;
    const pollingJSON = `curl ${publicAPIBaseURL()}/generations/generation_xxx \\
  -H 'Authorization: Bearer sk_live_...'`;
    const javascriptExample = `const response = await fetch("${publicAPIBaseURL()}/generations", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk_live_...",
    "Idempotency-Key": crypto.randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "your-image-model",
    type: "image",
    prompt: "一只在雨中的猫",
    size: "1024x1024",
  }),
});
const task = await response.json();`;
    const pythonExample = `import requests

response = requests.post(
    "${publicAPIBaseURL()}/generations",
    headers={
        "Authorization": "Bearer sk_live_...",
        "Idempotency-Key": "demo-python-001",
    },
    json={
        "model": "your-image-model",
        "type": "image",
        "prompt": "一只在雨中的猫",
        "size": "1024x1024",
    },
)
task = response.json()`;
    const responseExample = `{
  "id": "generation_xxx",
  "object": "generation",
  "type": "image",
  "status": "succeeded",
  "model": "your-image-model",
  "result": {
    "images": [{ "resource_id": "resource_xxx", "url": "https://..." }]
  }
}`;

    return (
        <div className="settings-pane">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h2>开发者 API</h2>
                        <Tag color="blue" className="m-0">
                            OpenAI 风格
                        </Tag>
                    </div>
                    <p>用平台 Key 从第三方调用已开放的生图和生视频模型。上游渠道密钥不会暴露给调用方，任务按平台模型配置扣除积分。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()} loading={loading || modelsLoading}>
                    刷新
                </Button>
            </div>

            <div className="mb-5 flex flex-wrap gap-1 border-b border-border/70" role="tablist" aria-label="开发者 API 内容">
                {developerViews.map((item) => {
                    const Icon = item.icon;
                    const selected = view === item.key;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            onClick={() => setView(item.key)}
                            className={`flex items-center gap-2 border-b-2 px-3 py-3 text-left transition-colors ${selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        >
                            <Icon className="size-4" />
                            <span>
                                <strong className="block text-sm font-medium">{item.label}</strong>
                                <small className="hidden text-[11px] opacity-70 sm:block">{item.description}</small>
                            </span>
                        </button>
                    );
                })}
            </div>

            {view === "keys" ? (
                <div className="settings-section space-y-4">
                    <Alert showIcon icon={<ShieldCheck className="size-4" />} message="安全提示" description="Key 明文只在创建成功时显示一次。请把它放在服务端环境变量中，不要写入前端代码、日志或提交到 Git。" />
                    <div className="rounded-xl border border-border/70 bg-surface-secondary/60 p-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                            <KeyRound className="size-4" />
                            创建一个调用 Key
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_auto]">
                            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="例如：我的工作流" onPressEnter={() => void create()} />
                            <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                maxTagCount="responsive"
                                value={modelAllowlist}
                                loading={modelsLoading}
                                onChange={setModelAllowlist}
                                placeholder="模型授权（不选则允许全部图片和视频模型）"
                                options={availableModels.map((model) => ({ value: model.code, label: `${model.name} · ${model.code}` }))}
                                optionFilterProp="label"
                            />
                            <Button type="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => void create()}>
                                创建 Key
                            </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">可以给不同项目创建不同 Key，并按模型限制权限；留空表示允许当前目录中所有可用模型。</p>
                    </div>
                    {created ? (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                                <Clipboard className="size-4" />
                                请立即复制新 Key
                            </div>
                            <p className="mb-3 text-xs text-muted-foreground">明文只会显示这一次，关闭或刷新后无法再次查看。</p>
                            <div className="flex gap-2">
                                <Input.Password value={created.secret} readOnly visibilityToggle={false} />
                                <Button icon={<Copy className="size-4" />} onClick={() => void copy(created.secret)}>
                                    复制
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    <div className="space-y-2">
                        {keys.length === 0 && !loading ? <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">还没有 API Key</div> : null}
                        {keys.map((item) => (
                            <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{item.name}</span>
                                        <Tag color={item.status === "active" ? "green" : "default"}>{item.status === "active" ? "使用中" : "已撤销"}</Tag>
                                    </div>
                                    <div className="mt-1 font-mono text-xs text-muted-foreground">{item.prefix}••••••••</div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                        <span>创建于 {new Date(item.createdAt).toLocaleString()}</span>
                                        <span>{item.modelAllowlist?.length ? `授权 ${item.modelAllowlist.length} 个模型` : "允许全部图片和视频模型"}</span>
                                    </div>
                                </div>
                                {item.status === "active" ? (
                                    <Popconfirm title="撤销这个 API Key？" description="撤销后，使用它的第三方请求会立即失败。" onConfirm={() => void revoke(item.id)} okText="撤销" cancelText="取消">
                                        <Button danger type="text" icon={<Trash2 className="size-4" />}>
                                            撤销
                                        </Button>
                                    </Popconfirm>
                                ) : (
                                    <Check className="size-4 text-muted-foreground" />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="rounded-xl border border-border/70 bg-surface-secondary/40 p-4 text-xs leading-6 text-muted-foreground">
                        <span className="font-medium text-foreground">调用入口：</span>
                        <code>{publicAPIBaseURL()}</code> · 使用 <code>Authorization: Bearer sk_live_...</code> 和每次请求唯一的 <code>Idempotency-Key</code>。图片和视频任务都是异步的，提交后通过查询接口获取结果。
                    </div>
                </div>
            ) : null}

            {view === "models" ? (
                <div className="settings-section space-y-5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">当前开放模型</h3>
                            <p className="mt-1 text-xs text-muted-foreground">第三方只能调用这里列出的可用模型，提交时使用模型的公开 Code。</p>
                        </div>
                        <Tag className="m-0">{availableModels.length} 个可用模型</Tag>
                    </div>
                    {modelError ? (
                        <Alert
                            type="warning"
                            showIcon
                            message="模型目录暂时读取失败"
                            description={modelError}
                            action={
                                <Button size="small" onClick={() => void loadModels()}>
                                    重试
                                </Button>
                            }
                        />
                    ) : null}
                    {modelsLoading ? <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">正在读取模型目录…</div> : null}
                    {!modelsLoading && availableModels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">当前还没有开放的图片或视频模型，请先在管理端配置逻辑模型和可用渠道。</div>
                    ) : null}
                    <div className="grid gap-3 xl:grid-cols-2">
                        {availableModels.map((model) => {
                            const isImage = model.capability === "image";
                            return (
                                <article key={model.id} className="rounded-xl border border-border/70 bg-surface-secondary/25 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{isImage ? <Image className="size-4" /> : <Video className="size-4" />}</div>
                                            <div className="min-w-0">
                                                <h4 className="m-0 truncate text-sm font-semibold">{model.name}</h4>
                                                <code className="text-xs text-muted-foreground">{model.code}</code>
                                            </div>
                                        </div>
                                        <Tag color={isImage ? "blue" : "purple"} className="m-0">
                                            {isImage ? "图片" : "视频"}
                                        </Tag>
                                    </div>
                                    <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{model.description || modelCapabilitySummary(model)}</p>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                        <Tag className="m-0">{model.priceLabel || formatCredits(model.unitPriceMicrocredits)}</Tag>
                                        <span className="rounded-md bg-surface-secondary px-2 py-1 text-muted-foreground">{modelCapabilitySummary(model)}</span>
                                    </div>
                                    <div className="mt-4">
                                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy(buildGenerationExample(model))}>
                                            复制调用示例
                                        </Button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {view === "docs" ? (
                <div className="settings-section space-y-6">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-start gap-3">
                            <FileJson className="mt-0.5 size-5 shrink-0 text-primary" />
                            <div>
                                <h3 className="m-0 text-base font-semibold">三步接入</h3>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">先创建平台 Key，再读取模型目录，最后提交异步生成任务并轮询结果。平台负责模型路由、上游调用、资源保存和积分结算。</p>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            <div className="rounded-lg bg-background/60 p-3 text-xs">
                                <b>1. 鉴权</b>
                                <span className="mt-1 block text-muted-foreground">Bearer 平台 Key</span>
                            </div>
                            <div className="rounded-lg bg-background/60 p-3 text-xs">
                                <b>2. 提交</b>
                                <span className="mt-1 block text-muted-foreground">POST generations</span>
                            </div>
                            <div className="rounded-lg bg-background/60 p-3 text-xs">
                                <b>3. 查询</b>
                                <span className="mt-1 block text-muted-foreground">轮询任务结果</span>
                            </div>
                        </div>
                    </div>
                    <section className="space-y-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">接口地址与鉴权</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                当前站点的公共接口前缀为 <code>{publicAPIBaseURL()}</code>，成功响应直接返回接口对象，不使用工作台的业务信封。
                            </p>
                        </div>
                        <EndpointCard method="GET" path="/models" description="列出当前 Key 可使用的模型" />
                        <EndpointCard method="POST" path="/generations" description="创建异步图片或视频任务" />
                        <EndpointCard method="GET" path="/generations/:id" description="查询任务状态和结果" />
                        <CodeBlock label="读取模型目录" code={modelsJSON} onCopy={() => void copy(modelsJSON)} />
                    </section>
                    <section className="space-y-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">图片生成</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                `model` 使用模型目录返回的 <code>code</code>；同一个幂等键重试不会重复创建任务或重复占用创建限流。
                            </p>
                        </div>
                        <CodeBlock code={buildGenerationExample(imageModels[0])} onCopy={() => void copy(buildGenerationExample(imageModels[0]))} />
                        <FieldTable
                            rows={[
                                ["model", "string", "模型公开 Code 或模型 ID"],
                                ["type", "string", "固定为 image"],
                                ["prompt", "string", "必填，最多 8000 个字符"],
                                ["size", "string", "尺寸，如 1024x1024；也可使用 aspect_ratio"],
                                ["quality", "string", "可选，按模型能力支持"],
                                ["Idempotency-Key", "header", "必填且最多 200 个字符"],
                            ]}
                        />
                    </section>
                    <section className="space-y-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">视频生成</h3>
                            <p className="mt-1 text-xs text-muted-foreground">视频生成同样是异步任务，具体比例、分辨率和时长以模型目录中的能力为准。</p>
                        </div>
                        <CodeBlock code={buildGenerationExample(videoModels[0])} onCopy={() => void copy(buildGenerationExample(videoModels[0]))} />
                        <FieldTable
                            rows={[
                                ["model", "string", "模型公开 Code 或模型 ID"],
                                ["type", "string", "固定为 video"],
                                ["prompt", "string", "必填，最多 8000 个字符"],
                                ["aspect_ratio", "string", "画面比例，如 16:9"],
                                ["duration", "integer", "视频时长，1–60 秒"],
                                ["resolution", "string", "分辨率，如 720p"],
                                ["generate_audio", "boolean", "是否生成声音（按模型支持）"],
                                ["watermark", "boolean", "是否添加水印（按模型支持）"],
                            ]}
                        />
                    </section>
                    <section className="space-y-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">查询任务与获取结果</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                创建接口返回 HTTP 202 和任务 <code>id</code>。建议每 2–5 秒查询一次，直到状态变为 succeeded、failed 或 cancelled。
                            </p>
                        </div>
                        <CodeBlock label="查询任务" code={pollingJSON} onCopy={() => void copy(pollingJSON)} />
                        <CodeBlock label="成功响应示例" code={responseExample} onCopy={() => void copy(responseExample)} />
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="rounded-lg border border-border/70 p-3 text-xs">
                                <Tag color="gold">queued / running</Tag>
                                <p className="mt-2 m-0 text-muted-foreground">继续轮询，不要重复创建。</p>
                            </div>
                            <div className="rounded-lg border border-border/70 p-3 text-xs">
                                <Tag color="green">succeeded</Tag>
                                <p className="mt-2 m-0 text-muted-foreground">从 result.images 或 result.videos 读取 URL。</p>
                            </div>
                            <div className="rounded-lg border border-border/70 p-3 text-xs">
                                <Tag color="red">failed / cancelled</Tag>
                                <p className="mt-2 m-0 text-muted-foreground">读取 error.code 和 error.message。</p>
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3">
                        <div>
                            <h3 className="m-0 text-base font-semibold">JavaScript / Python</h3>
                            <p className="mt-1 text-xs text-muted-foreground">服务端调用建议把平台 Key 放在环境变量中；浏览器端不要直接携带长期 Key。</p>
                        </div>
                        <div className="grid gap-3 xl:grid-cols-2">
                            <CodeBlock label="JavaScript" code={javascriptExample} onCopy={() => void copy(javascriptExample)} />
                            <CodeBlock label="Python" code={pythonExample} onCopy={() => void copy(pythonExample)} />
                        </div>
                    </section>
                    <section className="space-y-3">
                        <h3 className="m-0 text-base font-semibold">完整接口合同</h3>
                        <p className="m-0 text-sm leading-6 text-muted-foreground">服务端同时提供 OpenAPI 3.0 规范，可导入 Postman、Apifox 或其他接口工具：</p>
                        <div className="flex flex-wrap gap-2">
                            <Button icon={<Code2 className="size-4" />} onClick={() => void copy(`${typeof window === "undefined" ? "" : window.location.origin}/api/openapi.yaml`)}>
                                复制 OpenAPI 地址
                            </Button>
                            <a href="/api/openapi.yaml" target="_blank" rel="noreferrer" className="ant-btn ant-btn-default inline-flex items-center gap-2">
                                <ExternalLink className="size-4" />
                                打开 OpenAPI
                            </a>
                        </div>
                        <p className="m-0 text-xs text-muted-foreground">资源 URL 是短期签名地址，请在过期前下载；平台 Key 只负责创建和查询自己提交的任务。</p>
                    </section>
                    <Alert type="info" showIcon message="积分与安全" description="每次生成会按公开模型的当前价格和实际规格扣除积分；上游 Token 始终保存在平台渠道配置中。不要把平台 Key 放进浏览器、移动端安装包或公开仓库。" />
                </div>
            ) : null}
        </div>
    );
}
