import { useEffect, useState } from "react";
import { Alert, App, Button, Select, Typography } from "antd";
import { RefreshCw } from "lucide-react";
import { getModelCatalog } from "@/services/api/logical-models";
import { getCommerceOrchestrationSetting, updateCommerceOrchestrationSetting, type CommerceOrchestrationModel, type CommerceOrchestrationRole, type CommerceOrchestrationSetting } from "@/services/api/ecommerce-knowledge";
import { commercePlanningModelOptions, type CommerceModelOption } from "./ecommerce-model-catalog";
import "./ecommerce-stage-models.css";

// The order is the order the workbench runs them. Every stage reads the
// product images, so only models with image input are selectable.
const roles = [
    { key: "vision", label: "商品视觉理解", hint: "看图识别商品，推荐四套视觉方向" },
    { key: "marketing", label: "营销策划与文案", hint: "提炼卖点，撰写页面文案" },
    { key: "director", label: "视觉设计总监", hint: "逐张分镜与生图提示词", reuse: "marketing", reuseLabel: "复用营销策划与文案模型" },
    { key: "quality", label: "视觉质检", hint: "成图后的商品一致性复核", reuse: "vision", reuseLabel: "复用商品视觉理解模型" },
] as const;
type RoleKey = (typeof roles)[number]["key"];
const modelValue = (model?: CommerceOrchestrationModel) => (model?.channelModelId ? `channel:${model.channelModelId}` : model?.logicalModelId ? `logical:${model.logicalModelId}` : "");
const modelFromValue = (value?: string): CommerceOrchestrationModel => (value?.startsWith("channel:") ? { channelModelId: value.slice(8) } : value?.startsWith("logical:") ? { logicalModelId: value.slice(8) } : {});
const emptyRole = (): CommerceOrchestrationRole => ({ model: {}, fallback: {} });

/** The administrator's ecommerce Agent models; every ecommerce page and canvas node uses them. */
export function EcommerceStageModels({ embedded = false }: { embedded?: boolean }) {
    const { message } = App.useApp();
    const [settings, setSettings] = useState<CommerceOrchestrationSetting>();
    const [models, setModels] = useState<CommerceModelOption[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    async function load() {
        setLoading(true);
        try {
            const [saved, catalog] = await Promise.all([getCommerceOrchestrationSetting(), getModelCatalog()]);
            setSettings(saved);
            setModels(commercePlanningModelOptions(catalog));
            setDirty(false);
            setError("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void load();
    }, []);
    const update = (key: RoleKey, next: CommerceOrchestrationRole) => {
        setSettings((value) => (value ? { ...value, [key]: next } : value));
        setDirty(true);
    };
    async function save() {
        if (!settings) return;
        setSaving(true);
        try {
            setSettings(await updateCommerceOrchestrationSetting(settings));
            setDirty(false);
            message.success("电商 Agent 阶段模型已保存，新提交的任务立即生效");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }
    const selectable = models.filter((item) => !item.disabled).length;
    return (
        <section className={`ecommerce-stage-models${embedded ? " is-embedded" : ""}`} aria-label="电商 Agent 阶段模型">
            <header>
                <div>
                    {embedded ? null : <Typography.Text strong>电商 Agent 阶段模型</Typography.Text>}
                    <Typography.Paragraph type="secondary">
                        {embedded
                            ? `按执行顺序排列。每个阶段都要读商品图，当前有 ${selectable} 个支持图片输入的模型可选；主模型不可用时改用备用模型。`
                            : `按执行顺序为每个阶段指定模型，保存后所有用户的电商页与画布电商 Agent 节点都使用这里的配置，前台不展示也不能更改。主模型停用时自动改用备用模型。每个阶段都要读取商品图，当前可选 ${selectable} 个支持图片输入的模型。生图模型仍由用户在电商页面选择。`}
                    </Typography.Paragraph>
                </div>
                <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void load()}>
                    刷新模型
                </Button>
            </header>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            {settings ? (
                <ol>
                    {roles.map((item, index) => {
                        const role = settings[item.key] || emptyRole();
                        const current = [modelValue(role.model), modelValue(role.fallback)].filter(Boolean);
                        const options = [...models, ...current.filter((id) => !models.some((option) => option.value === id)).map((id) => ({ value: id, label: `已保存模型 ${id} · 已下架或不可见，请重新选择`, disabled: true }))];
                        const reuse = "reuse" in item ? item.reuse : "";
                        return (
                            <li key={item.key}>
                                <span className="ecommerce-stage-models-index">{index + 1}</span>
                                <div className="ecommerce-stage-models-label">
                                    <strong>{item.label}</strong>
                                    <small>{item.hint}</small>
                                </div>
                                <Select
                                    aria-label={`${item.label}主模型`}
                                    showSearch
                                    allowClear
                                    optionFilterProp="label"
                                    placeholder="主模型"
                                    value={role.reuse ? `reuse:${role.reuse}` : modelValue(role.model) || undefined}
                                    options={[...("reuse" in item ? [{ value: `reuse:${item.reuse}`, label: item.reuseLabel, disabled: false }] : []), ...options]}
                                    onChange={(value?: string) => update(item.key, value?.startsWith("reuse:") ? { ...emptyRole(), reuse } : { ...role, reuse: "", model: modelFromValue(value) })}
                                />
                                <Select
                                    aria-label={`${item.label}备用模型`}
                                    showSearch
                                    allowClear
                                    optionFilterProp="label"
                                    placeholder={role.reuse ? "跟随复用的阶段" : "备用模型（可选）"}
                                    disabled={Boolean(role.reuse)}
                                    value={modelValue(role.fallback) || undefined}
                                    options={options}
                                    onChange={(value?: string) => update(item.key, { ...role, fallback: modelFromValue(value) })}
                                />
                            </li>
                        );
                    })}
                </ol>
            ) : null}
            <footer>
                <Button type="primary" loading={saving} disabled={!settings || !dirty || Boolean(error)} onClick={() => void save()}>
                    保存阶段模型
                </Button>
                <Typography.Text type="secondary">{dirty ? "有未保存修改" : "已保存"}</Typography.Text>
            </footer>
        </section>
    );
}
