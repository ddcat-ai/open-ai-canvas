import { App, Button, Form, Input } from "antd";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { Minus, Plus, Save, PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { generateSkillDraft } from "@/lib/canvas/skill-drafting";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { createSkill, updateSkill, type Skill, type SkillMutationInput, type SkillShowcaseMedia } from "@/services/api/skills";

type SkillFormValues = Omit<SkillMutationInput, "isPrivate"> & { is_public: boolean };

export function SkillEditorDrawer({ open, skill, onClose, onSaved }: { open: boolean; skill: Skill | null; onClose: () => void; onSaved: (skill: Skill) => void }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SkillFormValues>();
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftIdea, setDraftIdea] = useState("");
    const [drafting, setDrafting] = useState(false);
    const effectiveConfig = useEffectiveConfig();
    const isPackageSkill = Boolean(skill && skill.sourceType !== "markdown" && skill.sourceType !== "builtin" && skill.sourceType !== "");

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            skillName: skill?.skillName || "",
            description: skill?.description || "",
            instruction: skill?.instruction || "",
            tag: skill?.tag || "creative",
            is_public: skill ? !skill.isPrivate : true,
            markdownUrl: skill?.markdownUrl || skill?.sourceUrl || "",
            showcaseMedia: skill?.showcaseMedia || [],
            extraInfo: skill?.extraInfo || "",
        });
        setDirty(false);
    }, [form, open, skill]);

    const requestClose = () => {
        if (!dirty) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃未保存的修改？", content: "当前填写内容不会保留。", okText: "放弃修改", okButtonProps: { danger: true }, cancelText: "继续编辑", onOk: onClose });
    };

    const submit = async (values: SkillFormValues) => {
        setSaving(true);
        try {
            const input: SkillMutationInput = {
                skillName: values.skillName,
                description: values.description,
                instruction: values.instruction || "",
                tag: values.tag,
                isPrivate: !values.is_public,
                markdownUrl: values.markdownUrl || "",
                showcaseMedia: (values.showcaseMedia || []).map((item) => ({ ...item, showcaseUri: item.showcaseUri || "" })),
                extraInfo: values.extraInfo || "",
            };
            const result = skill ? await updateSkill(skill.skillId, input) : await createSkill(input);
            setDirty(false);
            message.success(skill ? "技能已更新" : "技能已创建");
            onSaved(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能保存失败");
        } finally {
            setSaving(false);
        }
    };

    const draftFromIdea = async () => {
        const idea = draftIdea.trim();
        if (!idea) {
            message.warning("请先描述你想沉淀的技能");
            return;
        }
        if (!useConfigStore.getState().isAiConfigReady(effectiveConfig, effectiveConfig.model)) {
            message.info("尚未配置可用的文本模型，请先到设置页配置");
            navigateToSettings({ section: "models", continueCreation: true });
            return;
        }
        setDrafting(true);
        try {
            const draft = await generateSkillDraft(idea, effectiveConfig);
            form.setFieldsValue({
                skillName: draft.skillName || "",
                description: draft.description || "",
                instruction: draft.instruction || "",
                ...(draft.tag ? { tag: draft.tag } : {}),
            });
            setDirty(true);
            message.success("草稿已生成，请检查并调整后保存");
        } catch (error) {
            message.error(error instanceof Error ? `起草失败：${error.message}` : "起草失败");
        } finally {
            setDrafting(false);
        }
    };

    return (
        <AppDrawer className="library-drawer" open={open} size={720} mask={{ closable: !dirty }} title={skill ? "编辑技能" : "创建技能"} onClose={requestClose} extra={<Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={() => form.submit()}>保存技能</Button>}>
            {!isPackageSkill ? <div className="mb-4 rounded-xl border bg-foreground/[.02] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <PenLine className="size-4" />
                    AI 起草
                    <span className="font-normal text-foreground/45">描述想法，一键生成名称、简介与指令草稿（可再编辑）</span>
                </div>
                <Input.TextArea
                    value={draftIdea}
                    onChange={(event) => setDraftIdea(event.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    maxLength={2000}
                    showCount
                    disabled={drafting}
                    placeholder="例如：我要一个竖屏短剧分镜技能——输入剧本段落，输出按景别排列的分镜表，每个镜头包含画面、台词、时长与转场…"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground/45">将使用你的文本模型生成一次草稿</span>
                    <Button type="primary" loading={drafting} disabled={!draftIdea.trim()} icon={<PenLine className="size-4" />} onClick={() => void draftFromIdea()}>生成草稿</Button>
                </div>
            </div> : <div className="mb-4 rounded-xl border bg-foreground/[.02] p-3 text-sm leading-6 text-foreground/58">这是多文件技能包。这里仅编辑名称、简介、分类和展示信息；正文与附属文件请在技能卡片的“编辑”工作台中修改，GitHub 技能请在仓库修改后执行同步。</div>}
            <Form form={form} layout="vertical" requiredMark="optional" onFinish={submit} onValuesChange={() => setDirty(true)}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item name="skillName" label="技能名称" rules={[{ required: true, message: "请填写技能名称" }, { max: 80, message: "最多 80 个字符" }]}>
                        <Input maxLength={80} showCount placeholder="例如：短剧导演分镜" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="tag" label="技能分类" rules={[{ required: true, message: "请选择技能分类" }]}>
                        <Select options={fallbackSkillCategories.map(({ value, label }) => ({ value, label }))} />
                    </Form.Item>
                </div>

                <Form.Item name="description" label="技能简介" rules={[{ required: true, message: "请填写技能简介" }, { max: 500, message: "最多 500 个字符" }]}>
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount placeholder="说明适用场景、输入条件和最终产出" />
                </Form.Item>

                {!isPackageSkill ? <Form.Item name="instruction" label="技能指令" rules={[{ required: true, message: "请填写技能指令" }, { max: 100000, message: "最多 100000 个字符" }]} extra="单文件技能会作为 SKILL.md 安装，Agent 按任务需要读取。">
                    <Input.TextArea className="font-mono text-xs leading-5" autoSize={{ minRows: 14, maxRows: 28 }} maxLength={100000} showCount placeholder="使用 Markdown 编写角色、约束、流程、检查清单和输出格式" />
                </Form.Item> : null}

                <div className="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <Form.Item name="markdownUrl" label={isPackageSkill ? "来源地址" : "Markdown 地址"} rules={[{ type: "url", message: "请输入有效的 HTTP(S) 链接" }]}>
                        <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/SKILL.md" />
                    </Form.Item>
                    <Form.Item name="is_public" label="公开状态" valuePropName="checked" extra="公开后其他用户可以加入使用。">
                        <Switch checkedChildren="公开" unCheckedChildren="私有" />
                    </Form.Item>
                </div>

                <Form.List name="showcaseMedia">
                    {(fields, { add, remove }) => (
                        <section aria-labelledby="skill-media-title">
                            <div className="mb-3 flex items-center justify-between">
                                <div><h3 id="skill-media-title" className="text-sm font-medium">展示媒体</h3><p className="mt-1 text-xs text-foreground/50">可选，最多 8 个公开图片或视频链接。</p></div>
                                <Button disabled={fields.length >= 8} icon={<Plus className="size-4" />} onClick={() => add(emptyMedia())}>添加媒体</Button>
                            </div>
                            <div className="space-y-2">
                                {fields.map((field) => (
                                    <div key={field.key} className="grid grid-cols-[112px_minmax(0,1fr)_36px] gap-2">
                                        <Form.Item {...field} name={[field.name, "type"]} className="mb-0" rules={[{ required: true, message: "选择类型" }]}>
                                            <Select options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, "showcaseUrl"]} className="mb-0" rules={[{ required: true, message: "请填写媒体链接" }, { type: "url", message: "链接格式无效" }]}>
                                            <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/media" />
                                        </Form.Item>
                                        <Button aria-label="移除媒体" title="移除媒体" icon={<Minus className="size-4" />} onClick={() => remove(field.name)} />
                                        <Form.Item {...field} name={[field.name, "showcaseUri"]} hidden><Input /></Form.Item>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </Form.List>

                <Form.Item name="extraInfo" label="补充信息" className="mt-5" rules={[{ max: 2000, message: "最多 2000 个字符" }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} showCount placeholder="版本说明、依赖工具或使用注意事项" />
                </Form.Item>
            </Form>
        </AppDrawer>
    );
}

function emptyMedia(): SkillShowcaseMedia {
    return { type: "image", showcaseUri: "", showcaseUrl: "" };
}
