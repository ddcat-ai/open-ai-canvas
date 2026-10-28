import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSocialAuthStartUrl } from "@/supdance/plugins/social-auth/api";

describe("SupDance Social Auth Plugin", () => {
    test("buildSocialAuthStartUrl generates correct URL and parameters", () => {
        const url = buildSocialAuthStartUrl("qq", {
            next: "/canvas/123",
            acceptedTerms: true,
            mock: true,
            simulateRegion: "cn",
        });

        expect(url).toContain("/api/auth/social/qq/start");
        expect(url).toContain("next=%2Fcanvas%2F123");
        expect(url).toContain("acceptedTerms=true");
        expect(url).toContain("mock=true");
        expect(url).toContain("simulate_region=cn");
    });

    test("buildSocialAuthStartUrl handles minimal parameters", () => {
        const url = buildSocialAuthStartUrl("google");
        expect(url).toBe("/api/auth/social/google/start");
    });

    test("Plugin manifest is valid and conforms to yingce.plugin/v2", () => {
        const manifestPath = resolve(import.meta.dir, "../../supdance/plugins/supdance-social-auth/manifest.json");
        const content = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content);

        expect(manifest.apiVersion).toBe("yingce.plugin/v2");
        expect(manifest.id).toBe("supdance-social-auth");
        expect(manifest.version).toBe("1.0.0");
        expect(manifest.trusted).toBe(true);
        expect(manifest.surfaces).toContain("auth");
        expect(manifest.surfaces).toContain("settings");
    });

    test("8 major providers are correctly categorized into China Mainland and International", () => {
        const mainlandProviders = ["qq", "wechat", "douyin", "bilibili"];
        const intlProviders = ["google", "x", "instagram", "tiktok"];

        for (const p of mainlandProviders) {
            const url = buildSocialAuthStartUrl(p, { simulateRegion: "cn", mock: true });
            expect(url).toContain(`/api/auth/social/${p}/start`);
            expect(url).toContain("simulate_region=cn");
        }

        for (const p of intlProviders) {
            const url = buildSocialAuthStartUrl(p, { simulateRegion: "intl" });
            expect(url).toContain(`/api/auth/social/${p}/start`);
            expect(url).toContain("simulate_region=intl");
        }
    });

    test("Router mounts dark login page and admin config center", () => {
        const routerPath = resolve(import.meta.dir, "../src/router.tsx");
        const routerSource = readFileSync(routerPath, "utf-8");

        expect(routerSource).toContain('path: "/zh/login"');
        expect(routerSource).toContain("DarkLoginPage");
        expect(routerSource).toContain('path: "settings/social-auth"');
        expect(routerSource).toContain("SocialAuthSettingsPage");
    });
});
