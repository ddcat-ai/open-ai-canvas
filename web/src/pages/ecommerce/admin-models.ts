import { useEffect, useMemo, useState } from "react";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getCommerceAgentSetting, type CommerceAgentModelRef, type CommerceAgentSetting } from "@/services/api/ecommerce-knowledge";
import { modelOptionName } from "@/stores/config-model-options";
import { resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

const hasRef = (ref?: CommerceAgentModelRef | null) => Boolean(ref?.channelModelId || ref?.logicalModelId);

/**
 * 找到与后台指定模型对应的可选目录项。直接比对目录里的渠道模型行 ID（或渠道 + 模型键）与逻辑模型 ID，
 * 不借道报价请求：直连系统渠道的文本模型不发服务端报价，借道会让所有直连模型都匹配不上。
 */
export function matchCommerceAdminModel(config: AiConfig, textModels: string[], ref?: CommerceAgentModelRef | null): string {
    if (!ref || !hasRef(ref)) return "";
    return (
        textModels.find((value) => {
            const channel = resolveModelChannel(config, value);
            if (channel.scope !== "system") return false;
            const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
            if (!cost) return false;
            if (ref.logicalModelId) return cost.logicalModelId === ref.logicalModelId;
            return cost.channelModelId === ref.channelModelId || (Boolean(ref.channelId && ref.modelKey) && channel.id === ref.channelId && cost.model === ref.modelKey);
        }) || ""
    );
}

export type CommerceAdminModels = {
    /** Copy, storyboard and image prompts. */
    planningModel: string;
    /** Product recognition and the four style directions. */
    visionModel: string;
    loaded: boolean;
    /** Set when the administrator's choice is not usable from this account. */
    problem: string;
};

/**
 * The ecommerce Agent analysis models are fixed by the administrator; users only
 * choose the image model. When nothing is configured the first text model with
 * image input is used so a fresh deployment still works.
 */
export function useCommerceAdminModels(config: AiConfig): CommerceAdminModels {
    const [setting, setSetting] = useState<CommerceAgentSetting | null>(null);
    const [loadError, setLoadError] = useState("");
    useEffect(() => {
        let live = true;
        void getCommerceAgentSetting()
            .then((value) => {
                if (live) setSetting(value);
            })
            .catch(() => {
                if (live) setLoadError("电商 Agent 模型配置读取失败，请刷新页面");
            });
        return () => {
            live = false;
        };
    }, []);
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    return useMemo(() => {
        if (!setting) return { planningModel: "", visionModel: "", loaded: false, problem: loadError };
        const fallback = textModels.find((value) => (modelCapabilityConfigFor(config, value).text?.references.maxImages || 0) > 0) || "";
        const planningModel = hasRef(setting) ? matchCommerceAdminModel(config, textModels, setting) : fallback;
        const visionModel = hasRef(setting.vision) ? matchCommerceAdminModel(config, textModels, setting.vision) : planningModel;
        const problem = !planningModel
            ? hasRef(setting)
                ? "后台指定的整套策划模型当前不可用，请联系管理员在「电商 Agent 配置」重新选择"
                : "还没有可读商品图的文本模型，请联系管理员在「电商 Agent 配置」配置阶段模型"
            : !visionModel
              ? "后台指定的商品识别模型当前不可用，请联系管理员在「电商 Agent 配置」重新选择"
              : "";
        return { planningModel, visionModel, loaded: true, problem };
    }, [setting, loadError, config, textModels]);
}
