import { http } from "@/services/api/request";

/**
 * 阿里云短信配置。
 *
 * 与邮件配置（`services/api/wallet.ts` 里的 `EmailSetting*`）**同形**：
 * - 出参里**永远没有** `accessKeySecret`，只有 `hasAccessKeySecret`（密钥只进不出）；
 * - 入参里 `accessKeySecret` 可以**不填** = 保留原密钥。
 */
export type SmsSetting = {
    enabled: boolean;
    accessKeyId: string;
    /** 只读：密钥是否已配置（服务端不给明文）。 */
    hasAccessKeySecret: boolean;
    signName: string;
    registerTemplateCode: string;
    resetTemplateCode: string;
    regionId: string;
    /** 三项齐备（AccessKey + 签名 + 注册模板）—— 注册页据此决定显不显示手机号页签。 */
    configured: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export function getAdminSmsSetting() {
    return http.get<{ setting: SmsSetting }>("/admin/settings/sms");
}

export function updateAdminSmsSetting(input: Partial<SmsSetting> & { accessKeySecret?: string }) {
    return http.patch<{ setting: SmsSetting }>("/admin/settings/sms", input);
}

/** 发一条真短信（按条计费）—— 唯一能证明 AccessKey/签名/模板都对的手段。 */
export function testAdminSms(phone: string) {
    return http.post<{ sent: boolean; bizId?: string }>("/admin/settings/sms/test", { phone });
}
