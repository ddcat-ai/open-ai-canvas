import { isChannelModelValue, modelOptionName } from "@/stores/config-model-options";

/** 服务端模型名不能唯一确定计费渠道时，要求用户选择，禁止静默使用默认模型。 */
export function resolveCloudAgentModel(model: string, availableTextModels: string[]): { model: string; problem?: "ambiguous" | "unavailable" } {
    if (availableTextModels.includes(model)) return { model };
    if (isChannelModelValue(model)) return { model: "", problem: "unavailable" };
    const matches = [...new Set(availableTextModels.filter((option) => modelOptionName(option) === model))];
    if (matches.length === 1) return { model: matches[0] };
    return { model: "", problem: matches.length > 1 ? "ambiguous" : "unavailable" };
}
