import { describe, expect, test } from "bun:test";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { validateSupDancePluginManifest } from "@/supdance/adapters/compatibility";
import {
    BUILTIN_I18N_ENTRIES,
    compileI18nDictionary,
    DEFAULT_SUPDANCE_LANGUAGES,
    getAntdLocaleForCode,
    mergeI18nEntries,
    SUPDANCE_I18N_PLUGIN_ID,
    supdanceI18nPlugin,
    SUPPORTED_LOCALE_CODES,
    SupDanceDomTranslator,
    translateByKey,
    translateSourceText,
    useSupDanceI18nStore,
} from "@/supdance/plugins/i18n";

type MockTextNode = {
    nodeType: 3;
    nodeValue: string;
    parentElement: MockElementNode | null;
    isConnected?: boolean;
};

type MockElementNode = {
    nodeType: 1;
    tagName: string;
    parentElement: MockElementNode | null;
    childNodes: Array<MockElementNode | MockTextNode>;
    attrs: Map<string, string>;
    isConnected?: boolean;
    classList: { contains: (cls: string) => boolean };
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    hasAttribute: (name: string) => boolean;
};

function createMockElement(tagName: string, attrs: Record<string, string> = {}, children: Array<MockElementNode | MockTextNode> = []): MockElementNode {
    const attrMap = new Map<string, string>(Object.entries(attrs));
    const el: MockElementNode = {
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        parentElement: null,
        childNodes: children,
        attrs: attrMap,
        classList: {
            contains: (cls: string) => (attrMap.get("class") ?? "").split(/\s+/).includes(cls),
        },
        getAttribute: (name: string) => attrMap.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
            attrMap.set(name, value);
        },
        hasAttribute: (name: string) => attrMap.has(name),
    };
    for (const child of children) {
        child.parentElement = el;
    }
    return el;
}

function createMockText(text: string): MockTextNode {
    return {
        nodeType: 3,
        nodeValue: text,
        parentElement: null,
    };
}

