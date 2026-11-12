import { apiBaseURL, http } from "./request";
import { invalidateAuthSessionCache, type LocalUser } from "./auth";
import type { VerificationDraft } from "./verification";

export type WechatSetting = { enabled: boolean; appId: string; hasAppSecret: boolean; redirectUrl: string; updatedAt?: string };
export type WechatSettingDraft = { enabled: boolean; appId: string; appSecret: string; redirectUrl: string };
export const getAdminWechatSetting = () => http.get<{ setting: WechatSetting }>("/admin/settings/wechat");
export const updateAdminWechatSetting = (input: WechatSettingDraft) => http.patch<{ setting: WechatSetting }>("/admin/settings/wechat", input);
export function wechatLoginURL(next: string, acceptedTerms: boolean) {
    return `${apiBaseURL.replace(/\/$/, "")}/auth/wechat/start?${new URLSearchParams({ next, acceptedTerms: String(acceptedTerms) })}`;
}
export const profileWechatURL = (purpose: "bind" | "reauth") => `${apiBaseURL.replace(/\/$/, "")}/auth/profile/wechat/${purpose === "bind" ? "bind" : "start"}`;
export type WechatRegistrationInfo = { displayName: string; next: string; acceptedTerms: boolean };
export const getWechatRegistration = (signal?: AbortSignal) => http.get<WechatRegistrationInfo>("/auth/wechat/registration", { signal });
export const cancelWechatRegistration = () => http.delete<{ cleared: true }>("/auth/wechat/registration");
export async function completeWechatRegistration(input: Partial<VerificationDraft> & { email: string; acceptedTerms: boolean; referralCode?: string }) {
    const result = await http.post<{ user: LocalUser; next: string }>("/auth/wechat/registration", input);
    invalidateAuthSessionCache();
    return result;
}
