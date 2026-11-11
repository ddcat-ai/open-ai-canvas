import { App, Button, Input, Select } from "antd";
import copy from "copy-to-clipboard";
import { ArrowLeft, ArrowUpRight, Code2, Copy, FileCode2, KeyRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Callout } from "@/components/ui/product/callout";
import { StatusBadge } from "@/components/ui/base/badges";
import { apiBaseURL } from "@/services/api/request";
import { getModelCallCatalog } from "@/services/api/model-calls";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { highlightCode, type DocumentationCodeLanguage } from "./code-highlighter";
import { apiDocumentationBaseURL, modelCallExample, type APICapability } from "./api-examples";
import "./api-docs.css";

const sections = [
    ["quickstart", "快速开始"],
    ["authentication", "鉴权与密钥"],
    ["models", "模型目录"],
    ["create", "创建调用"],
    ["parameters", "生成参数"],
    ["results", "查询与下载"],
    ["errors", "错误与限制"],
] as const;

const parameters = [
    ["model", "string · 必填", "模型目录返回的 channelId::modelKey，不是模型显示名称。"],
    ["capability", "string", "text / image / video / audio，默认 text。"],
    ["prompt", "string", "本轮提示词；与 messages 至少提供一项。"],
    ["messages", "array · 仅文本", "role 为 system、user 或 assistant；content 为非空字符串。省略 prompt 时最后一条须为 user。"],
    ["parameters.thinking", "boolean · 文本", "按模型能力归一为关闭/标准档；无法关闭的模型使用最低开启档。输出上限沿用模型配置。"],
    ["parameters.aspectRatio", "string · 图片/视频", "模型支持的画幅，例如 1:1 或 16:9。"],
    ["parameters.resolution", "string · 图片/视频", "模型支持的分辨率或档位。"],
    ["parameters.quality", "string · 图片", "模型声明的质量档位。"],
    ["parameters.count", "integer · 图片", "生成张数；仍受所选模型的张数限制。"],
    ["parameters.duration", "integer · 视频", "视频时长，单位为秒。"],
    ["parameters.generateAudio / watermark", "boolean · 视频", "是否生成音频、是否带水印；省略时沿用模型默认值。"],
    ["parameters.voice / audioFormat / audioSpeed", "string · 音频", "声音、输出格式与速度，取值由所选模型决定。"],
] as const;

const errors = [
    ["400", "请求不符合要求", "检查字段、模型 ID、能力和价格配置，也可能是余额不足。"],
    ["401", "鉴权失败", "检查 Bearer Key 是否缺失、到期或已被吊销。"],
    ["403", "无权使用", "账号已禁用、模型权限或账号额度不满足。"],
    ["404", "对象不可访问", "任务或产物不存在，或不属于当前账号。"],
    ["413", "请求过大", "模型请求体最多 1 MiB。"],
    ["429", "触发限流", "降低频率；不要为了重试查询而重新创建付费调用。"],
    ["500 / 503", "服务暂不可用", "保留已获取的调用 ID，稍后查询原调用，避免重复提交。"],
] as const;

