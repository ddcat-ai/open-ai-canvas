import { App, Button, Checkbox, Input, InputNumber, Spin } from "antd";
import { ArrowLeft, Check, ExternalLink, Gift, RefreshCw, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AdminModal } from "@/pages/admin/ui/overlays";
import {
    getProviderCatalog,
    installProviderCatalog,
    refreshProviderCatalog,
    verifyProviderCatalogKey,
    type ProviderCatalogModel,
    type ProviderCatalogProvider,
    type ProviderCatalogVerifyResult,
    type ProviderCatalogView,
} from "@/services/api/provider-catalog";
import type { ModelChannel } from "@/stores/use-config-store";
import { formatCredits, formatWindow, promotionExpiry, matchesProvider, tierPriceLines, tierSpecLabel, validMarkup } from "./provider-catalog-pricing";
import "./provider-catalog-wizard.css";

type Step = "pick" | "connect" | "pricing";

const capabilityLabels: Record<ProviderCatalogModel["capability"], string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };
const stepLabels: Array<{ key: Step; label: string }> = [
    { key: "pick", label: "选择服务商" },
    { key: "connect", label: "填写 Key" },
    { key: "pricing", label: "模型与定价" },
];

type Props = {
    open: boolean;
    onClose: () => void;
    onCustom: () => void;
    onInstalled: (channel: ModelChannel) => void | Promise<void>;
};

