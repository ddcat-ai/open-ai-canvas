import { http } from "./request";

export type APICapability = "text" | "image" | "video" | "audio";
export type ModelCallParameter = {
    type: string;
    default?: string | number | boolean;
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
    step?: number;
    required?: boolean;
    description?: string;
};
export type ExternalModel = {
    id: string;
    name: string;
    capability: APICapability;
    description?: string;
    parameters: Record<string, ModelCallParameter>;
    outputTokenLimit?: number;
    limitation?: string;
};

export const getModelCallCatalog = (signal?: AbortSignal) => http.get<{ models: ExternalModel[] }>("/model-calls/models", { signal });
