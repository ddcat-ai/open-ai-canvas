import { describe, expect, test } from "bun:test";
import { profileAvatarError, PROFILE_AVATAR_MAX_BYTES, profilePasswordError, profileReauthReady, profileSecondsRemaining } from "../src/pages/settings/profile-validation";
import { settingsPath } from "../src/lib/settings-navigation";
import { changeProfileEmail, changeProfilePassword, getUserProfile, profileLinuxDOReauthURL, requestProfileEmailCode, resetProfileAvatar, selectDefaultProfileAvatar, uploadProfileAvatar } from "../src/services/api/profile";
import { ApiError, apiClient } from "../src/services/api/request";

describe("profile input and security expiry", () => {
    test("rejects unsupported, empty and oversized avatar uploads", () => {
        expect(profileAvatarError({ type: "image/svg+xml", size: 100 })).toBeDefined();
        expect(profileAvatarError({ type: "image/png", size: 0 })).toBeDefined();
        expect(profileAvatarError({ type: "image/jpeg", size: PROFILE_AVATAR_MAX_BYTES + 1 })).toBeDefined();
        expect(profileAvatarError({ type: "image/png", size: PROFILE_AVATAR_MAX_BYTES })).toBeUndefined();
    });
    test("checks password UTF-8 byte limit to prevent bcrypt truncation", () => {
        expect(profilePasswordError("1234567")).toBeDefined();
        expect(profilePasswordError("a".repeat(72))).toBeUndefined();
        expect(profilePasswordError("a".repeat(73))).toBeDefined();
        expect(profilePasswordError("密".repeat(24))).toBeUndefined();
        expect(profilePasswordError("密".repeat(25))).toBeDefined();
        expect(profilePasswordError("😀".repeat(4))).toBeDefined();
        expect(profilePasswordError("😀".repeat(8))).toBeUndefined();
    });
    test("expires identity proof and code cooldown at the boundary", () => {
        const deadline = "2026-10-12T12:00:00Z";
        const timestamp = Date.parse(deadline);
        expect(profileReauthReady(deadline, timestamp - 1)).toBe(true);
        expect(profileReauthReady(deadline, timestamp)).toBe(false);
        expect(profileReauthReady("invalid", timestamp)).toBe(false);
        expect(profileReauthReady(undefined, timestamp)).toBe(false);
        expect(profileSecondsRemaining(timestamp, timestamp - 1001)).toBe(2);
        expect(profileSecondsRemaining(timestamp, timestamp + 1)).toBe(0);
    });
    test("account settings default to profile and creation continues to channels", () => {
        expect(settingsPath()).toBe("/settings?section=profile");
        expect(settingsPath(undefined, true)).toBe("/settings?section=channels&continue=1");
        expect(settingsPath("models", true)).toBe("/settings?section=models&continue=1");
        expect(settingsPath("profile")).toBe("/settings?section=profile");
    });
});

describe("profile API request contract", () => {
    test("forwards load cancellation and uses multipart avatar without forcing content type", async () => {
        const original = apiClient.request;
        const requests: Array<Record<string, unknown>> = [];
        apiClient.request = (async (config: Record<string, unknown>) => {
            requests.push(config);
            return { data: { code: 0, data: { user: { id: "user-1" } }, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            const signal = new AbortController().signal;
            await getUserProfile(signal);
            const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
            await uploadProfileAvatar(file);
            await resetProfileAvatar();
            await selectDefaultProfileAvatar("cat");
            expect(requests[0]).toMatchObject({ url: "/auth/profile", method: "get", signal });
            expect(requests[1]).toMatchObject({ url: "/auth/profile/avatar", method: "put" });
            const multipart = requests[1].data as FormData;
            expect(multipart.get("file")).toBeInstanceOf(File);
            expect((multipart.get("file") as File).name).toBe("avatar.png");
            expect(requests[1].headers).toBeUndefined();
            expect(requests[2]).toMatchObject({ url: "/auth/profile/avatar", method: "delete" });
            expect(requests[3]).toMatchObject({ url: "/auth/profile/avatar/default", method: "post", data: { preset: "cat" } });
        } finally {
            apiClient.request = original;
        }
    });
    test("keeps passwords, email codes and tickets in POST bodies", async () => {
        const original = apiClient.request;
        const requests: Array<Record<string, unknown>> = [];
        apiClient.request = (async (config: Record<string, unknown>) => {
            requests.push(config);
            return { data: { code: 0, data: { changed: true }, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            await changeProfilePassword({ currentPassword: "old-password", newPassword: "new-password" });
            await requestProfileEmailCode({ email: "new@example.test", currentPassword: "old-password" });
            await changeProfileEmail({ ticket: "test-ticket", emailCode: "123456", currentPassword: "old-password" });
            expect(requests.map((request) => request.url)).toEqual(["/auth/profile/password", "/auth/profile/email-code", "/auth/profile/email"]);
            expect(requests.every((request) => request.method === "post" && request.params === undefined)).toBe(true);
            expect(requests[2].data).toEqual({ ticket: "test-ticket", emailCode: "123456", currentPassword: "old-password" });
            expect(profileLinuxDOReauthURL()).toEndWith("/auth/profile/linuxdo/start");
            expect(profileLinuxDOReauthURL()).not.toContain("?");
        } finally {
            apiClient.request = original;
        }
    });
    test("propagates failed security writes with the backend reason", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({ data: { code: 40001, data: null, msg: "身份验证失败", reason: "bad_auth_request" }, status: 400 })) as typeof apiClient.request;
        try {
            const error = await changeProfilePassword({ currentPassword: "wrong", newPassword: "new-password" }).catch((failure) => failure);
            expect(error).toBeInstanceOf(ApiError);
            expect(error.reason).toBe("bad_auth_request");
        } finally {
            apiClient.request = original;
        }
    });
});
