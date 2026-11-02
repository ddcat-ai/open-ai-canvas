import { App, Button, Input, InputNumber, Select, Switch } from "antd";
import { useEffect, useState } from "react";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { getModelCatalog, listAdminLogicalModels, type AdminLogicalModel, type PublicChannelCatalog, type PublicChannelModel } from "@/services/api/logical-models";
import { getAdminYoru, saveAdminYoru } from "@/services/api/yoru";

type Setting = Awaited<ReturnType<typeof getAdminYoru>>;
type DirectOption = { channel: PublicChannelCatalog; model: PublicChannelModel };

function modelPrice(model: PublicChannelModel) {
    const tier = model.priceTiers[0];
    if (!tier) return "无有效价格档";
    if (model.priceTiers.length > 1) return model.priceLabel || "按规格计费";
    const credits = (value: number) => `${Number((value / 1_000_000).toFixed(4))} 积分`;
    if (tier.billingMode === "token") return `输入 ${credits(tier.inputTokenPriceMicrocredits)}/百万 Token · 输出 ${credits(tier.outputTokenPriceMicrocredits)}/百万 Token`;
    return `${credits(tier.unitPriceMicrocredits)}/${tier.billingMode === "per_second" ? "秒" : "次"}`;
}

export default function YoruSettingsPage() {
    const { message } = App.useApp();
    const [setting, setSetting] = useState<Setting | null>(null);
    const [models, setModels] = useState<AdminLogicalModel[]>([]);
    const [channels, setChannels] = useState<PublicChannelCatalog[]>([]);
    const [loadError, setLoadError] = useState("");
    const [catalogError, setCatalogError] = useState("");
    const [routerError, setRouterError] = useState("");
    const [channelFilter, setChannelFilter] = useState("all");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void getAdminYoru()
            .then((value) => {
                if (!cancelled) setSetting({ ...value, modelMode: value.modelMode || (value.logicalModelId ? "smart_route" : "direct") });
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
    }, [message]);
    const change = <K extends keyof Setting>(key: K, value: Setting[K]) => setSetting((current) => (current ? { ...current, [key]: value } : current));
    const save = async () => {
        if (!setting) return;
        if (setting.enabled && (setting.modelMode === "direct" ? !setting.channelModelId : !setting.logicalModelId)) {
            message.error(setting.modelMode === "direct" ? "请先选择现有文本渠道模型" : "请先选择已启用的智能路由组");
            return;
        }
        setSaving(true);
        try {
            setSetting(await saveAdminYoru(setting));
            message.success("小夜配置已保存，无需重新发布网站");
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
    return (
        <AdminPageFrame
            title="AI 虚拟助手 · 小夜"
            description="原创分层动态角色与站内智能帮助。模型调用沿用现有积分账本。"
            scroll
            actions={
                <Button type="primary" loading={saving} onClick={() => void save()} disabled={!setting}>
                    保存设置
                </Button>
            }
        >
            {!setting ? (
                <p>
                    {loadError ? (
                        <>
                            读取小夜配置失败：{loadError} <Button onClick={() => window.location.reload()}>重试</Button>
                        </>
                    ) : (
                        "正在读取配置…"
                    )}
                </p>
            ) : (
                <div style={{ display: "grid", gap: 20, maxWidth: 800, paddingBottom: 50 }}>
                    <section className="admin-card" style={{ display: "grid", gap: 13, padding: 20 }}>
                        <h3>发布与角色</h3>
                        <label>
                            全局启用 <Switch checked={setting.enabled} onChange={(value) => change("enabled", value)} />
                        </label>
                        <label>
                            开放范围{" "}
                            <Select
                                style={{ display: "block", marginTop: 7 }}
                                value={setting.audience || "admin"}
                                options={[
                                    { value: "admin", label: "仅管理员验收" },
                                    { value: "all", label: "所有已登录用户" },
                                ]}
                                onChange={(value) => change("audience", value)}
                            />
                        </label>
                        <label>
                            角色名称 <Input value={setting.name} maxLength={40} onChange={(event) => change("name", event.target.value)} />
                        </label>
                        <label>
                            欢迎语 <Input.TextArea value={setting.welcome} rows={2} maxLength={500} onChange={(event) => change("welcome", event.target.value)} />
                        </label>
                        <label>
                            默认角色高度（像素） <InputNumber min={100} max={240} value={setting.avatarSize} onChange={(value) => change("avatarSize", value ?? 180)} />
                        </label>
                        <label>
                            默认距右侧（像素） <InputNumber min={0} max={200} value={setting.defaultRight} onChange={(value) => change("defaultRight", value ?? 16)} />
                        </label>
                        <label>
                            默认距底部（像素） <InputNumber min={0} max={200} value={setting.defaultBottom} onChange={(value) => change("defaultBottom", value ?? 24)} />
                        </label>
                        <label>
                            启用动作 <Switch checked={setting.motionEnabled} onChange={(value) => change("motionEnabled", value)} />
                        </label>
                        <p>当前素材为原创透明 PNG 分层动画，并非 Cubism Live2D 模型。开放范围由上方设置控制；游客不能发起模型对话。</p>
                    </section>
                    <section className="admin-card" style={{ display: "grid", gap: 13, padding: 20 }}>
                        <h3>模型与积分计费</h3>
                        <label>
                            聊天模型模式{" "}
                            <Select
                                style={{ display: "block", marginTop: 7 }}
                                value={setting.modelMode}
                                options={[
                                    { value: "direct", label: "固定文本模型 / 渠道（与普通文本对话相同）" },
                                    { value: "smart_route", label: "智能路由逻辑模型" },
                                ]}
                                onChange={(value) => change("modelMode", value)}
                            />
                        </label>
                        {setting.modelMode === "direct" ? (
                            <>
                                {catalogError && <p role="alert">读取现有文本模型目录失败：{catalogError}。请刷新页面重试。</p>}
                                <label>
                                    渠道筛选{" "}
                                    <Select
                                        style={{ display: "block", marginTop: 7 }}
                                        value={channelFilter}
                                        options={[{ value: "all", label: "全部渠道" }, ...channels.map((channel) => ({ value: channel.id, label: channel.name || channel.displayName || channel.id }))]}
                                        onChange={setChannelFilter}
                                    />
                                </label>
                                <label>
                                    聊天模型{" "}
                                    <Select
                                        showSearch
                                        optionFilterProp="label"
                                        style={{ display: "block", marginTop: 7 }}
                                        value={setting.channelModelId || undefined}
                                        placeholder="搜索现有文本模型或版本"
                                        options={directOptions}
                                        onChange={(value) => change("channelModelId", value)}
                                    />
                                </label>
                                {selectedDirect ? (
                                    <p>
                                        渠道：{selectedDirect.channel.name || selectedDirect.channel.displayName} · 模型版本：{selectedDirect.model.modelKey} · {selectedDirect.model.available ? "已启用且有有效价格档" : "不可用：无有效价格档"}
                                        <br />
                                        价格：{modelPrice(selectedDirect.model)}
                                        <br />近 24 小时调用健康：
                                        {selectedDirect.model.availability?.dataState === "ready" && selectedDirect.model.availability.rate24h !== null ? `${Math.round(selectedDirect.model.availability.rate24h * 100)}%` : "样本不足，不能据此断言上游故障"}
                                    </p>
                                ) : (
                                    <p>当前目录有 {directModels.filter((item) => item.model.available).length} 个可选择的文本渠道模型。停用的渠道和模型不会进入公开目录。</p>
                                )}
                            </>
                        ) : (
                            <>
                                {routerError && <p role="alert">智能路由列表暂不可用：{routerError}。固定文本模型模式仍可使用。</p>}
                                <label>
                                    智能路由逻辑模型{" "}
                                    <Select
                                        showSearch
                                        optionFilterProp="label"
                                        style={{ display: "block", marginTop: 7 }}
                                        value={setting.logicalModelId || undefined}
                                        placeholder="请选择已启用的文本逻辑模型"
                                        options={models.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))}
                                        onChange={(value) => change("logicalModelId", value)}
                                    />
                                </label>
                            </>
                        )}
                        <label>
                            单次回复最长 Token <InputNumber min={128} max={4096} value={setting.maxOutputTokens} onChange={(value) => change("maxOutputTokens", value ?? 1024)} />
                        </label>
                        <p>小夜不设专属的每日次数或积分上限。每轮对话按所选文本模型的现有价格从当前用户积分中预留、结算；余额不足时不会创建收费任务。平台原有的防刷频率限制仍生效。</p>
                    </section>
                    <section className="admin-card" style={{ display: "grid", gap: 13, padding: 20 }}>
                        <h3>知识与引导</h3>
                        <label>
                            系统说明 <Input.TextArea value={setting.systemPrompt} rows={4} maxLength={8000} onChange={(event) => change("systemPrompt", event.target.value)} />
                        </label>
                        <label>
                            网站功能知识库 <Input.TextArea value={setting.knowledge} rows={8} maxLength={24000} onChange={(event) => change("knowledge", event.target.value)} />
                        </label>
                        <label>
                            推荐问题（每行一个，最多 8 个）{" "}
                            <Input.TextArea
                                value={setting.questions.join("\n")}
                                rows={4}
                                onChange={(event) =>
                                    change(
                                        "questions",
                                        event.target.value
                                            .split("\n")
                                            .map((text) => text.trim())
                                            .filter(Boolean)
                                            .slice(0, 8),
                                    )
                                }
                            />
                        </label>
                        <label>
                            快捷导航{" "}
                            <Select
                                mode="multiple"
                                style={{ display: "block", marginTop: 7 }}
                                value={setting.navigation}
                                options={["图片生成", "视频生成", "灵感大厅", "自由画布", "Agent", "技能", "资产库", "创作历史", "积分中心"].map((value) => ({ value, label: value }))}
                                onChange={(value) => change("navigation", value)}
                            />
                        </label>
                        <p>站内快捷导航由真实路由白名单控制，模型不能生成管理操作入口。语音和服务端聊天历史暂未启用。</p>
                    </section>
                </div>
            )}
        </AdminPageFrame>
    );
}
