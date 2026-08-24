import { Alert, App, Button, Input, Segmented, Select, Skeleton, Tabs, Tag } from "antd";
import { RotateCcw, Save, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PromptCodeEditor } from "@/components/prompt/prompt-code-editor";
import { listUserPromptPreferences, resetUserPromptCustomization, updateUserPromptCustomization, type UserPromptCustomization, type UserPromptPreference } from "@/services/api/auth";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type CustomizationMode = UserPromptCustomization["mode"];

const promptDefinitionLocaleKeys: Record<string, { label: string; category: string; description: string }> = {
    art_setup: { label: "art-setup", category: "creation-category", description: "art-setup-description" },
    episode_script: { label: "episode-script", category: "creation-category", description: "episode-script-description" },
    outline_plan: { label: "outline-plan", category: "creation-category", description: "outline-plan-description" },
    storyboard_plan: { label: "storyboard-plan", category: "storyboard-category", description: "storyboard-plan-description" },
    storyboard_repair: { label: "storyboard-repair", category: "storyboard-category", description: "storyboard-repair-description" },
    storyboard_first_frame: { label: "storyboard-first-frame", category: "generation-category", description: "storyboard-first-frame-description" },
    storyboard_video: { label: "storyboard-video", category: "generation-category", description: "storyboard-video-description" },
    character_extract: { label: "character-extract", category: "character-category", description: "character-extract-description" },
    character_turnaround: { label: "character-turnaround", category: "character-category", description: "character-turnaround-description" },
};

