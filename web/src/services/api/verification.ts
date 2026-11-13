import { http } from "./request";
import { invalidateAuthSessionCache, type LocalUser } from "./auth";

export type VerificationPolicy = {
    smsLogin: boolean;
    emailLogin: boolean;
    smsRegistration: boolean;
    emailRegistration: boolean;
    smsAndEmailRegistration: boolean;
};
export type VerificationMethod = "sms" | "email" | "sms_email";
export type VerificationPurpose = "login" | "register" | "bind";
export type VerificationDraft = { ticket: string; email: string; phone: string; emailCode: string; smsCode: string };
export const emptyVerification: VerificationDraft = { ticket: "", email: "", phone: "", emailCode: "", smsCode: "" };
export const methodLabels: Record<VerificationMethod, string> = { sms: "短信验证码", email: "邮件验证码", sms_email: "短信 + 邮箱双重验证" };

/** 注册是否需要验证码：首个管理员不需要；旧服务端未返回开关时按需要处理。 */
export function registrationVerificationRequired(settings: { firstUser: boolean; emailVerificationRequired?: boolean }) {
    return !settings.firstUser && settings.emailVerificationRequired !== false;
}

export function verificationMethods(policy: VerificationPolicy, purpose: "login" | "register"): VerificationMethod[] {
    if (purpose === "login") return [...(policy.smsLogin ? ["sms" as const] : []), ...(policy.emailLogin ? ["email" as const] : [])];
    if (policy.smsAndEmailRegistration) return ["sms_email"];
    return [...(policy.smsRegistration ? ["sms" as const] : []), ...(policy.emailRegistration ? ["email" as const] : [])];
}
export const startVerification = (input: { purpose: VerificationPurpose; method: VerificationMethod; email?: string; phone?: string; password?: string }) =>
    http.post<{ ticket: string; expiresIn: number; retryAfter: number }>("/auth/verification", input, input.purpose === "bind" ? undefined : { session: "public" });
export async function loginVerification(input: VerificationDraft) {
    const result = await http.post<{ user: LocalUser }>("/auth/verification/login", input, { session: "public" });
    invalidateAuthSessionCache();
    return result;
}
export async function bindVerification(input: VerificationDraft) {
    const result = await http.post<{ user: LocalUser }>("/auth/verification/bind", input);
    invalidateAuthSessionCache();
    return result;
}
export const getVerificationPolicy = () => http.get<VerificationPolicy>("/admin/settings/auth-policy");
export const saveVerificationPolicy = (input: VerificationPolicy) => http.put<VerificationPolicy>("/admin/settings/auth-policy", input);
