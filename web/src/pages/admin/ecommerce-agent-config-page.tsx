import { Button } from "antd";
import { ArrowUpRight, Clapperboard, Image as ImageIcon, Layers3, ListChecks, RefreshCw, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getAdminFeatureAvailability } from "@/services/api/auth";
import { getCommerceAgentSetting, type CommerceAgentSetting } from "@/services/api/ecommerce-knowledge";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "./components/admin-ui";
import { EcommerceStageModels } from "./ecommerce-stage-models";
import "./ecommerce-agent-config.css";

type ReadinessRow = { key: string; title: string; description: string; icon: ReactNode; ready: boolean; required: boolean; action: { label: string; run: () => void } };

const stageModelsAnchor = "eac-stage-models";
const hasModel = (ref?: { logicalModelId?: string; channelModelId?: string }) => Boolean(ref?.logicalModelId || ref?.channelModelId);

/**
 * 电商 Agent 上线配置：先看「还差什么」，再在同一页补齐阶段模型。
 * 功能开关仍只在「功能开放」修改，这里汇总电商用得到的几项并给出去处。
 */
export default function EcommerceAgentConfigPage() {
    const navigate = useNavigate();
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [agentSetting, setAgentSetting] = useState<CommerceAgentSetting | null>(null);
    const [loadError, setLoadError] = useState("");
    const [loading, setLoading] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [availability, setting] = await Promise.all([getAdminFeatureAvailability(), getCommerceAgentSetting()]);
            setFeatures(availability.features);
            setAgentSetting(setting);
            setLoadError("");
        } catch (cause) {
            setLoadError(cause instanceof Error ? cause.message : "读取上线状态失败");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    const openFeatures = () => navigate("/admin/settings/features");
    const openStageModels = () => document.getElementById(stageModelsAnchor)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // 运行时实际生效的模型：识别阶段缺省时沿用策划模型。
    const planningReady = hasModel(agentSetting ?? undefined);
    const visionReady = hasModel(agentSetting?.vision) || planningReady;
    const rows: ReadinessRow[] = features
        ? [
              {
                  key: "ecommerce",
                  title: "电商 Agent 已开放",
                  description: "前台侧栏显示电商 Agent，用户可以新建商品创作。关闭后入口隐藏，已有项目和作品保留。",
                  icon: <ShoppingBag className="size-4" aria-hidden="true" />,
                  ready: features.ecommerceEnabled,
                  required: true,
                  action: { label: "去功能开放", run: openFeatures },
              },
              {
                  key: "image",
                  title: "图片生成已开放",
                  description: "商品图按方案逐张出图，走图片生成能力；未开放时用户只能做到确认方案。",
                  icon: <ImageIcon className="size-4" aria-hidden="true" />,
                  ready: features.imageWorkbenchEnabled,
                  required: true,
                  action: { label: "去功能开放", run: openFeatures },
              },
              {
                  key: "models",
                  title: "阶段模型已配置",
                  description: visionReady && planningReady ? "商品识别与整套策划都有可用的识图模型。" : "商品识别或整套策划还没有可用模型，用户点击创作会被拒绝。",
                  icon: <Layers3 className="size-4" aria-hidden="true" />,
                  ready: visionReady && planningReady,
                  required: true,
                  action: { label: "去配置", run: openStageModels },
              },
              {
                  key: "video",
                  title: "商品视频（可选）",
                  description: "开启后作品可以一键带入视频生成做成商品视频；需要同时开放视频生成。",
                  icon: <Clapperboard className="size-4" aria-hidden="true" />,
                  ready: features.ecommerceVideoEnabled && features.videoWorkbenchEnabled,
                  required: false,
                  action: { label: "去功能开放", run: openFeatures },
              },
          ]
        : [];
    const missing = rows.filter((row) => row.required && !row.ready).length;

    return (
        <AdminPageFrame title="电商 Agent 配置" description="按清单补齐开放状态和阶段模型，用户就能从上传商品图一路做到导出整套商品图。" scroll>
            <div className="admin-settings-stack eac-page">
                <SettingsSectionCard
                    className="eac-section"
                    layout="stacked"
                    icon={<ListChecks className="size-4" aria-hidden="true" />}
                    title="上线检查"
                    description="必需项全部就绪后，用户才能完整走完「上传商品 → 选方向 → 确认方案 → 出图 → 导出」。"
                    status={features ? <AdminStatusBadge label={missing ? `还差 ${missing} 项` : "可以使用"} tone={missing ? "warning" : "success"} /> : undefined}
                    footer={
                        <>
                            <span className="eac-save-state">{loadError ? `读取失败：${loadError}` : features ? "以服务端当前配置为准" : "正在读取…"}</span>
                            <div className="eac-save-actions">
                                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                                    刷新
                                </Button>
                            </div>
                        </>
                    }
                >
                    <ul className="eac-availability">
                        {rows.map((row) => (
                            <li key={row.key}>
                                <span className="eac-availability-icon">{row.icon}</span>
                                <div>
                                    <strong>{row.title}</strong>
                                    <span>{row.description}</span>
                                </div>
                                <div className="eac-readiness-actions">
                                    <AdminStatusBadge label={row.ready ? "已就绪" : row.required ? "未完成" : "未开启"} tone={row.ready ? "success" : row.required ? "warning" : "neutral"} />
                                    {row.ready ? null : (
                                        <Button size="small" icon={<ArrowUpRight className="size-3.5" />} iconPlacement="end" onClick={row.action.run}>
                                            {row.action.label}
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </SettingsSectionCard>

                <div id={stageModelsAnchor}>
                    <SettingsSectionCard className="eac-section" layout="stacked" icon={<Layers3 className="size-4" aria-hidden="true" />} title="阶段模型" description="电商页按下面的顺序调用模型，所有用户共用，前台不展示也不能更改。">
                        <EcommerceStageModels embedded onSaved={() => void load()} />
                    </SettingsSectionCard>
                </div>
            </div>
        </AdminPageFrame>
    );
}