export default function APIDocsPage() {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const root = apiDocumentationBaseURL(apiBaseURL, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    const [capability, setCapability] = useState<APICapability>("text");
    const [model, setModel] = useState("CHANNEL_ID::MODEL_KEY");
    const userId = useUserStore((state) => state.user?.id);
    const catalog = useQuery({ queryKey: ["model-call-catalog", userId], queryFn: ({ signal }) => getModelCallCatalog(signal), enabled: Boolean(userId), retry: false });
    const models = catalog.data?.models.filter((item) => item.capability === capability) ?? [];
    const selected = models.find((item) => item.id === model) ?? models[0];
    const exampleModel = selected?.id ?? model;
    const example = modelCallExample(root, exampleModel, capability, brandName, selected);
    return (
        <main className="api-docs h-dvh overflow-y-auto bg-background text-foreground">
            <header className="api-docs-topbar border-b border-border bg-background/95">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
                        <Code2 className="size-5" />
                        {brandName} <span className="font-normal text-muted-foreground">/ 开发者文档</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <Link to="/" className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm text-foreground hover:bg-surface-secondary">
                            <ArrowLeft className="size-4" />
                            工作台
                        </Link>
                        <Link to="/settings?section=api-keys" className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-secondary">
                            <KeyRound className="size-4" />
                            管理 API Key
                        </Link>
                    </div>
                </div>
            </header>
            <div className="api-docs-layout mx-auto grid max-w-6xl gap-8 px-5 py-8">
                <aside>
                    <nav aria-label="API 文档目录" className="api-docs-nav">
                        <p className="mb-3 text-xs font-medium text-muted-foreground">模型调用 API</p>
                        {sections.map(([id, label]) => (
                            <a key={id} href={`#${id}`}>
                                {label}
                            </a>
                        ))}
                        <a href={`${root}/openapi.yaml`} target="_blank" rel="noreferrer">
                            <FileCode2 className="size-4" />
                            OpenAPI 规范
                            <ArrowUpRight className="size-3" />
                        </a>
                    </nav>
                </aside>
                <article className="min-w-0 space-y-10 pb-16">
                    <div className="space-y-4">
                        <StatusBadge>HTTP JSON · 异步任务</StatusBadge>
                        <h1 className="text-3xl font-semibold tracking-tight">把模型能力接入你的应用</h1>
                        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">使用独立 API Key 调用文本、图片、视频和音频模型。权限、限额与积分沿用账号配置，提交后通过调用 ID 获取结果。</p>
                        <div className="rounded-lg border border-border bg-surface-secondary px-4 py-3 text-sm">
                            <span className="mr-3 text-muted-foreground">API 地址</span>
                            <code className="break-all">{root}</code>
                        </div>
                    </div>

                    <DocSection id="quickstart" title="快速开始" description="准备好系统模型和账号积分后，完成第一次调用只需三步。">
                        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                            <li>
                                前往
                                <Link to="/settings?section=api-keys" className="api-docs-link">
                                    设置 → API 访问
                                </Link>
                                创建密钥，并立即保存。
                            </li>
                            <li>
                                查询模型目录，复制目标模型的 <code>id</code>。
                            </li>
                            <li>
                                提交调用，保存返回的 <code>data.id</code>，查询至成功后读取结果。
                            </li>
                        </ol>
                        <CodeBlock title="设置环境变量" language="bash">
                            {"export CANVAS_API_KEY='REPLACE_WITH_YOUR_API_KEY'"}
                        </CodeBlock>
                        <Callout>示例中的 Key、模型 ID、调用 ID 都是占位值。请在自己的服务端执行，生产使用 HTTPS。</Callout>
                    </DocSection>

                    <DocSection id="authentication" title="鉴权与密钥" description="模型接口使用 Bearer Key；密钥管理使用站内登录 Cookie。">
                        <CodeBlock title="请求头" language="text">
                            {"Authorization: Bearer YOUR_API_KEY\nContent-Type: application/json"}
                        </CodeBlock>
                        <p>密钥明文仅签发时显示一次。之后只能看到名称、前缀、创建时间、到期时间和吊销状态；无法找回明文。不要把 Key 放进 URL、网页前端或公开代码。</p>
                        <div className="api-docs-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>管理接口</th>
                                        <th>行为</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>
                                            <code>POST /api-keys</code>
                                        </td>
                                        <td>登录后签发；请求含 name，可选 expiresAt（RFC3339），返回 201。</td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <code>GET /api-keys</code>
                                        </td>
                                        <td>列出自己的 Key 元数据。</td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <code>DELETE /api-keys/:id</code>
                                        </td>
                                        <td>吊销自己的 Key，重复吊销幂等。</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p>每个应用建议独立使用一把 Key。Key 可调用账号所有可见模型，费用与限额按账号共享，当前没有单 Key 限额或模型授权。</p>
                    </DocSection>

                    <DocSection id="models" title="模型目录" description="GET /model-calls/models · 使用同一把 Bearer Key 查询当前账号可用模型。">
                        {!userId ? (
                            <Callout>
                                <Link className="api-docs-link" to="/login?next=%2Fapi-docs">
                                    登录后查看账号可用模型
                                </Link>
                                。外部应用使用下方 Bearer Key 查询。
                            </Callout>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm text-muted-foreground">当前账号可用模型 · {catalog.data?.models.length ?? 0} 个</p>
                                    <Button size="small" loading={catalog.isFetching} onClick={() => void catalog.refetch()}>
                                        刷新目录
                                    </Button>
                                </div>
                                {catalog.isPending && <p role="status">正在加载模型目录…</p>}
                                {catalog.isError && <Callout tone="warning">{catalog.error instanceof Error ? catalog.error.message : "模型目录加载失败"}</Callout>}
                                {catalog.isSuccess && catalog.data.models.length === 0 && <Callout>当前账号没有可用模型，请联系管理员配置模型、权限及价格。</Callout>}
                                {catalog.isSuccess && catalog.data.models.length > 0 && <p className="text-sm text-muted-foreground">在下方选择能力和模型，查看参数规格与对应调用示例。</p>}
                            </div>
                        )}
                        <CodeBlock title="curl" language="bash">{`curl -sS '${root}/model-calls/models' \\\n  -H "Authorization: Bearer $CANVAS_API_KEY"`}</CodeBlock>
                        <CodeBlock title="响应示例">
                            {JSON.stringify(
                                {
                                    code: 0,
                                    data: {
                                        models: [
                                            {
                                                id: "CHANNEL_ID::MODEL_KEY",
                                                name: "示例文本模型",
                                                capability: "text",
                                                outputTokenLimit: 16384,
                                                parameters: { thinking: { type: "boolean", default: false } },
                                            },
                                        ],
                                    },
                                    msg: "ok",
                                },
                                null,
                                2,
                            )}
                        </CodeBlock>
                        <p>parameters 只列出外部调用可接收的字段；未声明的范围不表示任意值均可用。参数组合、价格和最终准入仍由任务校验决定。</p>
                        <p>outputTokenLimit 展示文本模型配置的输出上限，不是请求参数。</p>
                        <p>
                            使用返回的 <code>id</code> 发起调用；不能使用显示名称或自行填写上游模型名。
                        </p>
                    </DocSection>

                    <DocSection id="create" title="创建调用" description="POST /model-calls · 所有能力均异步返回，成功受理为 HTTP 202。">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <label className="space-y-1 text-xs text-muted-foreground">
                                <span>能力</span>
                                <Select
                                    className="w-full"
                                    aria-label="示例能力"
                                    value={capability}
                                    onChange={setCapability}
                                    options={[
                                        { value: "text", label: "文本" },
                                        { value: "image", label: "图片" },
                                        { value: "video", label: "视频" },
                                        { value: "audio", label: "音频" },
                                    ]}
                                />
                            </label>
                            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                                <span>模型 ID（从目录获取）</span>
                                {userId ? (
                                    <Select
                                        className="w-full"
                                        showSearch
                                        optionFilterProp="label"
                                        aria-label="可用模型"
                                        placeholder="此能力暂无可用模型"
                                        value={selected?.id}
                                        onChange={setModel}
                                        options={models.map((item) => ({ value: item.id, label: `${item.name || item.id}${item.limitation ? "（受限）" : ""}` }))}
                                    />
                                ) : (
                                    <Input aria-label="示例模型 ID" value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" spellCheck={false} />
                                )}
                            </label>
                        </div>
                        {selected && (
                            <>
                                <p>
                                    <code>{selected.id}</code>
                                    {selected.description && ` · ${selected.description}`}
                                </p>
                                {selected.outputTokenLimit !== undefined && <p>输出上限：{selected.outputTokenLimit} Token（沿用模型配置）</p>}
                                {selected.limitation && <Callout tone="warning">{selected.limitation}</Callout>}
                                <div className="api-docs-table">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>模型参数</th>
                                                <th>默认值</th>
                                                <th>允许值 / 范围</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(selected.parameters).map(([name, parameter]) => (
                                                <tr key={name}>
                                                    <td>
                                                        <code>{name}</code>
                                                        <div>
                                                            {parameter.type}
                                                            {parameter.required ? " · 必填" : " · 可选"}
                                                        </div>
                                                    </td>
                                                    <td>{parameter.default === undefined ? "未声明" : String(parameter.default)}</td>
                                                    <td>
                                                        {parameter.enum?.length
                                                            ? parameter.enum.map(String).join(" / ")
                                                            : [parameter.minimum !== undefined && `最小 ${parameter.minimum}`, parameter.maximum !== undefined && `最大 ${parameter.maximum}`, parameter.step !== undefined && `步长 ${parameter.step}`]
                                                                  .filter(Boolean)
                                                                  .join("，") || "未声明"}
                                                        {parameter.description && <p>{parameter.description}</p>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                        {(!userId || (selected && !selected.limitation)) &&
                            (example ? (
                                <CodeBlock title="curl · 采用所选模型声明的默认参数" language="bash">
                                    {example}
                                </CodeBlock>
                            ) : (
                                <Callout>该模型存在未声明默认值的必填参数，请根据上表填写这些参数后再创建调用。</Callout>
                            ))}
                        <CodeBlock title="202 · 受理示例">{JSON.stringify({ code: 0, data: { id: "CALL_ID", model: "MODEL_KEY", capability, status: "pending" }, msg: "ok" }, null, 2)}</CodeBlock>
                        <Callout title="受理成功后，继续查询原调用">202 表示任务已入队，尚未完成。响应的 Location 也指向查询地址。网络错误或查询超时后，不要直接重复创建，以免重复计费。</Callout>
                    </DocSection>

                    <DocSection id="parameters" title="请求参数" description="未知字段会被拒绝；模型的能力、规格和默认值仍以系统配置为准。">
                        <div className="api-docs-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>字段</th>
                                        <th>类型 / 能力</th>
                                        <th>说明</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parameters.map(([field, type, description]) => (
                                        <tr key={field}>
                                            <td>
                                                <code>{field}</code>
                                            </td>
                                            <td>{type}</td>
                                            <td>{description}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p>当前支持纯文本提示词和消息，不接收参考媒体、工具调用、任意供应商参数或 SSE 流式输出；不兼容 OpenAI 的 /v1/chat/completions 路径。需要参考图的模型会由能力校验拒绝。temperature、top_p 也不属于本接口参数。</p>
                    </DocSection>

                    <DocSection id="results" title="查询与下载" description="GET /model-calls/:id · 建议每 2–5 秒查询一次。">
                        <CodeBlock title="查询调用" language="bash">{`curl -sS '${root}/model-calls/CALL_ID' \\\n  -H "Authorization: Bearer $CANVAS_API_KEY"`}</CodeBlock>
                        <div className="api-docs-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>data.status</th>
                                        <th>含义</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        ["pending", "等待调度"],
                                        ["processing", "正在生成"],
                                        ["succeeded", "成功，读取 result"],
                                        ["failed", "失败，查看脱敏后的 reason"],
                                        ["cancelled", "已取消"],
                                    ].map(([status, label]) => (
                                        <tr key={status}>
                                            <td>
                                                <code>{status}</code>
                                            </td>
                                            <td>{label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <CodeBlock title="文本完成示例">
                            {JSON.stringify({ code: 0, data: { id: "CALL_ID", model: "MODEL_KEY", capability: "text", status: "succeeded", result: { text: `${brandName}是一个 AI 影视与短剧创作工作台。` } }, msg: "ok" }, null, 2)}
                        </CodeBlock>
                        <p>HTTP 200 表示查询成功，生成是否成功以 data.status 判断。文本结果可含 text、reasoning；媒体位于 images、videos、audios，包含资源 id、本站 url 和 mimeType。当前不保证返回 Token 用量。</p>
                        <CodeBlock title="媒体结果片段">{JSON.stringify({ images: [{ id: "RESOURCE_ID", url: "/api/model-calls/CALL_ID/media/RESOURCE_ID", mimeType: "image/png" }] }, null, 2)}</CodeBlock>
                        <CodeBlock title="下载产物" language="bash">{`curl -sS -L '${root}/model-calls/CALL_ID/media/RESOURCE_ID' \\\n  -H "Authorization: Bearer $CANVAS_API_KEY" -o result.png`}</CodeBlock>
                        <p>下载须携带当前账号的有效 Key。对象存储可能返回临时重定向；不要使用 --location-trusted，避免向其他域名发送本站 Key。下载接口支持 Range。</p>
                    </DocSection>

                    <DocSection id="errors" title="错误与限制" description="业务信封为 { code, data, msg, reason }，code 为 0 才表示请求成功。">
                        <div className="api-docs-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>HTTP</th>
                                        <th>含义</th>
                                        <th>处理方式</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {errors.map(([status, label, detail]) => (
                                        <tr key={status}>
                                            <td>
                                                <code>{status}</code>
                                            </td>
                                            <td>{label}</td>
                                            <td>{detail}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <CodeBlock title="鉴权失败示例">{JSON.stringify({ code: 401, data: null, msg: "API Key 无效", reason: "unauthorized" }, null, 2)}</CodeBlock>
                        <p>模型请求最多 1 MiB。任务创建速率、并发、容量和积分限制按账号共享；外部入口每 IP 每分钟 300 次，Key 创建每账号每小时 30 次。程序应判断 code、reason 和任务状态，不解析提示文案。</p>
                        <Callout title="密钥轮换">吊销或到期的 Key 无法继续使用，可换用同账号的有效 Key 查询和下载。已入队任务仍会执行和计费，吊销不会取消任务或退款。</Callout>
                        <a className="api-docs-link inline-flex items-center gap-2" href={`${root}/openapi.yaml`} target="_blank" rel="noreferrer">
                            <FileCode2 className="size-4" />
                            查看完整 OpenAPI 规范
                            <ArrowUpRight className="size-3" />
                        </a>
                    </DocSection>
                </article>
            </div>
        </main>
    );
}

function DocSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
    return (
        <section id={id} className="api-docs-section space-y-4">
            <header className="space-y-2">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            </header>
            {children}
        </section>
    );
}

function CodeBlock({ title, children, language = "json" }: { title: string; children: string; language?: DocumentationCodeLanguage }) {
    const { message } = App.useApp();
    const [highlighted, setHighlighted] = useState<{ code: string; language: string; html: string } | null>(null);
    useEffect(() => {
        let cancelled = false;
        void highlightCode(children, language)
            .then((html) => {
                if (!cancelled) setHighlighted({ code: children, language, html });
            })
            .catch(() => {
                if (!cancelled) setHighlighted(null);
            });
        return () => {
            cancelled = true;
        };
    }, [children, language]);
    const html = highlighted?.code === children && highlighted.language === language ? highlighted.html : null;
    return (
        <div className="api-docs-code overflow-hidden rounded-lg border border-border bg-surface-secondary">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <span className="text-xs text-muted-foreground">{title}</span>
                <Button
                    type="text"
                    size="small"
                    icon={<Copy className="size-3.5" />}
                    aria-label={`复制${title}`}
                    onClick={async () => {
                        try {
                            if (await copy(children)) message.success("已复制");
                            else message.error("复制失败，请手动选择代码复制");
                        } catch {
                            message.error("复制失败，请手动选择代码复制");
                        }
                    }}
                >
                    复制
                </Button>
            </div>
            {html ? (
                <div className="api-docs-highlight overflow-x-auto p-4 text-xs leading-relaxed" tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
                <pre className="overflow-x-auto p-4 text-xs leading-relaxed" tabIndex={0}>
                    <code>{children}</code>
                </pre>
            )}
        </div>
    );
}
