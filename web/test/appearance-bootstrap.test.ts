import { expect, test } from "bun:test";

import { appearanceLogoURL, normalizePublicAppearance } from "../src/stores/use-appearance-store";

test("initial HTML stays brand neutral until the public appearance is resolved", async () => {
    const [html, mainSource] = await Promise.all([Bun.file(new URL("../index.html", import.meta.url)).text(), Bun.file(new URL("../src/main.tsx", import.meta.url)).text()]);

    expect(html).not.toContain("影策");
    expect(html).not.toContain("/logo.svg");
    expect(html).toContain("<title>正在加载</title>");
    expect(mainSource.indexOf("bootstrapAppearance()")).toBeLessThan(mainSource.indexOf('import("./application")'));
});

test("a custom login video never falls back to the built-in poster", () => {
    const appearance = normalizePublicAppearance({
        brandName: "HIMA Studio",
        brandSlug: "hima-studio",
        authHeroTitle: "把灵感，\n变成可见的故事。",
        authHeroDescription: "从同一个创作空间持续推进。",
        authVideoConfigured: true,
        authVideoUrl: "/api/public/appearance/assets/video?v=next",
        authVideoPosterConfigured: false,
        authVideoPosterUrl: "",
    });

    expect(appearance.brandName).toBe("HIMA Studio");
    expect(appearance.brandSlug).toBe("hima-studio");
    expect(appearance.authHeroTitle).toBe("把灵感，\n变成可见的故事。");
    expect(appearance.authHeroDescription).toBe("从同一个创作空间持续推进。");
    expect(appearance.authVideoPosterUrl).toBe("");
});

test("appearance URLs reject executable and insecure remote schemes", () => {
    const appearance = normalizePublicAppearance({
        logoConfigured: true,
        logoUrl: "javascript:alert(1)",
        authVideoConfigured: true,
        authVideoUrl: "http://example.com/brand.mp4",
    });

    expect(appearance.logoUrl).toBe("/logo.svg");
    expect(appearance.authVideoUrl).not.toContain("example.com");
});

test("appearance selects theme logos and falls back to the single configured logo", () => {
    const dual = normalizePublicAppearance({
        logoConfigured: true,
        darkLogoConfigured: true,
        logoUrl: "/api/public/appearance/assets/logo?v=dual",
        darkLogoUrl: "/api/public/appearance/assets/logo-dark?v=dual",
        logoFrameEnabled: false,
    });
    expect(appearanceLogoURL(dual, "light")).toContain("/logo?");
    expect(appearanceLogoURL(dual, "dark")).toContain("/logo-dark?");
    expect(dual.logoFrameEnabled).toBe(false);

    const single = normalizePublicAppearance({ logoConfigured: true, logoUrl: "/api/public/appearance/assets/logo?v=single" });
    expect(appearanceLogoURL(single, "light")).toBe(single.logoUrl);
    expect(appearanceLogoURL(single, "dark")).toBe(single.logoUrl);
    expect(single.logoFrameEnabled).toBe(true);
});

test("auth scene consumes resolved appearance instead of hardcoded media constants", async () => {
    const source = await Bun.file(new URL("../src/pages/auth/auth-scene.tsx", import.meta.url)).text();

    expect(source).toContain("appearance.authVideoUrl");
    expect(source).toContain("appearance.authVideoPosterUrl || undefined");
    expect(source).toContain("appearance.brandName");
    expect(source).toContain("appearance.authHeroTitle");
    expect(source).toContain("appearance.authHeroDescription");
    expect(source).toContain('theme="dark"');
    expect(source).not.toContain("让一个故事，");
    expect(source).not.toContain("AUTH_VIDEO_URL");
    expect(source).not.toContain("AUTH_VIDEO_POSTER");
});

test("appearance management exposes light and dark logo uploads plus the frame switch", async () => {
    const [pageSource, brandSource, adminStyles, globalStyles] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/settings/appearance-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/brand/brand-logo.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
    ]);

    expect(pageSource).toContain('slot="logo-dark"');
    expect(pageSource).toContain("浅色模式 Logo");
    expect(pageSource).toContain("深色模式 Logo（可选）");
    expect(pageSource).toContain("禁用 Logo 后面的圆角矩形外框");
    expect(pageSource).toContain("<Switch");
    expect(pageSource).toContain("checked={!logoFrameEnabled}");
    expect(pageSource).toContain("setLogoFrameEnabled(!checked)");
    expect(pageSource).not.toContain("<Checkbox");
    expect(pageSource).toContain("深浅模式 Logo 预览");
    expect(brandSource).toContain("useThemeStore");
    expect(brandSource).toContain("data-logo-frame-enabled");
    expect(adminStyles).toContain(".admin-appearance-logo-preview-mark.is-unframed img");
    expect(globalStyles).toContain('.brand-logo-frame[data-logo-frame-enabled="false"] > :is(img, svg)');
});

test("object storage can adopt the configured English brand identifier without replacing saved prefixes automatically", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/settings/storage-settings-page.tsx", import.meta.url)).text();

    expect(source).toContain("state.appearance.brandSlug");
    expect(source).toContain("使用品牌标识");
    expect(source).toContain('form.setFieldValue("pathPrefix", brandSlug)');
    expect(source).toContain("setting.pathPrefix || DEFAULT_OSS_PATH_PREFIX");
});

test("appearance management exposes a server-side reset to the built-in Yingce brand", async () => {
    const [pageSource, apiSource] = await Promise.all([Bun.file(new URL("../src/pages/admin/settings/appearance-settings-page.tsx", import.meta.url)).text(), Bun.file(new URL("../src/services/api/appearance.ts", import.meta.url)).text()]);

    expect(pageSource).toContain("恢复影策默认");
    expect(pageSource).toContain("resetAdminAppearance()");
    expect(pageSource).toContain("已上传文件仍保留在存储资源中");
    expect(apiSource).toContain('apiClient.delete("/admin/settings/appearance")');
});
