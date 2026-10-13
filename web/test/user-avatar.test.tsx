import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { UserAvatar } from "../src/components/layout/user-avatar";
import { resolveUserAvatarURL } from "../src/lib/user-avatar-url";
import { DEFAULT_USER_AVATARS, isDefaultUserAvatarID } from "../src/lib/default-user-avatars";
import { apiBaseURL } from "../src/services/api/request";
import type { LocalUser } from "../src/stores/use-user-store";

const user: LocalUser = { id: "user-1", username: "user", displayName: "User", role: "user", status: "active" };

function renderAvatar(avatarUrl?: string) {
    return renderToStaticMarkup(<UserAvatar user={{ ...user, avatarUrl }} className="size-8" />);
}

describe("shared user avatar image sources", () => {
    test("renders authenticated profile images and linked HTTP avatars", () => {
        for (const source of ["/api/auth/profile/avatar/user-1?v=012abc", "https://example.com/avatar.png", "http://example.com/avatar.jpg"]) {
            const markup = renderAvatar(source);
            expect(markup).toContain(`<img src="${resolveUserAvatarURL(source, apiBaseURL)}"`);
            expect(markup).toContain("object-cover");
        }
    });

    test("rejects unrelated relative URLs, traversal, protocol-relative and executable sources", () => {
        for (const source of [
            undefined,
            "",
            "/assets/avatar.png",
            "/api/auth/profile/avatar/../settings",
            "/api/auth/profile/avatar/user-1/../../settings",
            "/api/auth/profile/avatar/user-1?redirect=https://example.com",
            "//example.com/avatar.png",
            "data:image/svg+xml,test",
            "javascript:alert(1)",
            "blob:https://example.com/test",
        ]) {
            const markup = renderAvatar(source);
            expect(markup).not.toContain("<img");
            expect(markup).toContain("<svg");
        }
    });

    test("preserves sidebar icon styling when using the system default", () => {
        const markup = renderToStaticMarkup(<UserAvatar user={user} className="size-7" iconClassName="app-workspace-account-icon" />);
        expect(markup).toContain("app-workspace-account-icon");
        expect(markup).not.toContain("<img");
    });
});

describe("profile avatar deployment routing", () => {
    const canonical = "/api/auth/profile/avatar/user-1?v=012abc";

    test("resolves the canonical path onto API origins and proxy prefixes", () => {
        for (const [base, expected] of [
            ["/api", canonical],
            ["/api/", canonical],
            ["/proxy/yingce/api", "/proxy/yingce/api/auth/profile/avatar/user-1?v=012abc"],
            ["/proxy/yingce/api///", "/proxy/yingce/api/auth/profile/avatar/user-1?v=012abc"],
            ["https://backend.example.com/api", "https://backend.example.com/api/auth/profile/avatar/user-1?v=012abc"],
            ["https://backend.example.com/proxy/yingce/", "https://backend.example.com/proxy/yingce/auth/profile/avatar/user-1?v=012abc"],
            ["http://localhost:8080", "http://localhost:8080/auth/profile/avatar/user-1?v=012abc"],
            ["/", "/auth/profile/avatar/user-1?v=012abc"],
        ]) {
            expect(resolveUserAvatarURL(canonical, base)).toBe(expected);
        }
    });

    test("keeps third-party URLs independent of the configured API base", () => {
        for (const source of ["https://thirdparty.example.com/avatar.png?q=123", "http://thirdparty.example.com/avatar.jpg"]) {
            expect(resolveUserAvatarURL(source, "https://backend.example.com/proxy/api")).toBe(source);
        }
    });

    test("rejects noncanonical paths before joining with a custom backend", () => {
        for (const source of [
            undefined,
            "",
            "/api/auth/profile/avatar/user-1",
            "/api/auth/profile/avatar/user-1?v=",
            "/api/auth/profile/avatar/user-1?v=012abc&next=/settings",
            "/api/auth/profile/avatar/%2e%2e?v=012abc",
            "/api/auth/profile/avatar/user-1/../other?v=012abc",
            "/api/auth/profile/avatar/user-1?v=012abc#fragment",
            "/proxy/api/auth/profile/avatar/user-1?v=012abc",
            "//thirdparty.example.com/avatar.png",
            "data:image/png;base64,AAAA",
        ]) {
            expect(resolveUserAvatarURL(source, "https://backend.example.com/proxy/api")).toBe("");
        }
    });
});

describe("system avatar catalog and shared rendering", () => {
    test("exposes eight stable distinct presets and validates exact IDs", () => {
        expect(DEFAULT_USER_AVATARS.map((avatar) => avatar.id)).toEqual(["person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles"]);
        expect(new Set(DEFAULT_USER_AVATARS.map((avatar) => avatar.id)).size).toBe(8);
        for (const avatar of DEFAULT_USER_AVATARS) {
            expect(isDefaultUserAvatarID(avatar.id)).toBe(true);
            expect(avatar.label).not.toBe("");
        }
        for (const invalid of [undefined, null, "", "Cat", " cat", "cat ", "default", "../person"]) {
            expect(isDefaultUserAvatarID(invalid)).toBe(false);
        }
    });

    test("renders the selected icon globally and overrides inherited image URLs", () => {
        const iconClasses = ["lucide-circle-user-round", "lucide-clapperboard", "lucide-camera", "lucide-cat", "lucide-rabbit", "lucide-bot", "lucide-rocket", "lucide-sparkles"];
        for (const [index, preset] of DEFAULT_USER_AVATARS.entries()) {
            const markup = renderToStaticMarkup(
                <UserAvatar user={{ ...user, avatarMode: "default", avatarPreset: preset.id, avatarUrl: "https://example.com/inherited.png" }} className="creation-user-avatar" iconClassName="size-6 app-workspace-account-icon" />,
            );
            expect(markup).not.toContain("<img");
            expect(markup).toContain(iconClasses[index]);
            expect(markup).toContain("creation-user-avatar");
            expect(markup).toContain("app-workspace-account-icon");
        }
    });

    test("keeps custom images after remembering a preset preference", () => {
        const markup = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "custom", avatarPreset: "cat", avatarUrl: "/api/auth/profile/avatar/user-1?v=012abc" }} />);
        expect(markup).toContain("<img");
        expect(markup).not.toContain("lucide-cat");
        const legacyDefault = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "default" }} />);
        expect(legacyDefault).toContain("lucide-circle-user-round");
    });
});
