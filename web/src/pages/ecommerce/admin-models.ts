import { useEffect, useMemo, useState } from "react";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteRequest } from "@/lib/model-pricing";
import { getCommerceAgentSetting, type CommerceAgentModelRef, type CommerceAgentSetting } from "@/services/api/ecommerce-knowledge";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

const hasRef = (ref?: CommerceAgentModelRef | null) => Boolean(ref?.channelModelId || ref?.logicalModelId);

/** Finds the selectable catalog option that routes to the administrator's model. */
export function matchCommerceAdminModel(config: AiConfig, textModels: string[], ref?: CommerceAgentModelRef | null): string {
    if (!ref || !hasRef(ref)) return "";
    return (
        textModels.find((value) => {
            const route = modelQuoteRequest(config, value, "text", { capability: "text", input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } });
            return ref.channelModelId ? route?.channelId === ref.channelId && route?.modelKey === ref.modelKey : route?.logicalModelID === ref.logicalModelId;
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
        const problem = !planningModel ? "后台指定的视觉策划模型当前不可用，请联系管理员重新选择" : !visionModel ? "后台指定的商品识图模型当前不可用，请联系管理员重新选择" : "";
        return { planningModel, visionModel, loaded: true, problem };
    }, [setting, loadError, config, textModels]);
}
