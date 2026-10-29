import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ModelPicker } from "@/components/model-picker";
import { dramaChoiceKey, dramaChoiceKeys, dramaChoiceToModel, dramaVideoRatioIssue, modelToDramaChoice } from "@/lib/drama/model-choice";
import { cn } from "@/lib/utils";
import { getDramaModels, type DramaCapability, type DramaModelChoice } from "@/services/api/drama";
import { useEffectiveConfig } from "@/stores/use-config-store";

export function useDramaModelCatalog() {
    return useQuery({ queryKey: ["drama-models"], queryFn: getDramaModels, staleTime: 60_000 });
}

/**
 * 短剧制作用的模型下拉：沿用创作端带品牌图标的通用 ModelPicker，
 * 只有服务端可无人值守执行的平台模型可选，其余模型置灰并显示不能用的具体原因。
 * 视频模型传入作品画幅时，给不出该画幅的模型同样置灰，避免选了才发现出片是横屏。
 */
export function DramaModelPicker({
    capability,
    value,
    onChange,
    placeholder,
    aspectRatio,
    size = "md",
    showPrice = true,
    className,
}: {
    capability: DramaCapability;
    value?: DramaModelChoice;
    onChange: (choice: DramaModelChoice) => void;
    placeholder?: string;
    aspectRatio?: string;
    size?: "sm" | "md";
    showPrice?: boolean;
    className?: string;
}) {
    const config = useEffectiveConfig();
    const catalogQuery = useDramaModelCatalog();
    const allowed = useMemo(() => {
        const options = catalogQuery.data?.options[capability] || [];
        return new Map(options.map((option) => [dramaChoiceKey(option.choice), option]));
    }, [capability, catalogQuery.data]);
    const blocked = useMemo(() => {
        const items = catalogQuery.data?.unavailable?.[capability] || [];
        return new Map(items.map((item) => [dramaChoiceKey(item.choice), item.reason]));
    }, [capability, catalogQuery.data]);
    // 创作端能选的模型这里都列出；短剧用不了的置灰并写明原因，不再静默隐藏。
    const matchChoice = useCallback((model: string) => dramaChoiceKeys(config, model).find((key) => allowed.has(key)), [allowed, config]);
    const modelDisabledReason = useCallback(
        (model: string) => {
            const keys = dramaChoiceKeys(config, model);
            if (!keys.length) return "个人渠道的密钥只保存在浏览器，短剧在服务端无人值守执行，只能使用平台模型";
            if (!catalogQuery.data) return "";
            const matched = matchChoice(model);
            if (matched) return capability === "video" && aspectRatio ? dramaVideoRatioIssue(allowed.get(matched), aspectRatio) : "";
            for (const key of keys) {
                const reason = blocked.get(key);
                if (reason) return reason;
            }
            return "模型列表已更新，请刷新页面后再选";
        },
        [allowed, aspectRatio, blocked, capability, catalogQuery.data, config, matchChoice],
    );
    const current = dramaChoiceToModel(config, capability, value);

    return (
        <ModelPicker
            config={config}
            value={current}
            capability={capability}
            variant="creation"
            fullWidth
            showSelectedPrice={showPrice}
            showOptionPrices
            modelDisabledReason={modelDisabledReason}
            className={cn("drama-model-picker", size === "sm" && "is-sm", className)}
            placeholder={current ? placeholder || "选择模型" : value?.label || placeholder || "选择模型"}
            onChange={(model) => {
                const choice = modelToDramaChoice(config, model);
                if (!choice) return;
                // 以后端登记的选择为准，避免提交一个后端不认的键。
                const matched = matchChoice(model);
                const known = matched ? allowed.get(matched)?.choice : undefined;
                onChange(known ? { ...known, label: choice.label || known.label } : choice);
            }}
        />
    );
}