export function ProviderCatalogWizard({ open, onClose, onCustom, onInstalled }: Props) {
    const { message } = App.useApp();
    const [step, setStep] = useState<Step>("pick");
    const [catalog, setCatalog] = useState<ProviderCatalogView | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [keyword, setKeyword] = useState("");
    const [tag, setTag] = useState("");
    const [provider, setProvider] = useState<ProviderCatalogProvider | null>(null);
    const [name, setName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [verified, setVerified] = useState<ProviderCatalogVerifyResult | null>(null);
    const [markup, setMarkup] = useState<number | null>(30);
    const [overrides, setOverrides] = useState<Record<string, number | null>>({});
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [installing, setInstalling] = useState(false);

    const load = async (refresh = false) => {
        setLoading(true);
        setLoadError("");
        try {
            setCatalog(await (refresh ? refreshProviderCatalog() : getProviderCatalog()));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取服务商目录失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setStep("pick");
        setProvider(null);
        setKeyword("");
        setTag("");
        void load();
    }, [open]);

    const visibleProviders = useMemo(() => (catalog?.providers || []).filter((item) => (!tag || item.tags.includes(tag)) && matchesProvider(item, keyword)), [catalog, tag, keyword]);
    const tagLookup = useMemo(() => new Map((catalog?.tags || []).map((item) => [item.id, item])), [catalog]);
    const usedTags = useMemo(() => (catalog?.tags || []).filter((item) => catalog?.providers.some((p) => p.tags.includes(item.id))), [catalog]);

    const choose = (next: ProviderCatalogProvider) => {
        setProvider(next);
        setName(next.name);
        setApiKey("");
        setVerified(null);
        setVerifyError("");
        setOverrides({});
        setSelected(Object.fromEntries(next.models.map((item) => [item.modelKey, item.supported])));
        setStep("connect");
    };

    const keyHint = useMemo(() => {
        if (!provider?.keyGuide.keyPattern || !apiKey.trim()) return null;
        try {
            return new RegExp(provider.keyGuide.keyPattern).test(apiKey.trim());
        } catch {
            return null;
        }
    }, [provider, apiKey]);

    const verify = async (skip: boolean) => {
        if (!provider) return;
        if (!apiKey.trim()) {
            setVerifyError("请填写 API Key");
            return;
        }
        if (skip) {
            setVerified(null);
            setStep("pricing");
            return;
        }
        setVerifying(true);
        setVerifyError("");
        try {
            const result = await verifyProviderCatalogKey(provider.id, apiKey.trim());
            setVerified(result);
            setSelected((current) => Object.fromEntries(provider.models.map((item) => [item.modelKey, Boolean(current[item.modelKey]) && item.supported && !result.missingModels.includes(item.modelKey)])));
            setStep("pricing");
        } catch (error) {
            setVerifyError(error instanceof Error ? error.message : "验证失败，请检查 Key");
        } finally {
            setVerifying(false);
        }
    };

    const chosenModels = provider ? provider.models.filter((item) => selected[item.modelKey]) : [];
    const overridesValid = chosenModels.every((item) => overrides[item.modelKey] === undefined || overrides[item.modelKey] === null || validMarkup(overrides[item.modelKey]));
    const canInstall = Boolean(provider && chosenModels.length && validMarkup(markup) && overridesValid && name.trim() && apiKey.trim());

    const install = async () => {
        if (!provider || !canInstall || markup === null) return;
        setInstalling(true);
        try {
            const { channel } = await installProviderCatalog(provider.id, {
                name: name.trim(),
                apiKey: apiKey.trim(),
                markupPercent: markup,
                models: chosenModels.map((item) => ({ modelKey: item.modelKey, markupPercent: overrides[item.modelKey] ?? null })),
                // 跳过验证时先停用，避免未确认可用的渠道进入线上路由。
                enabled: verified !== null,
            });
            message.success(`已接入 ${provider.name}，${chosenModels.length} 个模型${verified ? "已上线" : "已创建（渠道默认停用）"}`);
            await onInstalled(channel);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "一键接入失败");
        } finally {
            setInstalling(false);
        }
    };

    const stepIndex = stepLabels.findIndex((item) => item.key === step);

    return (
        <AdminModal flush open={open} width={1080} onCancel={() => !installing && onClose()} footer={null} title={null} rootClassName="pcw-root" mask={{ closable: !installing }}>
            <div className="pcw">
                <header className="pcw-header">
                    <div className="pcw-title-row">
                        {step !== "pick" ? <Button type="text" size="small" aria-label="上一步" icon={<ArrowLeft className="size-4" />} disabled={installing || verifying} onClick={() => setStep(step === "pricing" ? "connect" : "pick")} /> : null}
                        <h2 className="pcw-title">新增系统渠道</h2>
                    </div>
                    <ol className="pcw-steps" aria-label="接入步骤">
                        {stepLabels.map((item, index) => (
                            <li key={item.key} className="pcw-step" data-state={index < stepIndex ? "done" : index === stepIndex ? "current" : "todo"} aria-current={index === stepIndex ? "step" : undefined}>
                                <span className="pcw-step-dot">{index < stepIndex ? <Check className="size-3" /> : index + 1}</span>
                                {item.label}
                            </li>
                        ))}
                    </ol>
                </header>
                {step === "pick" ? renderPick() : null}
                {step === "connect" && provider ? renderConnect(provider) : null}
                {step === "pricing" && provider ? renderPricing(provider) : null}
            </div>
        </AdminModal>
    );

    function renderPick() {
        const sourceText = catalog?.source === "cache" ? "离线目录" : catalog?.source === "unavailable" ? "目录暂不可用" : catalog?.source === "disabled" ? "目录已关闭" : "目录";
        return (
            <div className="pcw-body">
                <div className="pcw-toolbar">
                    <Input
                        size="large"
                        allowClear
                        autoFocus
                        prefix={<Search className="size-4 text-foreground/40" />}
                        placeholder="搜索服务商、模型或网址，例如 seedance、sora、kimi"
                        aria-label="搜索服务商"
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                    />
                    <span className="pcw-source" title={catalog?.fetchedAt ? `同步于 ${new Date(catalog.fetchedAt).toLocaleString("zh-CN")}` : undefined}>
                        {sourceText}
                        {catalog?.updatedAt ? ` · 更新于 ${catalog.updatedAt.slice(5, 10)}` : ""}
                        <Button type="text" size="small" aria-label="刷新目录" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load(true)} />
                    </span>
                </div>
                {usedTags.length ? (
                    <div className="pcw-tags" role="group" aria-label="按标签筛选">
                        <button type="button" className="pcw-tag-filter" aria-pressed={!tag} onClick={() => setTag("")}>
                            全部 <span>{catalog?.providers.length || 0}</span>
                        </button>
                        {usedTags.map((item) => (
                            <button type="button" key={item.id} className="pcw-tag-filter" aria-pressed={tag === item.id} onClick={() => setTag(tag === item.id ? "" : item.id)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="pcw-scroll">
                    {loadError ? (
                        <p className="pcw-notice" role="alert">
                            <TriangleAlert className="size-4" /> {loadError}
                        </p>
                    ) : null}
                    {catalog && (catalog.source === "unavailable" || catalog.source === "disabled") ? <p className="pcw-notice">{catalog.notice || "暂时无法获取推荐服务商，可以先用自定义配置手动添加。"}</p> : null}
                    <div className="pcw-grid">
                        <button type="button" className="pcw-card pcw-card-custom" onClick={onCustom}>
                            <span className="pcw-logo pcw-logo-custom">
                                <SlidersHorizontal className="size-5" />
                            </span>
                            <span className="pcw-card-main">
                                <span className="pcw-card-name">自定义配置</span>
                                <span className="pcw-card-summary">手动填写 Base URL 和 API Key</span>
                            </span>
                        </button>
                        {visibleProviders.map((item) => (
                            <button type="button" key={item.id} className="pcw-card" onClick={() => choose(item)}>
                                <span className="pcw-card-top">
                                    <ProviderLogo provider={item} />
                                    <span className="pcw-card-main">
                                        <span className="pcw-card-name">{item.name}</span>
                                        <span className="pcw-card-summary">{item.summary || hostOf(item.baseUrl)}</span>
                                    </span>
                                </span>
                                <span className="pcw-card-tags">
                                    {item.tags.map((id) => (
                                        <span key={id} className="pcw-chip" data-tone={tagLookup.get(id)?.tone || "neutral"}>
                                            {tagLookup.get(id)?.label || id}
                                        </span>
                                    ))}
                                </span>
                                <span className="pcw-card-meta">
                                    <span>{item.models.length} 个推荐模型</span>
                                    {item.installedCount ? (
                                        <span className="pcw-installed">
                                            <Check className="size-3" /> 已接入 {item.installedCount}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="pcw-card-summary" title={item.models.map((model) => model.providerModelKey).join("、")}>
                                    推荐：{item.models.map((model) => (model.displayName === model.providerModelKey ? model.displayName : `${model.displayName} / ${model.providerModelKey}`)).join("、")}
                                </span>
                                <span className="pcw-card-window">
                                    <span>{item.permanent ? formatWindow(item) : `推广期 · ${formatWindow(item)}`}</span>
                                    <span className="block mt-1">{promotionExpiry(item)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                    {loading && !catalog ? (
                        <div className="pcw-loading" role="status" aria-label="正在加载服务商目录">
                            <Spin />
                        </div>
                    ) : null}
                    {catalog && catalog.providers.length > 0 && !visibleProviders.length ? <p className="pcw-notice">没有匹配的服务商，换个关键词试试。</p> : null}
                </div>
            </div>
        );
    }

    function renderConnect(current: ProviderCatalogProvider) {
        const guide = current.keyGuide;
        return (
            <div className="pcw-body pcw-split">
                <section className="pcw-form" aria-label={`连接 ${current.name}`}>
                    <div className="pcw-provider-head">
                        <ProviderLogo provider={current} />
                        <div className="min-w-0">
                            <div className="pcw-card-name">{current.name}</div>
                            <div className="pcw-card-window">{current.permanent ? formatWindow(current) : `推广期 · ${formatWindow(current)}`}</div>
                        </div>
                    </div>
                    <label className="pcw-field">
                        <span>渠道名称</span>
                        <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="pcw-field">
                        <span>API Key</span>
                        <Input.Password
                            autoFocus
                            autoComplete="new-password"
                            value={apiKey}
                            placeholder="粘贴从服务商控制台复制的密钥"
                            onChange={(event) => {
                                setApiKey(event.target.value);
                                setVerifyError("");
                            }}
                            onPressEnter={() => void verify(false)}
                        />
                        {keyHint === true ? (
                            <em className="pcw-hint" data-tone="success">
                                格式正确
                            </em>
                        ) : null}
                        {keyHint === false ? (
                            <em className="pcw-hint" data-tone="warning">
                                格式与该服务商常见密钥不同，请确认是否复制完整
                            </em>
                        ) : null}
                    </label>
                    <div className="pcw-readonly">
                        <span>Base URL</span>
                        <code>{current.baseUrl}</code>
                    </div>
                    {verifyError ? (
                        <div className="pcw-notice pcw-notice-error" role="alert">
                            <TriangleAlert className="size-4" />
                            <span>{verifyError}</span>
                        </div>
                    ) : null}
                    <div className="pcw-actions">
                        {verifyError ? (
                            <Button disabled={verifying || !apiKey.trim()} onClick={() => void verify(true)}>
                                跳过验证继续
                            </Button>
                        ) : null}
                        <Button type="primary" loading={verifying} disabled={!apiKey.trim() || !name.trim()} onClick={() => void verify(false)}>
                            验证并继续
                        </Button>
                    </div>
                    {verifyError ? <p className="pcw-footnote">跳过验证创建的渠道默认停用，确认可用后再手动启用。</p> : null}
                </section>
                <aside className="pcw-guide" aria-label="获取 API Key">
                    <h3>获取 API Key</h3>
                    {guide.steps.length ? (
                        <ol>
                            {guide.steps.map((stepText, index) => (
                                <li key={index}>
                                    <span>{index + 1}</span>
                                    {stepText}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="pcw-footnote">在服务商控制台创建 API Key 后粘贴到左侧。</p>
                    )}
                    {guide.promo ? (
                        <p className="pcw-promo">
                            <Gift className="size-4" /> {guide.promo}
                        </p>
                    ) : null}
                    {guide.url || current.website ? (
                        <Button block href={guide.url || current.website} target="_blank" rel="noopener noreferrer" icon={<ExternalLink className="size-4" />}>
                            前往 {current.name} 获取 Key
                        </Button>
                    ) : null}
                </aside>
            </div>
        );
    }

    function renderPricing(current: ProviderCatalogProvider) {
        const totalTiers = chosenModels.reduce((sum, item) => sum + item.priceTiers.length, 0);
        return (
            <div className="pcw-body">
                <div className="pcw-pricing-bar">
                    <label className="pcw-markup">
                        <span>统一加价</span>
                        <InputNumber aria-label="统一加价率" value={markup} min={0} max={1000} step={5} precision={2} suffix="%" status={validMarkup(markup) ? undefined : "error"} onChange={(value) => setMarkup(value)} />
                    </label>
                    <span className="pcw-formula">售价 = 成本 × (1 + 加价率) · 1 元 = 1 积分</span>
                    {verified ? (
                        <span className="pcw-verified">
                            <Check className="size-3.5" /> 连接成功 · 上游可用 {verified.availableModels.length}/{current.models.length} 个推荐模型
                        </span>
                    ) : (
                        <span className="pcw-unverified">未验证 · 渠道将默认停用</span>
                    )}
                </div>
                <div className="pcw-scroll">
                    <ul className="pcw-models">
                        {current.models.map((item) => {
                            const missing = verified?.missingModels.includes(item.modelKey);
                            const disabledReason = !item.supported ? item.unsupportedReason || "当前版本不支持" : missing ? "上游未返回该模型" : "";
                            const override = overrides[item.modelKey];
                            const effective = override ?? markup ?? 0;
                            const checked = Boolean(selected[item.modelKey]);
                            return (
                                <li key={item.modelKey} className="pcw-model" data-disabled={Boolean(disabledReason) || undefined} data-checked={checked || undefined}>
                                    <div className="pcw-model-head">
                                        <Checkbox checked={checked} disabled={Boolean(disabledReason) && !checked} onChange={(event) => setSelected((state) => ({ ...state, [item.modelKey]: event.target.checked }))}>
                                            <span className="pcw-model-name">{item.displayName}</span>
                                        </Checkbox>
                                        <span className="pcw-chip" data-tone="neutral">
                                            {capabilityLabels[item.capability]}
                                        </span>
                                        <code className="pcw-model-key">{item.providerModelKey}</code>
                                        <span className="flex-1" />
                                        {disabledReason ? (
                                            <span className="pcw-model-reason">{disabledReason}</span>
                                        ) : (
                                            <label className="pcw-override">
                                                <span>加价</span>
                                                <InputNumber
                                                    size="small"
                                                    aria-label={`${item.displayName} 单独加价率`}
                                                    value={override ?? null}
                                                    placeholder={markup === null ? "" : String(markup)}
                                                    min={0}
                                                    max={1000}
                                                    precision={2}
                                                    suffix="%"
                                                    disabled={!checked}
                                                    onChange={(value) => setOverrides((state) => ({ ...state, [item.modelKey]: value }))}
                                                />
                                            </label>
                                        )}
                                    </div>
                                    {item.description ? <p className="pcw-model-desc">{item.description}</p> : null}
                                    <table className="pcw-tiers">
                                        <thead>
                                            <tr>
                                                <th scope="col">规格</th>
                                                <th scope="col">计价</th>
                                                <th scope="col">成本（积分）</th>
                                                <th scope="col">售价（积分）</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {item.priceTiers.flatMap((tier, tierIndex) =>
                                                tierPriceLines(item.capability, tier, effective).map((line, lineIndex) => (
                                                    <tr key={`${tierIndex}-${lineIndex}`}>
                                                        <td>{lineIndex === 0 ? tierSpecLabel(tier) : ""}</td>
                                                        <td>{line.label}</td>
                                                        <td>{formatCredits(line.cost)}</td>
                                                        <td className="pcw-sale">{formatCredits(line.sale)}</td>
                                                    </tr>
                                                )),
                                            )}
                                        </tbody>
                                    </table>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <footer className="pcw-footer">
                    <span>
                        将创建：1 个渠道 · {chosenModels.length} 个模型 · {totalTiers} 个规格档
                    </span>
                    <div className="pcw-actions">
                        <Button disabled={installing} onClick={() => setStep("connect")}>
                            上一步
                        </Button>
                        <Button type="primary" loading={installing} disabled={!canInstall} onClick={() => void install()}>
                            一键接入
                        </Button>
                    </div>
                </footer>
            </div>
        );
    }
}

function hostOf(url: string) {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function ProviderLogo({ provider }: { provider: Pick<ProviderCatalogProvider, "logo" | "name"> }) {
    const [failed, setFailed] = useState(false);
    if (!provider.logo || failed) {
        return (
            <span className="pcw-logo" aria-hidden="true">
                {provider.name.slice(0, 1).toUpperCase()}
            </span>
        );
    }
    return (
        <span className="pcw-logo" aria-hidden="true">
            <img src={provider.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </span>
    );
}
