import { translate } from "@/i18n";

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function profileAvatarError(file: Pick<File, "type" | "size">): string | undefined {
    if (file.type !== "image/png" && file.type !== "image/jpeg") return translate("account.settings.profile.avatarType");
    if (!file.size) return translate("account.settings.profile.avatarEmpty");
    if (file.size > PROFILE_AVATAR_MAX_BYTES) return translate("account.settings.profile.avatarTooLarge");
}

export function profilePasswordError(password: string): string | undefined {
    if ([...password].length < 8) return translate("account.settings.profile.passwordShort");
    if (new TextEncoder().encode(password).length > 72) return translate("account.settings.profile.passwordLong");
}

export function profileSecondsRemaining(until: number, now: number): number {
    return Math.max(0, Math.ceil((until - now) / 1000));
}

export function profileReauthReady(until: string | undefined, now: number): boolean {
    return !!until && Date.parse(until) > now;
}
