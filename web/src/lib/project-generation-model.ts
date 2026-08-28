import { selectableModelValue, type AiConfig } from "@/stores/use-config-store";

export function resolveProjectTextGenerationConfig(config: AiConfig, preferredModel: string) {
    const textModel = selectableModelValue(config, preferredModel || config.textModel, "text");
    if (!textModel) return null;
    return {
        textModel,
        requestConfig: {
            ...config,
            model: textModel,
            imageModel: textModel,
            videoModel: textModel,
            textModel,
        },
    };
}
