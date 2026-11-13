import { SUPPORTED_LOCALES } from "../../src/i18n/locales";
import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createJSONStorage } from "zustand/middleware";
import { DEFAULT_CANVAS_APPEARANCE } from "../../src/lib/canvas/agent-appearance";
import { DEFAULT_CLASSIC_SKIN } from "../../src/lib/skin-themes";
import { useAppearanceStore } from "../../src/stores/use-appearance-store";
import { useUserStore } from "../../src/stores/use-user-store";
import { personalAppearanceMessages } from "../../src/i18n/personal-appearance-messages";
import "../../src/themes/longying-ink";

const dom = new Window({ url: "https://canvas.example/settings" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { useAppearancePreferencesStore, useEffectiveSkin, useEffectiveCanvasAppearance, usePersonalAppearancePreferences } = await import("../../src/stores/use-appearance-preferences-store");
useAppearancePreferencesStore.persist.setOptions({ storage: createJSONStorage(() => dom.localStorage) });
const initialAppearance = useAppearanceStore.getState().appearance;
const initialUser = useUserStore.getState().user;
let root: Root | undefined;
let container: HTMLDivElement;

function Preview() {
    const skin = useEffectiveSkin();
    const canvas = useEffectiveCanvasAppearance();
    const preferences = usePersonalAppearancePreferences();
    return (
        <output data-skin={skin.id} data-avatar={preferences.avatar} data-type={canvas.avatarType} data-bundle={canvas.avatarBundleResourceId} data-name={canvas.agentName} data-scope={canvas.avatarAssetScope ?? "public"} data-entry={canvas.live2dEntry} />
    );
}

async function render() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(<Preview />);
    });
    return container.querySelector("output")!;
}

async function account(id: string | null) {
    await act(async () => {
        useUserStore.setState({ user: id ? ({ ...initialUser, id, role: "user", status: "active" } as NonNullable<typeof initialUser>) : null });
    });
}

afterEach(async () => {
    if (root)
        await act(async () => {
            root!.unmount();
        });
    root = undefined;
    container?.remove();
    useAppearancePreferencesStore.setState({ byUser: {} });
    useUserStore.setState({ user: initialUser });
    useAppearanceStore.setState({ appearance: initialAppearance });
    dom.localStorage.clear();
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("ordinary accounts switch real themes and avatars without changing site configuration", async () => {
    const siteSkin = { ...DEFAULT_CLASSIC_SKIN, id: "site-custom" };
    const siteCanvas = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "测试助手", avatarBundleResourceId: "site-bundle" };
    const site = { ...initialAppearance, activeSkin: siteSkin, canvas: siteCanvas };
    useAppearanceStore.setState({ appearance: site });
    await account("creator-a");
    const output = await render();
    expect(output.dataset.skin).toBe("site-custom");
    expect(output.dataset.bundle).toBe("site-bundle");
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-a", { skinId: "classic", avatar: "classic" });
    });
    expect(output.dataset.skin).toBe("classic");
    expect(output.dataset.type).toBe("bundle");
    expect(output.dataset.bundle).toBe("");
    expect(output.dataset.name).toBe("测试助手");
    expect(useAppearanceStore.getState().appearance).toBe(site);
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-a", { skinId: "longying-ink" });
    });
    expect(output.dataset.skin).toBe("longying-ink");
    await account("creator-b");
    expect(output.dataset.skin).toBe("site-custom");
    expect(output.dataset.bundle).toBe("site-bundle");
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-b", { avatar: "orb" });
    });
    expect(output.dataset.type).toBe("orb");
    await account("creator-a");
    expect(output.dataset.type).toBe("bundle");
    expect(output.dataset.skin).toBe("longying-ink");
    await account(null);
    expect(output.dataset.bundle).toBe("site-bundle");
    expect(output.dataset.skin).toBe("site-custom");
});

test("preferences survive reload, reset to the site default and reject invalid writes", async () => {
    await account("creator-a");
    useAppearancePreferencesStore.getState().update("creator-a", { skinId: "classic", avatar: "orb" });
    const serialized = dom.localStorage.getItem("canvas:personal-appearance");
    expect(serialized).toContain("creator-a");
    useAppearancePreferencesStore.setState({ byUser: {} });
    dom.localStorage.setItem("canvas:personal-appearance", serialized!);
    await useAppearancePreferencesStore.persist.rehydrate();
    const output = await render();
    expect(output.dataset.avatar).toBe("orb");
    expect(output.dataset.skin).toBe("classic");
    expect(() => useAppearancePreferencesStore.getState().update("", { avatar: "orb" })).toThrow();
    expect(() => useAppearancePreferencesStore.getState().update("creator-a", { skinId: "not-installed" })).toThrow();
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-a", { skinId: "", avatar: "site" });
    });
    expect(output.dataset.skin).toBe(initialAppearance.activeSkin.id);
    expect(output.dataset.avatar).toBe("site");
});

test("all supported interface languages include the personal appearance controls", () => {
    expect(Object.keys(personalAppearanceMessages)).toHaveLength(SUPPORTED_LOCALES.length);
    for (const messages of Object.values(personalAppearanceMessages)) {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(personalAppearanceMessages["zh-CN"]).sort());
        expect(Object.values(messages).every((message) => message.trim().length > 0)).toBe(true);
    }
});

test("custom uploads keep private URLs, state mapping and account isolation after reload", async () => {
    await account("creator-a");
    const output = await render();
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-a", { avatar: "custom", customAvatar: { type: "bundle", resourceId: "private-bundle", clipStates: { idle: "idle", running: "work" } } });
    });
    expect(output.dataset.scope).toBe("personal");
    expect(output.dataset.bundle).toBe("private-bundle");
    const serialized = dom.localStorage.getItem("canvas:personal-appearance")!;
    await act(async () => {
        useAppearancePreferencesStore.setState({ byUser: {} });
        dom.localStorage.setItem("canvas:personal-appearance", serialized);
        await useAppearancePreferencesStore.persist.rehydrate();
    });
    expect(output.dataset.bundle).toBe("private-bundle");
    expect(useAppearancePreferencesStore.getState().byUser["creator-a"].customAvatar?.clipStates?.running).toBe("work");
    await account("creator-b");
    expect(output.dataset.scope).toBe("public");
    expect(output.dataset.bundle).not.toBe("private-bundle");
    await account("creator-a");
    await act(async () => {
        useAppearancePreferencesStore.getState().update("creator-a", { avatar: "custom", customAvatar: { type: "live2d", resourceId: "private-model", entry: "model/avatar.model3.json" } });
    });
    expect(output.dataset.type).toBe("live2d");
    expect(output.dataset.entry).toBe("model/avatar.model3.json");
    expect(output.dataset.scope).toBe("personal");
    await account(null);
    expect(output.dataset.scope).toBe("public");
});

test("custom avatar preferences reject unowned URL inputs, missing uploads and invalid clip names", () => {
    const update = useAppearancePreferencesStore.getState().update;
    expect(() => update("creator-a", { avatar: "custom" })).toThrow();
    expect(() => update("creator-a", { customAvatar: { type: "live2d", resourceId: "model", entry: "../avatar.model3.json" } })).toThrow();
    expect(() => update("creator-a", { customAvatar: { type: "bundle", resourceId: "https://other.example/avatar" } })).toThrow();
    expect(() => update("creator-a", { customAvatar: { type: "bundle", resourceId: "private-bundle", clipStates: { idle: "../video" } } })).toThrow();
});
