import { App, Button, Input, InputNumber, Select, Switch } from "antd";
import { MessageCircleMore } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getModelCatalog, listAdminLogicalModels, type AdminLogicalModel, type PublicChannelCatalog, type PublicChannelModel } from "@/services/api/logical-models";
import { getAdminYoru, saveAdminYoru } from "@/services/api/yoru";
import { AdminStatusBadge, SettingsSectionCard } from "./components/admin-ui";

type Setting = Awaited<ReturnType<typeof getAdminYoru>>;
type DirectOption = { channel: PublicChannelCatalog; model: PublicChannelModel };

const navigationChoices = ["图片生成", "视频生成", "灵感大厅", "自由画布", "Agent", "技能", "资产库", "创作历史", "积分中心"];

function modelPrice(model: PublicChannelModel) {
    const tier = model.priceTiers[0];
    if (!tier) return "无有效价格档";
    if (model.priceTiers.length > 1) return model.priceLabel || "按规格计费";
    const credits = (value: number) => `${Number((value / 1_000_000).toFixed(4))} 积分`;
    if (tier.billingMode === "token") return `输入 ${credits(tier.inputTokenPriceMicrocredits)}/百万 Token · 输出 ${credits(tier.outputTokenPriceMicrocredits)}/百万 Token`;
    return `${credits(tier.unitPriceMicrocredits)}/${tier.billingMode === "per_second" ? "秒" : "次"}`;
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
    return (
        <label className={`eac-field${wide ? " is-wide" : ""}`}>
            <span className="eac-field-label">{label}</span>
            {children}
            {hint ? <span className="eac-field-hint">{hint}</span> : null}
        </label>
    );
}

/**
 * 工作台右下角的创作助手（原“小夜”）。设置仍保存在 /admin/settings/yoru 接口；
 * 这里只负责编辑与保存，是否对用户开放问答由“功能开放”里的总开关决定。
 */
