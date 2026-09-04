import { resolveModelProtocolPreset, type ModelCapabilityConfig, type ResolvedModelProtocolPreset } from "@/lib/model-capabilities";
import { modelProtocolSupportsTokenBilling, type ModelProtocol, type ModelProtocolDefinition, type ProtocolCapability } from "@/lib/model-protocols";

export type ModelBillingMode = "fixed_request" | "per_second" | "token";

export type ModelProtocolPatch = {
    protocol: ModelProtocol;
    billingMode: ModelBillingMode;
    capabilityConfig?: ModelCapabilityConfig;
    defaultOptions: Record<string, unknown>;
};

export type BuildModelProtocolPatchResult = {
    preset: ResolvedModelProtocolPreset;
    patch?: ModelProtocolPatch;
};

export function buildModelProtocolPatch(input: { model: string; capability: ProtocolCapability; protocol: ModelProtocol; billingMode: ModelBillingMode; definitions: ModelProtocolDefinition[] }): BuildModelProtocolPatchResult {
    const preset = resolveModelProtocolPreset(input.protocol, input.model, input.definitions);
    if (preset.incompatibleReason) return { preset };

    return {
        preset,
        patch: {
            protocol: input.protocol,
            billingMode: input.billingMode === "token" && !modelProtocolSupportsTokenBilling(input.capability, input.protocol) ? "fixed_request" : input.billingMode,
            capabilityConfig: input.capability === "image" || input.capability === "video" ? preset.capabilityConfig : undefined,
            defaultOptions: preset.defaultOptions,
        },
    };
}
