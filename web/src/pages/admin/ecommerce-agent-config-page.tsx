import { Button } from "antd";
import { ArrowUpRight, Clapperboard, Image as ImageIcon, Layers3, MessageCircleMore, RefreshCw, ToggleLeft } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getAdminFeatureAvailability } from "@/services/api/auth";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "./components/admin-ui";
import { EcommerceAssistantSettings } from "./ecommerce-assistant-settings";
import { EcommerceStageModels } from "./ecommerce-stage-models";
import "./ecommerce-agent-config.css";

type Availability = { key: "ecommerceEnabled" | "ecommerceVideoEnabled" | "siteAssistantEnabled"; title: string; description: string; icon: ReactNode };

const availabilityRows: Availability[] = [
    { key: "ecommerceEnabled", title: "电商 Agent", description: "前台侧栏显示电商 Agent，用户可新建商品创作；生成商品图还需开启图片生成。关闭后隐藏入口，已有项目和作品保留。", icon: <ImageIcon className="size-4" aria-hidden="true" /> },
    { key: "ecommerceVideoEnabled", title: "商品视频", description: "从商品图片制作视频；同时需要电商创作与视频生成开放。", icon: <Clapperboard className="size-4" aria-hidden="true" /> },
    { key: "siteAssistantEnabled", title: "创作助手", description: "允许用户向下方配置的创作助手提问；助手本身还需在下方启用。", icon: <MessageCircleMore className="size-4" aria-hidden="true" /> },
];

/** 电商 Agent 的运行配置：是否开放、各阶段用哪个模型、站内创作助手怎么回答。知识与技能在相邻的「知识与技能」页。 */
export default function EcommerceAgentConfigPage() {
    const navigate = useNavigate();
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [featureError, setFeatureError] = useState("");
    const [loadingFeatures, setLoadingFeatures] = useState(false);
    const loadFeatures = useCallback(async () => {
        setLoadingFeatures(true);
        try {
            setFeatures((await getAdminFeatureAvailability()).features);
            setFeatureError("");
        } catch (cause) {
            setFeatureError(cause instanceof Error ? cause.message : "读取功能开放状态失败");
        } finally {
            setLoadingFeatures(false);
        }
    }, []);
    useEffect(() => {
        void loadFeatures();
    }, [loadFeatures]);
    const openCount = features ? availabilityRows.filter((row) => features[row.key]).length : 0;

    return (
        <AdminPageFrame title="电商 Agent 配置" description="决定电商 Agent 是否对用户开放、各阶段使用哪个模型，以及工作台创作助手如何回答。" scroll>
            <div className="admin-settings-stack eac-page">
                <SettingsSectionCard
                    className="eac-section"
                    layout="stacked"
                    icon={<ToggleLeft className="size-4" aria-hidden="true" />}
                    title="开放状态"
                    description="开关统一在「功能开放」中修改，这里只汇总电商 Agent 相关的三项。"
                    status={features ? <AdminStatusBadge label={`${openCount} / ${availabilityRows.length} 已开放`} tone={features.ecommerceEnabled ? "success" : "warning"} /> : undefined}
                    footer={
                        <>
                            <span className="eac-save-state">{featureError ? `读取失败：${featureError}` : features ? "以服务端当前配置为准" : "正在读取…"}</span>
                            <div className="eac-save-actions">
                                <Button icon={<RefreshCw className="size-4" />} loading={loadingFeatures} onClick={() => void loadFeatures()}>
                                    刷新
                                </Button>
                                <Button icon={<ArrowUpRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/admin/settings/features")}>
                                    去功能开放调整
                                </Button>
                            </div>
                        </>
                    }
                >
                    <ul className="eac-availability">
                        {availabilityRows.map((row) => {
                            const enabled = features?.[row.key];
                            return (
                                <li key={row.key}>
                                    <span className="eac-availability-icon">{row.icon}</span>
                                    <div>
                                        <strong>{row.title}</strong>
                                        <span>{row.description}</span>
                                    </div>
                                    {features ? <AdminStatusBadge label={enabled ? "已开放" : "未开放"} tone={enabled ? "success" : "neutral"} /> : null}
                                </li>
                            );
                        })}
                    </ul>
                </SettingsSectionCard>

                <SettingsSectionCard
                    className="eac-section"
                    layout="stacked"
                    icon={<Layers3 className="size-4" aria-hidden="true" />}
                    title="阶段模型"
                    description="电商页与画布电商 Agent 节点的识图、策划、分镜和质检都使用这里的模型，用户不能更改；生图模型仍由用户在电商页选择。"
                >
                    <EcommerceStageModels embedded />
                </SettingsSectionCard>

                <EcommerceAssistantSettings featureEnabled={features?.siteAssistantEnabled} />
            </div>
        </AdminPageFrame>
    );
}