export function EcommerceAssistantSettings({ featureEnabled }: { featureEnabled?: boolean }) {
    const { message } = App.useApp();
    const [setting, setSetting] = useState<Setting | null>(null);
    const [saved, setSaved] = useState("");
    const [models, setModels] = useState<AdminLogicalModel[]>([]);
    const [channels, setChannels] = useState<PublicChannelCatalog[]>([]);
    const [loadError, setLoadError] = useState("");
    const [catalogError, setCatalogError] = useState("");
    const [routerError, setRouterError] = useState("");
    const [channelFilter, setChannelFilter] = useState("all");
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setLoadError("");
        void getAdminYoru()
            .then((value) => {
                if (cancelled) return;
                const next = { ...value, modelMode: value.modelMode || (value.logicalModelId ? "smart_route" : "direct") } as Setting;
                setSetting(next);
                setSaved(JSON.stringify(next));
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : "读取配置失败");
            });
        void getModelCatalog()
            .then((catalog) => {
                if (!cancelled) setChannels((catalog.channels || []).map((channel) => ({ ...channel, models: channel.models.filter((item) => item.capability === "text") })).filter((channel) => channel.models.length > 0));
            })
            .catch((error) => {
                if (!cancelled) setCatalogError(error instanceof Error ? error.message : "读取文本模型目录失败");
            });
        void listAdminLogicalModels()
            .then((routes) => {
                if (!cancelled) setModels(routes.models.filter((item) => item.capability === "text" && item.enabled));
            })
            .catch((error) => {
                if (!cancelled) setRouterError(error instanceof Error ? error.message : "读取智能路由列表失败");
            });
        return () => {
            cancelled = true;
        };
    }, [reload]);
    const dirty = Boolean(setting) && JSON.stringify(setting) !== saved;
    const change = <K extends keyof Setting>(key: K, value: Setting[K]) => setSetting((current) => (current ? { ...current, [key]: value } : current));
    const save = async () => {
        if (!setting) return;
        if (setting.enabled && (setting.modelMode === "direct" ? !setting.channelModelId : !setting.logicalModelId)) {
            message.error(setting.modelMode === "direct" ? "启用前请先选择对话模型" : "启用前请先选择已启用的智能路由");
            return;
        }
        setSaving(true);
        try {
            const next = await saveAdminYoru({
                ...setting,
                questions: setting.questions
                    .map((text) => text.trim())
                    .filter(Boolean)
                    .slice(0, 8),
            });
            setSetting(next);
            setSaved(JSON.stringify(next));
            message.success("创作助手设置已保存，立即生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };
    const directModels: DirectOption[] = channels.flatMap((channel) => channel.models.map((model) => ({ channel, model })));
    const selectedDirect = directModels.find((item) => item.model.id === setting?.channelModelId);
    const directOptions = channels
        .filter((channel) => channelFilter === "all" || channel.id === channelFilter)
        .map((channel) => ({
            label: channel.name || channel.displayName || "系统渠道",
            options: channel.models.map((model) => ({ value: model.id, label: `${model.displayName} · ${model.modelKey} · ${modelPrice(model)}`, disabled: !model.available })),
        }));
    const status = !setting
        ? undefined
        : !setting.enabled
          ? { label: "已停用", tone: "neutral" as const }
          : featureEnabled === false
            ? { label: "已配置 · 问答未开放", tone: "warning" as const }
            : { label: setting.audience === "all" ? "所有用户可用" : "仅管理员可用", tone: "success" as const };

    return (
        <SettingsSectionCard
            className="eac-section"
            layout="stacked"
            icon={<MessageCircleMore className="size-4" aria-hidden="true" />}
            title="创作助手"
            description="工作台页面右下角回答使用问题的 AI 助手（后台与画布页面不显示）。每轮对话按所选文本模型价格扣用户积分。"
            status={status ? <AdminStatusBadge label={status.label} tone={status.tone} /> : undefined}
            footer={
                setting ? (
                    <>
                        <span className="eac-save-state">{dirty ? "有未保存的修改" : "已保存"}</span>
                        <div className="eac-save-actions">
                            {dirty ? (
                                <Button disabled={saving} onClick={() => setSetting(JSON.parse(saved) as Setting)}>
                                    撤销修改
                                </Button>
                            ) : null}
                            <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
                                保存创作助手
                            </Button>
                        </div>
                    </>
                ) : undefined
            }
        >
            {!setting ? (
                <div className="eac-placeholder" role={loadError ? "alert" : "status"}>
                    {loadError ? (
                        <>
                            <span>读取创作助手设置失败：{loadError}</span>
                            <Button size="small" onClick={() => setReload((value) => value + 1)}>
                                重试
                            </Button>
                        </>
                    ) : (
                        "正在读取设置…"
                    )}
                </div>
            ) : (
                <div className="eac-groups">
                    <section className="eac-group" aria-label="开放与外观">
                        <header>
                            <h3>开放与外观</h3>
                            <p>先给管理员验收，确认回答质量后再开放给所有用户。</p>
                        </header>
                        <div className="eac-switch-row">
                            <div>
                                <strong>启用创作助手</strong>
                                <span>关闭后不显示入口，也不会发起模型调用。</span>
                            </div>
                            <Switch checked={setting.enabled} onChange={(value) => change("enabled", value)} aria-label="启用创作助手" />
                        </div>
                        <div className="eac-grid">
                            <Field label="开放范围">
                                <Select
                                    value={setting.audience || "admin"}
                                    options={[
                                        { value: "admin", label: "仅管理员验收" },
                                        { value: "all", label: "所有已登录用户" },
                                    ]}
                                    onChange={(value) => change("audience", value)}
                                />
                            </Field>
                            <Field label="助手名称">
                                <Input value={setting.name} maxLength={40} placeholder="例如：创作助手" onChange={(event) => change("name", event.target.value)} />
                            </Field>
                            <Field label="欢迎语" wide>
                                <Input.TextArea value={setting.welcome} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} onChange={(event) => change("welcome", event.target.value)} />
                            </Field>
                        </div>
                        <div className="eac-grid is-compact">
                            <Field label="形象高度" hint="像素，100–240">
                                <InputNumber min={100} max={240} value={setting.avatarSize} onChange={(value) => change("avatarSize", value ?? 180)} />
                            </Field>
                            <Field label="距右侧" hint="像素">
                                <InputNumber min={0} max={200} value={setting.defaultRight} onChange={(value) => change("defaultRight", value ?? 16)} />
                            </Field>
                            <Field label="距底部" hint="像素">
                                <InputNumber min={0} max={200} value={setting.defaultBottom} onChange={(value) => change("defaultBottom", value ?? 24)} />
                            </Field>
                            <div className="eac-switch-inline">
                                <span className="eac-field-label">形象动效</span>
                                <Switch checked={setting.motionEnabled} onChange={(value) => change("motionEnabled", value)} aria-label="启用形象动效" />
                            </div>
                        </div>
                    </section>

                    <section className="eac-group" aria-label="对话模型与计费">
                        <header>
                            <h3>对话模型与计费</h3>
                            <p>沿用文本模型的现有价格；每轮先按价格预留积分，余额不足时不发起调用。</p>
                        </header>
                        <div className="eac-grid">
                            <Field label="模型来源">
                                <Select
                                    value={setting.modelMode}
                                    options={[
                                        { value: "direct", label: "固定文本模型" },
                                        { value: "smart_route", label: "智能路由" },
                                    ]}
                                    onChange={(value) => change("modelMode", value)}
                                />
                            </Field>
                            <Field label="单次回复上限" hint="Token，128–4096">
                                <InputNumber min={128} max={4096} value={setting.maxOutputTokens} onChange={(value) => change("maxOutputTokens", value ?? 1024)} />
                            </Field>
                            {setting.modelMode === "direct" ? (
                                <>
                                    <Field label="渠道">
                                        <Select
                                            value={channelFilter}
                                            options={[{ value: "all", label: "全部渠道" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name || channel.displayName || channel.id }))]}
                                            onChange={setChannelFilter}
                                        />
                                    </Field>
                                    <Field
                                        label="对话模型"
                                        hint={
                                            selectedDirect
                                                ? `${selectedDirect.model.available ? "可用" : "不可用：无有效价格档"} · ${modelPrice(selectedDirect.model)} · 近 24 小时成功率 ${
                                                      selectedDirect.model.availability?.dataState === "ready" && selectedDirect.model.availability.rate24h !== null ? `${Math.round(selectedDirect.model.availability.rate24h * 100)}%` : "样本不足"
                                                  }`
                                                : `当前有 ${directModels.filter((item) => item.model.available).length} 个可选文本模型`
                                        }
                                    >
                                        <Select showSearch optionFilterProp="label" value={setting.channelModelId || undefined} placeholder="搜索文本模型" options={directOptions} onChange={(value) => change("channelModelId", value)} />
                                    </Field>
                                </>
                            ) : (
                                <Field label="智能路由" wide hint={routerError ? `智能路由列表暂不可用：${routerError}` : undefined}>
                                    <Select
                                        showSearch
                                        optionFilterProp="label"
                                        value={setting.logicalModelId || undefined}
                                        placeholder="选择已启用的文本智能路由"
                                        options={models.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))}
                                        onChange={(value) => change("logicalModelId", value)}
                                    />
                                </Field>
                            )}
                        </div>
                        {catalogError && setting.modelMode === "direct" ? (
                            <p className="eac-inline-error" role="alert">
                                读取文本模型目录失败：{catalogError}
                            </p>
                        ) : null}
                    </section>

                    <section className="eac-group" aria-label="回答知识与引导">
                        <header>
                            <h3>回答知识与引导</h3>
                            <p>助手只依据这里的说明和知识回答；快捷导航只能指向站内真实页面，不会生成管理操作入口。</p>
                        </header>
                        <div className="eac-grid">
                            <Field label="系统说明" wide>
                                <Input.TextArea value={setting.systemPrompt} autoSize={{ minRows: 3, maxRows: 8 }} maxLength={8000} onChange={(event) => change("systemPrompt", event.target.value)} />
                            </Field>
                            <Field label="网站功能知识" wide hint={`${setting.knowledge.length} / 24000 字`}>
                                <Input.TextArea value={setting.knowledge} autoSize={{ minRows: 6, maxRows: 16 }} maxLength={24000} onChange={(event) => change("knowledge", event.target.value)} />
                            </Field>
                            <Field label="推荐问题" hint="每行一个，最多 8 个">
                                <Input.TextArea value={setting.questions.join("\n")} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => change("questions", event.target.value.split("\n").slice(0, 8))} />
                            </Field>
                            <Field label="快捷导航">
                                <Select mode="multiple" value={setting.navigation} options={navigationChoices.map((value) => ({ value, label: value }))} onChange={(value) => change("navigation", value)} />
                            </Field>
                        </div>
                    </section>
                </div>
            )}
        </SettingsSectionCard>
    );
}
