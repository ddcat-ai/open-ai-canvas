import { App, Button, Form, Input, Modal, Segmented, Select, Switch, Upload, type UploadFile } from "antd";
import { FileArchive, FileText, GitBranch, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { installGitHubSkill, installSkillUpload, type Skill } from "@/services/api/skills";

type InstallMode = "markdown" | "zip" | "github";

type InstallFormValues = {
    name?: string;
    description?: string;
    tag: string;
    is_public: boolean;
    url?: string;
    ref?: string;
    subdir?: string;
    auto_update: boolean;
};

const modeOptions = [
    { value: "markdown", label: <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />Markdown</span> },
    { value: "zip", label: <span className="inline-flex items-center gap-1.5"><FileArchive className="size-3.5" />ZIP 技能包</span> },
    { value: "github", label: <span className="inline-flex items-center gap-1.5"><GitBranch className="size-3.5" />GitHub</span> },
];

export function SkillInstallModal({ open, onClose, onInstalled, onManualCreate }: { open: boolean; onClose: () => void; onInstalled: (skill: Skill) => void; onManualCreate: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<InstallFormValues>();
    const [mode, setMode] = useState<InstallMode>("markdown");
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        if (!open) return;
        setMode("markdown");
        setFileList([]);
        form.setFieldsValue({ tag: "creative", is_public: true, auto_update: true, name: "", description: "", url: "", ref: "", subdir: "" });
    }, [form, open]);

    const install = async () => {
        const values = await form.validateFields();
        const file = fileList[0]?.originFileObj;
        if (mode !== "github" && !file) {
            message.warning(`请选择一个 ${mode === "zip" ? "ZIP 技能包" : "Markdown 文件"}`);
            return;
        }
        setInstalling(true);
        try {
            const result = mode === "github"
                ? await installGitHubSkill({
                    url: values.url || "",
                    ref: values.ref || undefined,
                    subdir: values.subdir || undefined,
                    tag: values.tag,
                    is_private: !values.is_public,
                    auto_update: values.auto_update,
                })
                : await installSkillUpload({
                    file: file as File,
                    source_type: mode,
                    name: values.name || undefined,
                    description: values.description || undefined,
                    tag: values.tag,
                    is_private: !values.is_public,
                });
            message.success("技能已安装");
            onInstalled(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能安装失败");
        } finally {
            setInstalling(false);
        }
    };

    return (
        <Modal
            className="skill-install-modal"
            open={open}
            width={680}
            destroyOnHidden
            maskClosable={!installing}
            title="安装技能"
            onCancel={onClose}
            footer={(
                <div className="flex items-center justify-between gap-3">
                    <Button type="text" onClick={onManualCreate}>从空白创建单文件技能</Button>
                    <div className="flex gap-2"><Button onClick={onClose}>取消</Button><Button type="primary" loading={installing} onClick={() => void install()}>安装技能</Button></div>
                </div>
            )}
        >
            <p className="mb-4 text-sm leading-6 text-foreground/55">支持标准 <code>SKILL.md</code>、包含多层目录的 ZIP 技能包，或公开 GitHub 仓库。名称和简介会优先从技能入口自动读取。</p>
            <Segmented className="skill-install-mode" block options={modeOptions} value={mode} onChange={(value) => { setMode(value as InstallMode); setFileList([]); }} />

            <Form form={form} layout="vertical" requiredMark="optional" className="skill-install-form">
                {mode === "github" ? (
                    <>
                        <Form.Item name="url" label="GitHub 地址" rules={[{ required: true, message: "请填写 GitHub 仓库地址" }, { type: "url", message: "请输入有效链接" }]}>
                            <Input type="url" inputMode="url" spellCheck={false} prefix={<GitBranch className="size-4 text-foreground/35" />} placeholder="https://github.com/owner/repository" />
                        </Form.Item>
                        <div className="grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="ref" label="分支或标签" extra="留空时使用默认分支"><Input spellCheck={false} placeholder="main" /></Form.Item>
                            <Form.Item name="subdir" label="技能子目录" extra="仓库仅含一个技能时可留空"><Input spellCheck={false} placeholder="skills/ai-director" /></Form.Item>
                        </div>
                    </>
                ) : (
                    <>
                        <Upload.Dragger
                            accept={mode === "zip" ? ".zip,application/zip" : ".md,.markdown,text/markdown"}
                            maxCount={1}
                            fileList={fileList}
                            beforeUpload={(file) => {
                                if (file.size > 20 * 1024 * 1024) {
                                    message.error("技能文件不能超过 20MB");
                                    return Upload.LIST_IGNORE;
                                }
                                return false;
                            }}
                            onChange={({ fileList: next }) => setFileList(next.slice(-1))}
                            onRemove={() => { setFileList([]); return true; }}
                        >
                            <UploadCloud className="mx-auto mb-3 size-8 text-foreground/38" />
                            <div className="text-sm font-medium">拖入或选择 {mode === "zip" ? "ZIP 技能包" : "Markdown 文件"}</div>
                            <div className="mt-1 text-xs text-foreground/45">{mode === "zip" ? "根目录或唯一子目录中必须包含 SKILL.md" : "普通 .md 会作为技能入口 SKILL.md 安装"}</div>
                        </Upload.Dragger>
                        <div className="mt-4 grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="name" label="覆盖名称" extra="可选，留空时自动读取"><Input maxLength={80} autoComplete="off" /></Form.Item>
                            <Form.Item name="description" label="覆盖简介" extra="可选，留空时自动读取"><Input maxLength={500} autoComplete="off" /></Form.Item>
                        </div>
                    </>
                )}

                <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name="tag" label="技能分类" rules={[{ required: true, message: "请选择技能分类" }]}>
                        <Select options={fallbackSkillCategories} />
                    </Form.Item>
                    <Form.Item name="is_public" label="公开状态" valuePropName="checked" extra="公开后其他用户可以加入使用。">
                        <Switch checkedChildren="公开" unCheckedChildren="私有" />
                    </Form.Item>
                </div>
                {mode === "github" ? <Form.Item name="auto_update" label="自动同步" valuePropName="checked" extra="后台每 6 小时检查一次提交版本，并记录最近检查与同步时间。"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item> : null}
            </Form>
        </Modal>
    );
}
