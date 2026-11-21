import { http } from "./request";

export type ChatGPTPlanStatus = { enabled: boolean; connected: boolean; selectedModelSlugs: string[]; email?: string; channelId?: string };
export type ChatGPTPlanModel = { slug: string; displayName: string; selected: boolean; available: boolean };

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

export function saveChatGPTPlanModels(slugs: string[]) {
    return http.put<{ saved: boolean }>("/chatgpt-plan/models", { slugs });
}
