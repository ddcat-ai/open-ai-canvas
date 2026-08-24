import { App, Button, Drawer, Form, Input, Select, Switch } from "antd";
import { Minus, Plus, Save, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { generateSkillDraft } from "@/lib/canvas/skill-drafting";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { createSkill, updateSkill, type Skill, type SkillMutationInput, type SkillShowcaseMedia } from "@/services/api/skills";
import { useTranslation } from "react-i18next";

type SkillFormValues = Omit<SkillMutationInput, "is_private"> & { is_public: boolean };

export function SkillEditorDrawer({ open, skill, onClose, onSaved }: { open: boolean; skill: Skill | null; onClose: () => void; onSaved: (skill: Skill) => void }) {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SkillFormValues>();
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftIdea, setDraftIdea] = useState("");
    const [drafting, setDrafting] = useState(false);
    const effectiveConfig = useEffectiveConfig();

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            skill_name: skill?.skill_name || "",
            description: skill?.description || "",
            instruction: skill?.instruction || "",
            tag: skill?.tag || "creative",
            is_public: skill ? !skill.is_private : true,
            markdown_url: skill?.markdown_url || "",
            showcase_media: skill?.showcase_media || [],
            extra_info: skill?.extra_info || "",
        });
        setDirty(false);
    }, [form, open, skill]);

    const requestClose = () => {
        if (!dirty) {
            onClose();
            return;
        }
        modal.confirm({ title: t("skills:discard-unsaved-changes"), content: t("skills:what-you-have-entered-will-not-be-kept"), okText: t("skills:discard-changes"), okButtonProps: { danger: true }, cancelText: t("skills:keep-editing"), onOk: onClose });
    };

    const submit = async (values: SkillFormValues) => {
        setSaving(true);
        try {
            const input: SkillMutationInput = {
                skill_name: values.skill_name,
                description: values.description,
                instruction: values.instruction,
                tag: values.tag,
                is_private: !values.is_public,
                markdown_url: values.markdown_url || "",
                showcase_media: (values.showcase_media || []).map((item) => ({ ...item, showcase_uri: item.showcase_uri || "" })),
                extra_info: values.extra_info || "",
            };
            const result = skill ? await updateSkill(skill.skill_id, input) : await createSkill(input);
            setDirty(false);
            message.success(skill ? t("skills:skill-updated") : t("skills:skill-created"));
            onSaved(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("skills:failed-to-save-skill"));
        } finally {
            setSaving(false);
        }
    };

    const draftFromIdea = async () => {
        const idea = draftIdea.trim();
        if (!idea) {
            message.warning(t("skills:describe-the-skill-you-want-to-capture-first"));
            return;
        }
        if (!useConfigStore.getState().isAiConfigReady(effectiveConfig, effectiveConfig.model)) {
            message.info(t("skills:no-text-model-configured-set-one-up-in-settings-first"));
            navigateToSettings({ section: "models", continueCreation: true });
            return;
        }
        setDrafting(true);
        try {
            const draft = await generateSkillDraft(idea, effectiveConfig);
            form.setFieldsValue({
                skill_name: draft.skill_name || "",
                description: draft.description || "",
                instruction: draft.instruction || "",
                ...(draft.tag ? { tag: draft.tag } : {}),
            });
            setDirty(true);
            message.success(t("skills:draft-generated-review-adjust-then-save"));
        } catch (error) {
            message.error(error instanceof Error ? t("skills:drafting-failed-param", { message: error.message }) : t("skills:drafting-failed"));
        } finally {
            setDrafting(false);
        }
    };

    return (
        <Drawer
            className="library-drawer"
            open={open}
            size={720}
            destroyOnHidden
            maskClosable={!dirty}
            title={skill ? t("skills:edit-skill") : t("skills:create-skill-3")}
            onClose={requestClose}
            extra={
                <Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={() => form.submit()}>
                    {t("skills:save-skill")}
                </Button>
            }
        >
            <div className="mb-4 rounded-xl border bg-foreground/[.02] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Wand2 className="size-4" />
                    {t("skills:ai-draft")}
                    <span className="font-normal text-foreground/45">{t("skills:describe-your-idea-and-generate-a-name-summary-and-instruction-draft-in")}</span>
                </div>
                <Input.TextArea
                    value={draftIdea}
                    onChange={(event) => setDraftIdea(event.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    maxLength={2000}
                    showCount
                    disabled={drafting}
                    placeholder={t("skills:e-g-i-want-a-vertical-drama-storyboarding-skill-paste-a-script-and-get-a")}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground/45">{t("skills:your-text-model-will-generate-one-draft")}</span>
                    <Button type="primary" loading={drafting} disabled={!draftIdea.trim()} icon={<Wand2 className="size-4" />} onClick={() => void draftFromIdea()}>
                        {t("skills:generate-draft")}
                    </Button>
                </div>
            </div>
            <Form form={form} layout="vertical" requiredMark="optional" onFinish={submit} onValuesChange={() => setDirty(true)}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item
                        name="skill_name"
                        label={t("skills:skill-name")}
                        rules={[
                            { required: true, message: t("skills:enter-a-skill-name") },
                            { max: 80, message: t("skills:up-to-80-characters") },
                        ]}
                    >
                        <Input maxLength={80} showCount placeholder={t("skills:e-g-drama-director-storyboards")} autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="tag" label={t("skills:skill-category")} rules={[{ required: true, message: t("skills:choose-a-skill-category") }]}>
                        <Select options={fallbackSkillCategories.map(({ value, label }) => ({ value, label }))} />
                    </Form.Item>
                </div>

                <Form.Item
                    name="description"
                    label={t("skills:skill-summary")}
                    rules={[
                        { required: true, message: t("skills:enter-a-skill-summary") },
                        { max: 500, message: t("skills:up-to-500-characters") },
                    ]}
                >
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount placeholder={t("skills:explain-use-cases-input-requirements-and-final-output")} />
                </Form.Item>

                <Form.Item
                    name="instruction"
                    label={t("skills:skill-instructions-2")}
                    rules={[
                        { required: true, message: t("skills:enter-the-skill-instructions") },
                        { max: 100000, message: t("skills:up-to-100000-characters") },
                    ]}
                    extra={t("skills:when-the-canvas-uses-this-skill-these-instructions-are-sent-to-the-model")}
                >
                    <Input.TextArea className="font-mono text-xs leading-5" autoSize={{ minRows: 14, maxRows: 28 }} maxLength={100000} showCount placeholder={t("skills:use-markdown-for-roles-constraints-workflows-checklists-and-output-forma")} />
                </Form.Item>

                <div className="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <Form.Item name="markdown_url" label={t("skills:markdown-url")} rules={[{ type: "url", message: t("skills:enter-a-valid-http-s-link") }]}>
                        <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/SKILL.md" />
                    </Form.Item>
                    <Form.Item name="is_public" label={t("skills:visibility")} valuePropName="checked" extra={t("skills:once-public-other-users-can-adopt-it")}>
                        <Switch checkedChildren={t("skills:public")} unCheckedChildren={t("skills:private-2")} />
                    </Form.Item>
                </div>

                <Form.List name="showcase_media">
                    {(fields, { add, remove }) => (
                        <section aria-labelledby="skill-media-title">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <h3 id="skill-media-title" className="text-sm font-medium">
                                        {t("skills:showcase-media")}
                                    </h3>
                                    <p className="mt-1 text-xs text-foreground/50">{t("skills:optional-up-to-8-public-image-or-video-links")}</p>
                                </div>
                                <Button disabled={fields.length >= 8} icon={<Plus className="size-4" />} onClick={() => add(emptyMedia())}>
                                    {t("skills:add-media")}
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {fields.map((field) => (
                                    <div key={field.key} className="grid grid-cols-[112px_minmax(0,1fr)_36px] gap-2">
                                        <Form.Item {...field} name={[field.name, "type"]} className="mb-0" rules={[{ required: true, message: t("skills:choose-type") }]}>
                                            <Select
                                                options={[
                                                    { value: "image", label: t("skills:image") },
                                                    { value: "video", label: t("skills:video") },
                                                ]}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            {...field}
                                            name={[field.name, "showcase_url"]}
                                            className="mb-0"
                                            rules={[
                                                { required: true, message: t("skills:enter-a-media-link") },
                                                { type: "url", message: t("skills:invalid-link-format") },
                                            ]}
                                        >
                                            <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/media" />
                                        </Form.Item>
                                        <Button aria-label={t("skills:remove-media")} title={t("skills:remove-media")} icon={<Minus className="size-4" />} onClick={() => remove(field.name)} />
                                        <Form.Item {...field} name={[field.name, "showcase_uri"]} hidden>
                                            <Input />
                                        </Form.Item>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </Form.List>

                <Form.Item name="extra_info" label={t("skills:additional-info")} className="mt-5" rules={[{ max: 2000, message: t("skills:up-to-2000-characters") }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} showCount placeholder={t("skills:release-notes-dependencies-or-usage-caveats")} />
                </Form.Item>
            </Form>
        </Drawer>
    );
}

function emptyMedia(): SkillShowcaseMedia {
    return { type: "image", showcase_uri: "", showcase_url: "" };
}
