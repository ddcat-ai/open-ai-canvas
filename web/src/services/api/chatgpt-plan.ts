import { http } from "./request";

export type ChatGPTPlanStatus = { connected: boolean; email?: string; channelId?: string };
export type ChatGPTPlanModel = { slug: string; displayName: string };

export function getChatGPTPlanStatus() {
    return http.get<ChatGPTPlanStatus>("/admin/chatgpt-plan");
}

export function startChatGPTPlanConnection() {
    return http.post<{ authorizationUrl: string }>("/admin/chatgpt-plan/start");
}

export function disconnectChatGPTPlan() {
    return http.post<{ revocationConfirmed: boolean }>("/admin/chatgpt-plan/disconnect");
}

export function listChatGPTPlanModels() {
    return http.get<{ models: ChatGPTPlanModel[] }>("/admin/chatgpt-plan/models");
}

export function addChatGPTPlanModel(slug: string) {
    return http.post<{ model: { id: string } }>("/admin/chatgpt-plan/models", { slug });
}