describe("supdance-i18n plugin architecture and engine", () => {
    test("registers supdance-i18n as a compliant v2 plugin", () => {
        const report = validateSupDancePluginManifest(supdanceI18nPlugin.manifest);
        expect(report.compatible).toBe(true);
        expect(report.errors).toEqual([]);

        const registered = listRegisteredPlugins().find((p) => p.manifest.id === SUPDANCE_I18N_PLUGIN_ID);
        expect(registered).toBeDefined();
        expect(registered?.manifest.name).toBe("站点多语言与实时词条中心");
    });

    test("covers all 6 required languages with complete built-in translations", () => {
        expect(SUPPORTED_LOCALE_CODES).toEqual(["zh-CN", "en-US", "zh-TW", "ja-JP", "ko-KR", "es-ES"]);
        expect(DEFAULT_SUPDANCE_LANGUAGES).toHaveLength(6);
        expect(BUILTIN_I18N_ENTRIES.length).toBeGreaterThanOrEqual(80);

        for (const entry of BUILTIN_I18N_ENTRIES) {
            expect(entry.key).toBeTruthy();
            expect(entry.sourceText).toBeTruthy();
            for (const code of SUPPORTED_LOCALE_CODES) {
                expect(entry.translations[code]?.trim().length).toBeGreaterThan(0);
            }
        }
    });

    test("translates by key, source text, ICU interpolation, and dynamic patterns across 6 languages", () => {
        const entries = mergeI18nEntries({});
        const dict = compileI18nDictionary(entries);

        expect(translateByKey(dict, "nav.projects", "en-US", "zh-CN")).toBe("Short Drama");
        expect(translateByKey(dict, "nav.projects", "zh-TW", "zh-CN")).toBe("短劇製作");
        expect(translateByKey(dict, "nav.projects", "ja-JP", "zh-CN")).toBe("ショートドラマ制作");
        expect(translateByKey(dict, "nav.projects", "ko-KR", "zh-CN")).toBe("숏폼 드라마 제작");
        expect(translateByKey(dict, "nav.projects", "es-ES", "zh-CN")).toBe("Producción de Microdramas");

        // ICU parameter interpolation
        expect(translateByKey(dict, "common.totalCount", "en-US", "zh-CN", { count: 42 })).toBe("Total 42");
        expect(translateByKey(dict, "common.totalCount", "ja-JP", "zh-CN", { count: 42 })).toBe("全 42 件");

        // Source text exact + whitespace-preserving match
        expect(translateSourceText(dict, "  自由画布  ", "en-US", "zh-CN")).toBe("  Infinite Canvas  ");
        expect(translateSourceText(dict, "自由画布", "ko-KR", "zh-CN")).toBe("무한 캔버스");

        // Dynamic regex pattern match
        expect(translateSourceText(dict, "打开积分中心，可用 1,280 积分", "en-US", "zh-CN")).toBe("Open Credits Center, 1,280 available");
        expect(translateSourceText(dict, "已选择 5 项", "es-ES", "zh-CN")).toBe("5 seleccionados");
    });

    test("supports hot-adding custom entries and overriding built-in entries at runtime", () => {
        const store = useSupDanceI18nStore.getState();

        store.upsertLocalEntries([
            {
                key: "custom.specialBanner",
                namespace: "custom",
                sourceText: "限时免费体验",
                translations: {
                    "zh-CN": "限时免费体验",
                    "en-US": "Limited-Time Free Trial",
                    "zh-TW": "限時免費體驗",
                    "ja-JP": "期間限定無料体験",
                    "ko-KR": "기간 한정 무료 체험",
                    "es-ES": "Prueba gratuita por tiempo limitado",
                },
                origin: "custom",
            },
            {
                key: "nav.create",
                namespace: "nav",
                sourceText: "创作",
                translations: {
                    "zh-CN": "创作",
                    "en-US": "AI Studio",
                    "zh-TW": "創作工作坊",
                    "ja-JP": "AIスタジオ",
                    "ko-KR": "AI 스튜디오",
                    "es-ES": "Estudio IA",
                },
                origin: "modified",
            },
        ]);

        const updatedDict = useSupDanceI18nStore.getState().dictionary;
        expect(translateSourceText(updatedDict, "限时免费体验", "en-US", "zh-CN")).toBe("Limited-Time Free Trial");
        expect(translateSourceText(updatedDict, "限时免费体验", "ja-JP", "zh-CN")).toBe("期間限定無料体験");
        expect(translateByKey(updatedDict, "nav.create", "en-US", "zh-CN")).toBe("AI Studio");

        // Reset override and remove custom entry
        store.removeLocalEntry("custom.specialBanner");
        store.removeLocalEntry("nav.create");

        const restoredDict = useSupDanceI18nStore.getState().dictionary;
        expect(translateByKey(restoredDict, "nav.create", "en-US", "zh-CN")).toBe("Create");
    });

    test("DOM translator translates text and attributes and losslessly restores on disable", () => {
        const navCreateText = createMockText("创作");
        const navProjectsText = createMockText("短剧制作");
        const codeText = createMockText("创作");
        const ignoredText = createMockText("创作");

        const searchInput = createMockElement("input", {
            placeholder: "搜索插件名称、ID 或作者",
            "aria-label": "搜索插件",
        });
        const codeBlock = createMockElement("code", {}, [codeText]);
        const ignoredDiv = createMockElement("div", { "data-i18n-ignore": "true" }, [createMockElement("span", {}, [ignoredText])]);
        const root = createMockElement("div", { id: "root" }, [createMockElement("a", {}, [navCreateText]), createMockElement("a", {}, [navProjectsText]), searchInput, codeBlock, ignoredDiv]);

        const dict = compileI18nDictionary(mergeI18nEntries({}));
        const translator = new SupDanceDomTranslator();

        translator.attach(root as unknown as HTMLElement, dict, "en-US", "zh-CN", {
            translateAdminPages: true,
        });

        expect(navCreateText.nodeValue).toBe("Create");
        expect(navProjectsText.nodeValue).toBe("Short Drama");
        expect(searchInput.getAttribute("placeholder")).toBe("Search plugin name, ID or author");
        expect(searchInput.getAttribute("aria-label")).toBe("Search plugins");

        // Code and data-i18n-ignore must remain untouched
        expect(codeText.nodeValue).toBe("创作");
        expect(ignoredText.nodeValue).toBe("创作");

        // Switch to Japanese
        translator.update(dict, "ja-JP", "zh-CN", { translateAdminPages: true });
        expect(navCreateText.nodeValue).toBe("制作");
        expect(navProjectsText.nodeValue).toBe("ショートドラマ制作");

        // Switch to Korean
        translator.update(dict, "ko-KR", "zh-CN", { translateAdminPages: true });
        expect(navCreateText.nodeValue).toBe("창작");
        expect(navProjectsText.nodeValue).toBe("숏폼 드라마 제작");

        // Switch to Spanish
        translator.update(dict, "es-ES", "zh-CN", { translateAdminPages: true });
        expect(navCreateText.nodeValue).toBe("Crear");
        expect(navProjectsText.nodeValue).toBe("Producción de Microdramas");

        // Disable plugin -> lossless restore to original Simplified Chinese
        translator.restoreAndDetach();
        expect(navCreateText.nodeValue).toBe("创作");
        expect(navProjectsText.nodeValue).toBe("短剧制作");
        expect(searchInput.getAttribute("placeholder")).toBe("搜索插件名称、ID 或作者");
        expect(searchInput.getAttribute("aria-label")).toBe("搜索插件");
    });

    test("maps all 6 locales to valid Ant Design locale objects", () => {
        for (const code of SUPPORTED_LOCALE_CODES) {
            const antdLocale = getAntdLocaleForCode(code);
            expect(antdLocale).toBeDefined();
            expect(typeof antdLocale.locale).toBe("string");
        }
    });

    test("compiles custom {var} placeholder entries into dynamic DOM regex rules and preserves modified zh-CN source matching", () => {
        const merged = mergeI18nEntries({
            "nav.create": {
                key: "nav.create",
                namespace: "nav",
                sourceText: "AI 创作中心",
                translations: {
                    "zh-CN": "AI 创作中心",
                    "en-US": "AI Creation Hub",
                    "zh-TW": "AI 創作中心",
                    "ja-JP": "AI制作センター",
                    "ko-KR": "AI 창작 센터",
                    "es-ES": "Centro de Creación IA",
                },
                origin: "modified",
            },
            "custom.shotProgress": {
                key: "custom.shotProgress",
                namespace: "projects",
                sourceText: "第 {shot} 镜 · 耗时 {sec} 秒",
                translations: {
                    "zh-CN": "第 {shot} 镜 · 耗时 {sec} 秒",
                    "en-US": "Shot #{shot} · {sec}s elapsed",
                    "zh-TW": "第 {shot} 鏡 · 耗時 {sec} 秒",
                    "ja-JP": "カット #{shot} · {sec}秒経過",
                    "ko-KR": "샷 #{shot} · {sec}초 소요",
                    "es-ES": "Toma #{shot} · {sec}s transcurridos",
                },
                origin: "custom",
            },
        });

        const dict = compileI18nDictionary(merged);

        // Even though zh-CN was customized to "AI 创作中心", the original DOM text "创作" still matches!
        expect(translateSourceText(dict, "创作", "zh-CN", "zh-CN")).toBe("AI 创作中心");
        expect(translateSourceText(dict, "创作", "en-US", "zh-CN")).toBe("AI Creation Hub");

        // Dynamic {var} placeholder template automatically matches and interpolates DOM strings
        expect(translateSourceText(dict, "第 12 镜 · 耗时 4.5 秒", "en-US", "zh-CN")).toBe("Shot #12 · 4.5s elapsed");
        expect(translateSourceText(dict, "第 12 镜 · 耗时 4.5 秒", "ja-JP", "zh-CN")).toBe("カット #12 · 4.5秒経過");
        expect(translateSourceText(dict, "第 12 镜 · 耗时 4.5 秒", "es-ES", "zh-CN")).toBe("Toma #12 · 4.5s transcurridos");
    });

    test("prunes disconnected DOM nodes, restores deleted custom entries/attributes immediately, and collects untranslated Chinese text", () => {
        const customNode = createMockText("专属自定义按钮");
        customNode.isConnected = true;
        const unknownChineseNode = createMockText("未收录的深层弹窗提示文案");
        unknownChineseNode.isConnected = true;

        const customInput = createMockElement("input", {
            placeholder: "专属自定义输入框",
        });
        customInput.isConnected = true;

        const root = createMockElement("div", { id: "root" }, [createMockElement("button", {}, [customNode]), createMockElement("span", {}, [unknownChineseNode]), customInput]);

        const customDict = compileI18nDictionary(
            mergeI18nEntries({
                "custom.btn": {
                    key: "custom.btn",
                    namespace: "custom",
                    sourceText: "专属自定义按钮",
                    translations: {
                        "zh-CN": "专属自定义按钮",
                        "en-US": "Exclusive Custom Button",
                        "zh-TW": "專屬自訂按鈕",
                        "ja-JP": "専用カスタムボタン",
                        "ko-KR": "전용 커스텀 버튼",
                        "es-ES": "Botón personalizado exclusivo",
                    },
                    origin: "custom",
                },
                "custom.input": {
                    key: "custom.input",
                    namespace: "custom",
                    sourceText: "专属自定义输入框",
                    translations: {
                        "zh-CN": "专属自定义输入框",
                        "en-US": "Exclusive Custom Input",
                        "zh-TW": "專屬自訂輸入框",
                        "ja-JP": "専用カスタム入力欄",
                        "ko-KR": "전용 커스텀 입력란",
                        "es-ES": "Entrada personalizada exclusiva",
                    },
                    origin: "custom",
                },
            }),
        );

        const discovered: string[] = [];
        const translator = new SupDanceDomTranslator();
        translator.attach(root as unknown as HTMLElement, customDict, "en-US", "zh-CN", {
            translateAdminPages: true,
            onUntranslatedText: (text) => discovered.push(text),
        });

        expect(customNode.nodeValue).toBe("Exclusive Custom Button");
        expect(customInput.getAttribute("placeholder")).toBe("Exclusive Custom Input");
        expect(discovered).toContain("未收录的深层弹窗提示文案");
        expect(translator.getTouchedNodeCounts()).toEqual({ textNodes: 1, elements: 1 });

        // Delete custom entries while still viewing en-US -> must immediately restore both text and placeholder to original Chinese
        const baseDict = compileI18nDictionary(mergeI18nEntries({}));
        translator.update(baseDict, "en-US", "zh-CN", { translateAdminPages: true });
        expect(customNode.nodeValue).toBe("专属自定义按钮");
        expect(customInput.getAttribute("placeholder")).toBe("专属自定义输入框");

        // Simulate unmounting nodes from DOM -> pruneDisconnectedNodes frees strong references
        customNode.isConnected = false;
        customInput.isConnected = false;
        const pruned = translator.pruneDisconnectedNodes();
        expect(pruned).toEqual({ prunedTextNodes: 1, prunedElements: 1 });
        expect(translator.getTouchedNodeCounts()).toEqual({ textNodes: 0, elements: 0 });
    });
});