export function PromptPreferencesPane() {
    const { t } = useTranslation("canvas");
    const modeOptions = [
        { label: t("settings:follow-platform"), value: "inherit" },
        { label: t("settings:appended-requirements"), value: "append" },
        { label: t("settings:advanced-rewrite"), value: "rewrite" },
    ];
    const { message, modal } = App.useApp();
    const [preferences, setPreferences] = useState<UserPromptPreference[]>([]);
    const [selectedOperation, setSelectedOperation] = useState("");
    const [mode, setMode] = useState<CustomizationMode>("inherit");
    const [appendContent, setAppendContent] = useState("");
    const [rewriteContent, setRewriteContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const requestIdRef = useRef(0);

    const reload = async (preferredOperation?: string) => {
        const reqId = ++requestIdRef.current;
        setLoading(true);
        setLoadError("");
        try {
            const result = await listUserPromptPreferences();
            if (reqId !== requestIdRef.current) return;
            setPreferences(result.preferences);
            setSelectedOperation((current) => preferredOperation || current || result.preferences[0]?.definition.operation || "");
        } catch (error) {
            if (reqId !== requestIdRef.current) return;
            const msg = error instanceof Error ? error.message : t("settings:failed-to-load-prompt-preferences");
            setLoadError(msg);
            message.error(msg);
        } finally {
            if (reqId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const localizedPreferences = useMemo(
        () =>
            preferences.map((preference) => {
                const keys = promptDefinitionLocaleKeys[preference.definition.operation];
                if (!keys) return preference;
                return {
                    ...preference,
                    definition: {
                        ...preference.definition,
                        label: t(`settings:${keys.label}`),
                        category: t(`settings:${keys.category}`),
                        description: t(`settings:${keys.description}`),
                    },
                };
            }),
        [preferences, t],
    );
    const selected = useMemo(() => localizedPreferences.find((item) => item.definition.operation === selectedOperation), [localizedPreferences, selectedOperation]);
    const savedMode = selected?.customization?.mode || "inherit";
    const savedAppendContent = savedMode === "append" ? selected?.customization?.content || "" : "";
    const savedRewriteContent = savedMode === "rewrite" ? selected?.customization?.content || "" : selected?.template?.content || "";
    const activeContent = mode === "append" ? appendContent : mode === "rewrite" ? rewriteContent : "";
    const savedActiveContent = savedMode === "append" ? savedAppendContent : savedMode === "rewrite" ? savedRewriteContent : "";
    const dirty = mode !== savedMode || activeContent !== savedActiveContent;

    const restoreDraft = (preference = selected) => {
        const customization = preference?.customization;
        setMode(customization?.mode || "inherit");
        setAppendContent(customization?.mode === "append" ? customization.content : "");
        setRewriteContent(customization?.mode === "rewrite" ? customization.content : preference?.template?.content || "");
    };

    useEffect(() => {
        restoreDraft(selected);
    }, [selected]);

    useEffect(() => {
        if (!dirty) return undefined;
        const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", preventUnload);
        return () => window.removeEventListener("beforeunload", preventUnload);
    }, [dirty]);

    const selectOperation = (operation: string) => {
        if (operation === selectedOperation) return;
        if (!dirty) {
            setSelectedOperation(operation);
            return;
        }
        modal.confirm({
            title: t("settings:switch-template-and-discard-changes"),
            content: t("settings:this-template-has-unsaved-changes-switching-will-discard-them"),
            okText: t("settings:discard-and-switch"),
            cancelText: t("settings:keep-editing"),
            okButtonProps: { danger: true },
            onOk: () => setSelectedOperation(operation),
        });
    };

    const save = async () => {
        if (!selected) return;
        const content = mode === "append" ? appendContent : mode === "rewrite" ? rewriteContent : "";
        if (mode !== "inherit" && !content.trim()) {
            message.warning(t("settings:enter-your-personal-prompt-content"));
            return;
        }
        setSaving(true);
        try {
            await updateUserPromptCustomization(selected.definition.operation, { mode, content });
            await reload(selected.definition.operation);
            message.success(t("settings:prompt-preferences-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("settings:failed-to-save-prompt-preferences"));
        } finally {
            setSaving(false);
        }
    };

    const reset = () => {
        if (!selected) return;
        modal.confirm({
            title: t("settings:restore-the-platform-template"),
            content: t("settings:this-removes-your-customization-of-param-it-will-follow-the-platform-ver", { label: selected.definition.label }),
            okText: t("settings:restore-platform-template"),
            cancelText: t("settings:cancel"),
            onOk: async () => {
                try {
                    await resetUserPromptCustomization(selected.definition.operation);
                    await reload(selected.definition.operation);
                    message.success(t("settings:platform-template-restored"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("settings:failed-to-restore-platform-template"));
                }
            },
        });
    };

    if (loading && preferences.length === 0) return <Skeleton active paragraph={{ rows: 10 }} />;
    if (loadError && preferences.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Alert type="error" showIcon message={t("settings:failed-to-load-prompt-preferences-2")} description={loadError} />
                <Button icon={<RotateCcw className="size-4" />} onClick={() => void reload()}>
                    {t("settings:retry")}
                </Button>
            </div>
        );
    }
    if (!selected) return <div className="py-16 text-center text-sm text-foreground/50">{t("settings:no-configurable-prompt-templates-yet")}</div>;

    const templateContent = selected.template?.content || t("settings:no-platform-templates-enabled");
    const previewCreative = mode === "inherit" ? templateContent : mode === "append" ? t("settings:param-user-s-personal-creation-requirements-param", { templateContent: templateContent, appendContent: appendContent }) : rewriteContent;
    const outputLabel = selected.definition.outputType === "json" ? selected.definition.schemaKey || "JSON" : t("settings:text");

    return (
        <div className="flex min-h-full flex-col">
            <header className="shrink-0 pb-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <label className="mb-2 block text-xs font-medium text-foreground/55" htmlFor="prompt-template-select">
                            {t("settings:prompt-templates")}
                        </label>
                        <Select
                            id="prompt-template-select"
                            className="w-full max-w-md"
                            value={selectedOperation}
                            onChange={selectOperation}
                            options={localizedPreferences.map((item) => ({
                                value: item.definition.operation,
                                label: `${item.definition.category} · ${item.definition.label}${item.customization && item.customization.mode !== "inherit" ? t("settings:customized") : ""}`,
                            }))}
                        />
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <Button icon={<Undo2 className="size-4" />} disabled={!dirty || saving} onClick={() => restoreDraft()}>
                            {t("settings:revert-changes")}
                        </Button>
                        <Button icon={<RotateCcw className="size-4" />} disabled={!selected.customization || saving} onClick={reset}>
                            {t("settings:restore-platform")}
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save()}>
                            {t("settings:save-changes")}
                        </Button>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold">{selected.definition.label}</h2>
                            <Tag variant="filled">
                                {t("settings:platform-v")}
                                {selected.template?.version || "--"}
                            </Tag>
                            <Tag variant="filled">{outputLabel}</Tag>
                            {dirty ? (
                                <Tag variant="filled" color="warning">
                                    {t("settings:unsaved")}
                                </Tag>
                            ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">{selected.definition.description}</p>
                    </div>
                    <Segmented value={mode} options={modeOptions} onChange={(value) => setMode(value as CustomizationMode)} />
                </div>
            </header>

            {selected.outdated ? <Alert className="mt-4" type="warning" showIcon title={t("settings:platform-template-updated")} description={t("settings:your-advanced-rewrite-is-based-on-an-older-version-keep-the-current-rewr")} /> : null}

            <div className="grid min-h-0 flex-1 gap-4 pt-4 lg:grid-cols-3">
                <section className="flex min-h-0 flex-col lg:col-span-2">
                    <div className="mb-3 shrink-0">
                        <h3 className="text-sm font-semibold">{mode === "inherit" ? t("settings:current-platform-template") : mode === "append" ? t("settings:append-personal-requirements") : t("settings:rewrite-creation-strategy")}</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/50">
                            {mode === "inherit"
                                ? t("settings:automatically-adopts-new-versions-after-platform-upgrades")
                                : mode === "append"
                                  ? t("settings:content-is-appended-after-the-platform-strategy-and-still-inherits-platf")
                                  : t("settings:only-replaces-the-creation-strategy-dynamic-project-data-and-output-cont")}
                        </p>
                    </div>
                    {mode === "append" ? (
                        <Input.TextArea
                            className="min-h-96 resize-none"
                            value={appendContent}
                            maxLength={12000}
                            showCount
                            placeholder={t("settings:e-g-for-a-xianxia-project-use-a-bright-grand-high-definition-casual-dram")}
                            onChange={(event) => setAppendContent(event.target.value)}
                        />
                    ) : (
                        <div className="min-h-96 flex-1 overflow-hidden rounded-md bg-surface-active">
                            <PromptCodeEditor
                                value={mode === "inherit" ? templateContent : rewriteContent}
                                readOnly={mode === "inherit"}
                                ariaLabel={mode === "inherit" ? t("settings:platform-prompt-templates") : t("settings:personal-prompt-rewrites")}
                                onChange={mode === "rewrite" ? setRewriteContent : undefined}
                            />
                        </div>
                    )}
                </section>

                <aside className="min-h-0 pt-4 lg:pl-6 lg:pt-0">
                    <Tabs
                        size="small"
                        items={[
                            {
                                key: "baseline",
                                label: t("settings:platform-baseline"),
                                children: <pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{templateContent}</pre>,
                            },
                            {
                                key: "contract",
                                label: t("settings:output-contract"),
                                children: (
                                    <div>
                                        <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                                            <ShieldCheck className="size-4" />
                                            {t("settings:server-read-only")}
                                        </div>
                                        <pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{selected.definition.outputContract}</pre>
                                    </div>
                                ),
                            },
                            {
                                key: "preview",
                                label: t("settings:final-structure"),
                                children: (
                                    <div className="space-y-5 text-xs leading-6">
                                        <section>
                                            <div className="mb-2 font-medium text-foreground/80">{t("settings:creation-strategy")}</div>
                                            <pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap text-foreground/65">{previewCreative || t("settings:not-filled-in-yet")}</pre>
                                        </section>
                                        <section>
                                            <div className="mb-2 font-medium text-foreground/80">{t("settings:force-appended-at-runtime")}</div>
                                            <p className="text-foreground/55">{t("settings:current-plot-project-style-active-character-versions-canvas-assets-and-p")}</p>
                                        </section>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </aside>
            </div>
        </div>
    );
}
