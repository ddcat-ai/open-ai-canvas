import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Segmented, Select } from "antd";
import { Braces, Image, Layers3, Save, Sparkles } from "lucide-react";

import { StyleAssetBindingModal } from "@/components/canvas/style-asset-binding-modal";
import { createStyleProfileSnapshot, styleProfileValidationMessage, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";

type EditorSection = "identity" | "prompt" | "execution";

type StyleProfileEditorModalProps = {
    open: boolean;
    initialProfile: StyleProfileSnapshot | null;
    saving?: boolean;
    onClose: () => void;
    onSave: (profile: StyleProfileSnapshot, applyToProject: boolean) => void;
};

export function StyleProfileEditorModal({ open, initialProfile, saving = false, onClose, onSave }: StyleProfileEditorModalProps) {
    const { message, modal } = App.useApp();
    const [section, setSection] = useState<EditorSection>("identity");
    const [draft, setDraft] = useState<StyleProfileSnapshot | null>(initialProfile);
    const [baseline, setBaseline] = useState("");
    const [assetsOpen, setAssetsOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const next = initialProfile ? createStyleProfileSnapshot(initialProfile) : null;
        setDraft(next);
        setBaseline(next ? JSON.stringify(next) : "");
        setSection("identity");
        setAssetsOpen(false);
    }, [initialProfile, open]);

    const validationMessage = useMemo(() => draft ? styleProfileValidationMessage(draft) : "风格草稿不存在", [draft]);
    if (!draft) return null;

    const update = (patch: Partial<StyleProfileSnapshot>) => setDraft((current) => current ? { ...current, ...patch } : current);
    const requestClose = () => {
        if (JSON.stringify(draft) === baseline) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃未保存的风格修改？", content: "名称、Prompt、封面和执行配置中的改动都会丢失。", okText: "放弃修改", cancelText: "继续编辑", okButtonProps: { danger: true }, onOk: onClose });
    };
    const submit = (applyToProject: boolean) => {
        if (validationMessage) {
            message.error(validationMessage);
            return;
        }
        onSave(createStyleProfileSnapshot({ ...draft, source: "user" }), applyToProject);
    };

    return (
        <>
            <Modal
                rootClassName="style-profile-editor-modal"
                open={open}
                title={null}
                footer={null}
                centered
                width="min(1120px, calc(100vw - 24px))"
                onCancel={requestClose}
                styles={{ container: { padding: 0 }, body: { padding: 0 } }}
            >
                <div className="flex max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
                    <header className="flex min-h-16 items-center border-b border-border px-4 pr-12 sm:px-5 sm:pr-14">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-foreground/5"><Sparkles className="size-3.5" /></span>
                                <div>
                                    <h2 className="text-sm font-semibold">风格编辑器</h2>
                                    <p className="mt-0.5 truncate text-[var(--fs-tiny)] text-foreground/45">{draft.title || "未命名风格"} · 我的风格</p>
                                </div>
                            </div>
                        </div>
                    </header>

                    <nav className="style-profile-editor-tabs grid shrink-0 grid-cols-3 border-b border-border px-2 sm:flex sm:px-4" role="tablist" aria-label="风格编辑器分区">
                        <EditorTab id="style-profile-tab-identity" panelId="style-profile-panel-identity" active={section === "identity"} icon={<Image className="size-3.5" />} label="基本信息" onClick={() => setSection("identity")} />
                        <EditorTab id="style-profile-tab-prompt" panelId="style-profile-panel-prompt" active={section === "prompt"} icon={<Braces className="size-3.5" />} label="Prompt 规则" onClick={() => setSection("prompt")} />
                        <EditorTab id="style-profile-tab-execution" panelId="style-profile-panel-execution" active={section === "execution"} icon={<Layers3 className="size-3.5" />} label="执行配置" onClick={() => setSection("execution")} />
                    </nav>

                    <div className="style-profile-editor-workspace grid min-h-0 flex-1 lg:grid-cols-3">
                        <StylePreview profile={draft} />
                        <main id={`style-profile-panel-${section}`} className="thin-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5 lg:col-span-2" role="tabpanel" aria-labelledby={`style-profile-tab-${section}`}>
                            {section === "identity" ? <IdentityFields profile={draft} onChange={update} /> : null}
                            {section === "prompt" ? <PromptFields profile={draft} onChange={update} /> : null}
                            {section === "execution" ? <ExecutionFields profile={draft} onChange={update} onEditAssets={() => setAssetsOpen(true)} /> : null}
                        </main>
                    </div>

                    <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <p className={`text-[var(--fs-tiny)] ${validationMessage ? "text-red-500" : "text-foreground/45"}`}>{validationMessage || "保存后进入“我的风格”；应用时会把当前版本复制为项目快照"}</p>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button onClick={requestClose}>取消</Button>
                            <Button icon={<Save className="size-3.5" />} disabled={Boolean(validationMessage)} loading={saving} onClick={() => submit(false)}>保存到我的风格</Button>
                            <Button type="primary" icon={<Sparkles className="size-3.5" />} disabled={Boolean(validationMessage)} loading={saving} onClick={() => submit(true)}>保存并应用</Button>
                        </div>
                    </footer>
                </div>
            </Modal>
            <StyleAssetBindingModal
                open={assetsOpen}
                profile={draft}
                onClose={() => setAssetsOpen(false)}
                onApply={(profile) => {
                    setDraft(profile);
                    setAssetsOpen(false);
                }}
            />
        </>
    );
}

