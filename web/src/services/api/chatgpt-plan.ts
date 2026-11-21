import { http } from "./request";

export type ChatGPTPlanStatus = { enabled: boolean; connected: boolean; email?: string; channelId?: string };
export type ChatGPTPlanModel = { slug: string; displayName: string };

export function getChatGPTPlanStatus(signal?: AbortSignal) {
    return http.get<ChatGPTPlanStatus>("/chatgpt-plan", { signal });
}

export function startChatGPTPlanConnection() {
    return http.post<{ authorizationUrl: string }>("/chatgpt-plan/start");
}

export function disconnectChatGPTPlan() {
    return http.post<{ revocationConfirmed: boolean }>("/chatgpt-plan/disconnect");
}

export function listChatGPTPlanModels(signal?: AbortSignal) {
    return http.get<{ models: ChatGPTPlanModel[] }>("/chatgpt-plan/models", { signal });
}

export function addChatGPTPlanModel(slug: string) {
    return http.post<{ model: { id: string } }>("/chatgpt-plan/models", { slug });
}