function StylePreview({ profile }: { profile: StyleProfileSnapshot }) {
    return (
        <aside className="style-profile-editor-preview thin-scrollbar min-h-0 overflow-y-auto border-b border-border bg-foreground/5 lg:border-b-0 lg:border-r">
            <div className="relative aspect-video overflow-hidden border-b border-border bg-foreground/5">
                {profile.coverUrl ? <img src={profile.coverUrl} alt={`${profile.title || "未命名风格"}封面`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-foreground/25"><Image className="size-7" /></div>}
                <span className="absolute bottom-3 left-3 rounded bg-background/85 px-2 py-1 text-[var(--fs-tiny)] font-medium backdrop-blur">我的风格</span>
            </div>
            <div className="p-4 sm:p-5">
                <h3 className="text-base font-semibold">{profile.title || "未命名风格"}</h3>
                <p className="mt-1.5 text-xs leading-5 text-foreground/48">{profile.description || "填写简介，让风格库中更容易判断它适合什么项目。"}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.tags.length ? profile.tags.map((tag) => <span key={tag} className="rounded bg-foreground/10 px-2 py-1 text-[var(--fs-tiny)] text-foreground/58">{tag}</span>) : <span className="text-[var(--fs-tiny)] text-foreground/35">暂无标签</span>}
                </div>
                <dl className="mt-5 grid grid-cols-2 border-y border-border py-3 text-[var(--fs-tiny)]">
                    <Metric label="Prompt" value={`${profile.prompt.length} 字`} />
                    <Metric label="负面约束" value={`${profile.negativePrompt?.length || 0} 字`} />
                    <Metric label="执行资产" value={`${profile.assets.length} 个`} />
                    <Metric label="策略" value={profile.executionPolicy === "strict-assets" ? "严格阻止" : "兼容降级"} />
                </dl>
            </div>
        </aside>
    );
}

function IdentityFields({ profile, onChange }: EditorFieldsProps) {
    const selection = profile.selection || {};
    const setSelection = (key: string, value: string) => onChange({ selection: { ...selection, [key]: value } });
    return (
        <div className="space-y-5">
            <SectionHeading title="风格身份" description="名称、封面和标签会出现在“我的风格”中" />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="风格名称" className="sm:col-span-2"><Input maxLength={80} showCount value={profile.title} placeholder="例如：东方志怪 · 工笔暗彩" onChange={(event) => onChange({ title: event.target.value })} /></Field>
                <Field label="风格简介" className="sm:col-span-2"><Input.TextArea maxLength={500} showCount autoSize={{ minRows: 3, maxRows: 6 }} value={profile.description} placeholder="说明适用题材、画面气质和核心辨识度" onChange={(event) => onChange({ description: event.target.value })} /></Field>
                <Field label="封面图 URL" className="sm:col-span-2"><Input value={profile.coverUrl} placeholder="可填写项目资源 URL 或可访问的图片地址" onChange={(event) => onChange({ coverUrl: event.target.value })} /></Field>
                <Field label="标签" className="sm:col-span-2"><Select mode="tags" maxCount={20} tokenSeparators={[",", "，"]} value={profile.tags} placeholder="输入题材、媒介、色彩或质感后回车" onChange={(tags) => onChange({ tags })} /></Field>
            </div>
            <SectionHeading title="辅助标注" description="这些字段用于检索和理解，不会限制你自由编写 Prompt" />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="题材世界"><Input value={selection.world || ""} placeholder="仙侠、都市、悬疑……" onChange={(event) => setSelection("world", event.target.value)} /></Field>
                <Field label="视觉媒介"><Input value={selection.medium || ""} placeholder="真人实拍、二维、水墨……" onChange={(event) => setSelection("medium", event.target.value)} /></Field>
                <Field label="叙事气质"><Input value={selection.tone || ""} placeholder="史诗、克制、轻喜剧……" onChange={(event) => setSelection("tone", event.target.value)} /></Field>
                <Field label="角色造型"><Input value={selection.character || ""} placeholder="写实、半写实、风格化……" onChange={(event) => setSelection("character", event.target.value)} /></Field>
            </div>
        </div>
    );
}

function PromptFields({ profile, onChange }: EditorFieldsProps) {
    return (
        <div className="space-y-5">
            <SectionHeading title="完整风格 Prompt" description="直接定义项目长期稳定的美术系统；这里没有固定组合限制" />
            <Field label="正向 Prompt">
                <Input.TextArea value={profile.prompt} autoSize={{ minRows: 16, maxRows: 28 }} placeholder="填写视觉媒介、角色设计、色彩、材质、建筑世界观、影像基线和一致性规则……" onChange={(event) => onChange({ prompt: event.target.value })} />
            </Field>
            <Field label="推荐负面 Prompt">
                <Input.TextArea value={profile.negativePrompt} autoSize={{ minRows: 6, maxRows: 14 }} placeholder="填写需要全项目避免的媒介漂移、人物错误、材质错误、文字水印等" onChange={(event) => onChange({ negativePrompt: event.target.value })} />
            </Field>
        </div>
    );
}

function ExecutionFields({ profile, onChange, onEditAssets }: EditorFieldsProps & { onEditAssets: () => void }) {
    const enabled = profile.assets.filter((asset) => asset.enabled !== false);
    return (
        <div className="space-y-5">
            <SectionHeading title="生成执行" description="控制模型资产不兼容时是继续使用 Prompt，还是阻止任务" />
            <Field label="执行策略">
                <Segmented
                    block
                    value={profile.executionPolicy || "compatible-fallback"}
                    options={[{ value: "compatible-fallback", label: "兼容降级" }, { value: "strict-assets", label: "严格阻止" }]}
                    onChange={(executionPolicy) => onChange({ executionPolicy: executionPolicy as StyleProfileSnapshot["executionPolicy"] })}
                />
            </Field>
            <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-sm font-medium">执行资产</h4>
                    <p className="mt-1 text-[var(--fs-label)] text-foreground/45">{profile.assets.length} 个已绑定，{enabled.length} 个已启用</p>
                </div>
                <Button icon={<Layers3 className="size-3.5" />} onClick={onEditAssets}>配置 LoRA、模板与参考图</Button>
            </div>
            {profile.assets.length ? <div className="divide-y divide-border border-b border-border">{profile.assets.map((asset) => <div key={asset.id} className="flex items-center gap-3 py-3 text-xs"><span className={`size-1.5 shrink-0 rounded-full ${asset.enabled !== false && asset.status === "validated" ? "bg-emerald-500" : asset.status === "unavailable" ? "bg-red-500" : "bg-amber-500"}`} /><span className="min-w-0 flex-1 truncate font-medium">{asset.title}</span><span className="shrink-0 text-foreground/40">{asset.kind.toUpperCase()} · {asset.status === "validated" ? "已验证" : asset.status === "unavailable" ? "不可用" : "待验证"}</span></div>)}</div> : <div className="grid min-h-36 place-items-center border-b border-border text-center text-xs text-foreground/38">尚未绑定执行资产，当前风格将只通过 Prompt 执行</div>}
            <p className="text-[var(--fs-tiny)] leading-5 text-foreground/42">LoRA 与参考图已支持绑定、验证和兼容判断；具体生成渠道没有原生适配器时，兼容策略会降级到 Prompt，严格策略会阻止生成。</p>
        </div>
    );
}

type EditorFieldsProps = { profile: StyleProfileSnapshot; onChange: (patch: Partial<StyleProfileSnapshot>) => void };

function SectionHeading({ title, description }: { title: string; description: string }) {
    return <div className="border-b border-border pb-3"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[var(--fs-label)] text-foreground/45">{description}</p></div>;
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0 py-1"><dt className="text-foreground/38">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground/65">{value}</dd></div>;
}

function EditorTab({ id, panelId, active, icon, label, onClick }: { id: string; panelId: string; active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            id={id}
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            className={`style-profile-editor-tab relative flex h-11 min-w-0 items-center justify-center gap-2 px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset sm:justify-start ${active ? "is-active text-foreground" : "text-foreground/45 hover:text-foreground/75"}`}
            onClick={onClick}
        >
            {icon}
            <span className="truncate">{label}</span>
        </button>
    );
}
