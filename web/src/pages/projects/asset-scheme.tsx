import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { BookMarked, Check, Eye, FileText, PenLine, RotateCcw, Search, TriangleAlert, Blocks } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { CHARACTER_VARIABLES, renderAssetPrompt, SCENE_VARIABLES, unknownAssetVariables } from "@/lib/drama/asset-prompt";
import { cn } from "@/lib/utils";
import { getDramaAssetSchemes, type DramaAssetMode, type DramaAssetSchemeCatalog, type DramaAssetSettings, type DramaModelOption } from "@/services/api/drama";
import { getSkillFile, listAddedSkills, listSkillFiles } from "@/services/api/skills";

// 角色/场景参考图方案：开工前选定，设置页可改。保存的是全文提示词，预览就是实际发送的内容。

const PROMPT_LIMIT = 4000;
const CUSTOM_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16"];
/** 场景与道具参考图固定横版，与后端 production.AssetImageRatio 一致。 */
const ASSET_IMAGE_RATIO = "16:9";

function tierLabel(tier: string) {
    return tier.toUpperCase();
}

export function useAssetSchemes() {
    return useQuery({ queryKey: ["drama-asset-schemes"], queryFn: getDramaAssetSchemes, staleTime: 10 * 60_000 });
}

export function defaultAssetSettings(catalog?: DramaAssetSchemeCatalog): DramaAssetSettings | undefined {
    const scheme = catalog?.schemes[0];
    if (!catalog || !scheme) return undefined;
    return { mode: scheme.mode, characterPrompt: scheme.characterPrompt, scenePrompt: catalog.scenePrompt, characterRatio: scheme.ratio };
}

export type AssetPreviewSample = { characterName: string; characterAppearance: string; sceneName: string; sceneAppearance: string; style: string; rules: string };

const FALLBACK_SAMPLE: AssetPreviewSample = { characterName: "主角", characterAppearance: "（作品圣经建立后自动填入角色外貌）", sceneName: "主场景", sceneAppearance: "（作品圣经建立后自动填入环境描述）", style: "写实电影感", rules: "" };

/** 方案示意：用色块画出版式，比文字更快看懂差别。 */
function SchemeGlyph({ mode }: { mode: DramaAssetMode }) {
    if (mode === "portrait")
        return (
            <span className="drama-glyph is-portrait">
                <i />
            </span>
        );
    if (mode === "turnaround")
        return (
            <span className="drama-glyph is-turnaround">
                <i />
                <i />
                <i />
            </span>
        );
    if (mode === "fourview")
        return (
            <span className="drama-glyph is-fourview">
                <i className="is-face" />
                <i />
                <i />
                <i />
                <b />
            </span>
        );
    return (
        <span className="drama-glyph is-custom">
            <PenLine className="size-4" />
        </span>
    );
}

/**
 * imageModel 是当前选中的图片模型：用来只列出它能给出的画幅与分辨率档位，并提前提示保存时会被拒绝的组合。
 */
export function AssetSchemePicker({
    value,
    onChange,
    sample,
    layout = "wide",
    imageModel,
}: {
    value?: DramaAssetSettings;
    onChange: (value: DramaAssetSettings) => void;
    sample?: Partial<AssetPreviewSample>;
    layout?: "wide" | "compact";
    imageModel?: DramaModelOption;
}) {
    const { modal } = App.useApp();
    const catalogQuery = useAssetSchemes();
    const catalog = catalogQuery.data;
    const [tab, setTab] = useState<"character" | "scene">("character");
    const [importOpen, setImportOpen] = useState(false);
    const editorRef = useRef<TextAreaRef>(null);
    const preview = { ...FALLBACK_SAMPLE, ...Object.fromEntries(Object.entries(sample || {}).filter(([, item]) => item)) } as AssetPreviewSample;
    if (!catalog || !value) return <div className="drama-assets is-loading">正在读取参考图方案…</div>;
    // 能力未知（旧后端或模型列表未加载）时不做限制，交给服务端保存时校验。
    const ratios = imageModel?.imageRatios;
    const tiers = imageModel?.imageResolutions || [];
    const ratioProblems = ratios ? [...new Set([ASSET_IMAGE_RATIO, value.characterRatio])].filter((ratio) => !ratios.includes(ratio)) : [];

    const scheme = catalog.schemes.find((item) => item.mode === value.mode);
    const prompt = tab === "character" ? value.characterPrompt : value.scenePrompt;
    const variables = tab === "character" ? CHARACTER_VARIABLES : SCENE_VARIABLES;
    const defaultPrompt = tab === "character" ? scheme?.characterPrompt || catalog.schemes[0].characterPrompt : catalog.scenePrompt;
    const unknown = unknownAssetVariables(prompt, variables);
    const modified = prompt.trim() !== defaultPrompt.trim();
    const rendered =
        tab === "character"
            ? renderAssetPrompt(prompt, { 角色名称: preview.characterName, 角色设定: preview.characterAppearance, 项目画风: preview.style, 画面规则: preview.rules })
            : renderAssetPrompt(prompt, { 场景名称: preview.sceneName, 场景设定: preview.sceneAppearance, 项目画风: preview.style, 画面规则: preview.rules });

    const setPrompt = (next: string) => onChange(tab === "character" ? { ...value, characterPrompt: next } : { ...value, scenePrompt: next });
    const chooseMode = (mode: DramaAssetMode) => {
        if (mode === value.mode) return;
        const target = catalog.schemes.find((item) => item.mode === mode);
        const apply = () =>
            onChange({
                ...value,
                mode,
                characterPrompt: target ? target.characterPrompt : value.characterPrompt,
                characterRatio: target ? target.ratio : value.characterRatio,
                sourceSkillId: target ? undefined : value.sourceSkillId,
                sourceSkillName: target ? undefined : value.sourceSkillName,
                sourcePath: target ? undefined : value.sourcePath,
            });
        const characterModified = scheme ? value.characterPrompt.trim() !== scheme.characterPrompt.trim() : true;
        if (target && characterModified) {
            modal.confirm({ title: `切换为「${target.name}」？`, content: "当前角色提示词有修改，切换后会替换为该方案的默认提示词。", okText: "切换", cancelText: "保留当前", centered: true, onOk: apply });
            return;
        }
        apply();
    };
    const insertVariable = (variable: string) => {
        const element = editorRef.current?.resizableTextArea?.textArea;
        const start = element?.selectionStart ?? prompt.length;
        const end = element?.selectionEnd ?? prompt.length;
        setPrompt(prompt.slice(0, start) + variable + prompt.slice(end));
        window.requestAnimationFrame(() => {
            element?.focus();
            element?.setSelectionRange(start + variable.length, start + variable.length);
        });
    };

    const schemes: Array<{ mode: DramaAssetMode; name: string; description: string; ratio: string }> = [
        ...catalog.schemes,
        { mode: "custom", name: "自定义", description: "自己写约束或从技能导入，例如团队的资产卡规范；可自选参考图画幅。", ratio: value.mode === "custom" ? value.characterRatio : "自选" },
    ];

    return (
        <section className={cn("drama-assets", layout === "compact" && "is-compact")} aria-label="参考图方案">
            <div className="drama-assets-schemes" role="radiogroup" aria-label="角色参考图方案">
                {schemes.map((item) => (
                    <button key={item.mode} type="button" role="radio" aria-checked={value.mode === item.mode} className="drama-assets-scheme" onClick={() => chooseMode(item.mode)}>
                        <SchemeGlyph mode={item.mode} />
                        <span className="drama-assets-scheme-copy">
                            <strong>
                                {item.name}
                                <em>{item.ratio}</em>
                            </strong>
                            <span>{item.description}</span>
                        </span>
                        {value.mode === item.mode ? (
                            <span className="drama-assets-check" aria-hidden>
                                <Check className="size-3" />
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>
            {value.mode === "custom" ? (
                <div className="drama-assets-ratio">
                    <span>角色参考图画幅</span>
                    <div className="drama-tabs" role="radiogroup" aria-label="角色参考图画幅">
                        {CUSTOM_RATIOS.map((ratio) => {
                            const unsupported = Boolean(ratios && !ratios.includes(ratio));
                            return (
                                <button
                                    key={ratio}
                                    type="button"
                                    role="radio"
                                    className="drama-tab"
                                    aria-checked={value.characterRatio === ratio}
                                    disabled={unsupported && value.characterRatio !== ratio}
                                    title={unsupported ? "所选图片模型没有接近这个画幅的尺寸" : undefined}
                                    onClick={() => onChange({ ...value, characterRatio: ratio })}
                                >
                                    {ratio}
                                </button>
                            );
                        })}
                    </div>
                    <small>画幅通过尺寸参数发给图片模型；模型给不出接近的尺寸时不能选择</small>
                </div>
            ) : null}
            {imageModel ? (
                <div className="drama-assets-ratio">
                    <span>参考图分辨率</span>
                    {tiers.length ? (
                        <div className="drama-tabs" role="radiogroup" aria-label="参考图分辨率">
                            <button type="button" role="radio" className="drama-tab" aria-checked={!value.resolution} onClick={() => onChange({ ...value, resolution: undefined })}>
                                模型默认{imageModel.defaultImageResolution ? ` · ${tierLabel(imageModel.defaultImageResolution)}` : ""}
                            </button>
                            {tiers.map((tier) => (
                                <button key={tier} type="button" role="radio" className="drama-tab" aria-checked={value.resolution === tier} onClick={() => onChange({ ...value, resolution: tier })}>
                                    {tierLabel(tier)}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <small>所选图片模型不提供分辨率档位，按模型默认尺寸出图</small>
                    )}
                    {tiers.length ? <small>分辨率越高越清晰、单张越贵；参考图主要用于保持人物与场景一致，一般 1K–2K 足够</small> : null}
                </div>
            ) : null}
            {ratioProblems.length ? (
                <p className="drama-assets-warning" role="alert">
                    <TriangleAlert className="size-3.5" />
                    所选图片模型给不出 {ratioProblems.join("、")} 画幅的参考图，保存时会被拒绝。请在“模型”里换用能指定这个尺寸的图片模型{value.mode === "custom" ? "，或改角色参考图画幅" : ""}。
                </p>
            ) : null}
            {value.resolution && imageModel && !tiers.includes(value.resolution) ? (
                <p className="drama-assets-warning" role="alert">
                    <TriangleAlert className="size-3.5" />
                    所选图片模型不支持 {tierLabel(value.resolution)} 分辨率，保存时会被拒绝，请改选上面的档位。
                </p>
            ) : null}

            <div className="drama-assets-editor">
                <div className="drama-assets-editor-head">
                    <div className="drama-tabs" role="tablist" aria-label="提示词对象">
                        <button type="button" role="tab" className="drama-tab" aria-selected={tab === "character"} onClick={() => setTab("character")}>
                            角色提示词
                        </button>
                        <button type="button" role="tab" className="drama-tab" aria-selected={tab === "scene"} onClick={() => setTab("scene")}>
                            场景提示词
                        </button>
                    </div>
                    {modified ? <span className="drama-assets-badge">已修改</span> : <span className="drama-assets-badge is-muted">默认</span>}
                    <div className="ml-auto flex gap-2">
                        <Button size="small" type="text" icon={<BookMarked className="size-3.5" />} onClick={() => setImportOpen(true)}>
                            从技能导入
                        </Button>
                        <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} disabled={!modified} onClick={() => setPrompt(defaultPrompt)}>
                            恢复默认
                        </Button>
                    </div>
                </div>
                <div className="drama-assets-variables" aria-label="插入变量">
                    <span>插入变量</span>
                    {variables.map((variable) => (
                        <button key={variable} type="button" onClick={() => insertVariable(variable)}>
                            {variable.slice(2, -2)}
                        </button>
                    ))}
                </div>
                <Input.TextArea
                    ref={editorRef}
                    value={prompt}
                    maxLength={PROMPT_LIMIT}
                    showCount
                    autoSize={{ minRows: layout === "compact" ? 5 : 6, maxRows: 16 }}
                    onChange={(event) => setPrompt(event.target.value)}
                    aria-label={tab === "character" ? "角色参考图提示词" : "场景参考图提示词"}
                    status={unknown.length ? "error" : undefined}
                />
                {unknown.length ? (
                    <p className="drama-assets-warning">
                        <TriangleAlert className="size-3.5" />
                        不支持的变量：{unknown.join("、")}。保存时会被拒绝，可用变量见上方。
                    </p>
                ) : null}
                {tab === "character" && value.sourceSkillName ? (
                    <p className="drama-assets-source">
                        <Blocks className="size-3.5" />
                        约束来自技能「{value.sourceSkillName}」{value.sourcePath ? ` · ${value.sourcePath}` : ""}
                    </p>
                ) : null}
                <div className="drama-assets-preview">
                    <div className="drama-assets-preview-head">
                        <Eye className="size-3.5" />
                        实际发送预览<span>以「{tab === "character" ? preview.characterName : preview.sceneName}」为例</span>
                    </div>
                    <p>{rendered}</p>
                    {tab === "character" && scheme ? <small>参考图版式说明：{scheme.frameHint}</small> : null}
                </div>
            </div>
            <SkillPromptImportModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={({ text, skillId, skillName, path }) => {
                    const next = /\{\{角色名称\}\}|\{\{角色设定\}\}/.test(text) ? text : `${text.trim()}\n\n【本角色】{{角色名称}}：{{角色设定}}。画风：{{项目画风}}。{{画面规则}}`;
                    onChange({ ...value, mode: value.mode === "custom" ? "custom" : value.mode, characterPrompt: next.slice(0, PROMPT_LIMIT), sourceSkillId: skillId, sourceSkillName: skillName, sourcePath: path });
                    setTab("character");
                    setImportOpen(false);
                }}
            />
        </section>
    );
}

/** 从已添加技能里挑一份文本，选中段落导入为角色约束提示词。 */
function SkillPromptImportModal({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (input: { text: string; skillId: string; skillName: string; path: string }) => void }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [skillId, setSkillId] = useState("");
    const [path, setPath] = useState("");
    const contentRef = useRef<HTMLPreElement>(null);
    const skillsQuery = useQuery({ queryKey: ["skills", "added"], queryFn: listAddedSkills, enabled: open, staleTime: 30_000 });
    const skills = useMemo(() => (skillsQuery.data?.skills || []).filter((skill) => !keyword.trim() || `${skill.skillName} ${skill.description}`.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, skillsQuery.data]);
    const skill = skillsQuery.data?.skills.find((item) => item.skillId === skillId);
    const filesQuery = useQuery({ queryKey: ["skills", skillId, "files"], queryFn: () => listSkillFiles(skillId), enabled: open && Boolean(skillId), staleTime: 60_000 });
    const files = (filesQuery.data?.files || []).filter((file) => file.kind === "markdown" || file.kind === "text");
    const fileQuery = useQuery({ queryKey: ["skills", skillId, "file", path], queryFn: () => getSkillFile(skillId, path), enabled: open && Boolean(skillId && path), staleTime: 60_000 });
    const content = fileQuery.data?.file.content || "";

    const importText = (whole: boolean) => {
        const selection = window.getSelection();
        const selected = selection && contentRef.current && contentRef.current.contains(selection.anchorNode) ? selection.toString() : "";
        const text = whole ? content : selected;
        if (!text.trim()) {
            message.info("先在右侧原文中选中要导入的段落");
            return;
        }
        if (text.length > PROMPT_LIMIT) message.warning(`内容超过 ${PROMPT_LIMIT} 字，已截断；建议只选中资产卡相关的段落`);
        onImport({ text: text.slice(0, PROMPT_LIMIT), skillId, skillName: skill?.skillName || "", path });
    };

    return (
        <AppModal open={open} onCancel={onClose} footer={null} width={1080} flush title={null} centered>
            <div className="drama-skill-import">
                <header className="drama-skill-import-head">
                    <div>
                        <strong>从技能导入参考图约束</strong>
                        <span>选择技能里的规范文档，选中资产卡相关段落导入；导入后仍可编辑。</span>
                    </div>
                </header>
                <div className="drama-skill-import-body">
                    <aside>
                        <Input size="small" prefix={<Search className="size-3.5" />} allowClear placeholder="搜索已添加的技能" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                        <div className="drama-skill-import-list thin-scrollbar">
                            {skills.map((item) => (
                                <button
                                    key={item.skillId}
                                    type="button"
                                    aria-pressed={item.skillId === skillId}
                                    onClick={() => {
                                        setSkillId(item.skillId);
                                        setPath("");
                                    }}
                                >
                                    <strong>{item.skillName}</strong>
                                    <span>{item.description || "—"}</span>
                                </button>
                            ))}
                            {!skillsQuery.isLoading && !skills.length ? <ImportEmpty>还没有添加技能，可在「技能」页面添加后再导入。</ImportEmpty> : null}
                        </div>
                    </aside>
                    <aside>
                        <div className="drama-skill-import-caption">{skill ? `${skill.skillName} · ${files.length} 份文本` : "文件"}</div>
                        <div className="drama-skill-import-list thin-scrollbar">
                            {files.map((file) => (
                                <button key={file.path} type="button" className="is-file" aria-pressed={file.path === path} onClick={() => setPath(file.path)}>
                                    <FileText className="size-3.5 shrink-0" />
                                    <span title={file.path}>{file.path}</span>
                                </button>
                            ))}
                            {skillId && !filesQuery.isLoading && !files.length ? <ImportEmpty>这个技能没有可导入的文本文件。</ImportEmpty> : null}
                            {!skillId ? <ImportEmpty>先在左侧选择技能</ImportEmpty> : null}
                        </div>
                    </aside>
                    <section>
                        <div className="drama-skill-import-caption">
                            {path || "原文"}
                            {content ? <span>{content.length.toLocaleString("zh-CN")} 字</span> : null}
                        </div>
                        <pre ref={contentRef} className="drama-skill-import-content thin-scrollbar">
                            {fileQuery.isLoading ? "正在读取…" : content || "选择文件后在这里查看原文，用鼠标选中需要的段落。"}
                        </pre>
                    </section>
                </div>
                <footer className="drama-skill-import-foot">
                    <span>
                        未包含 {"{{角色名称}}"} / {"{{角色设定}}"} 时，导入后会在末尾自动补上本角色信息。
                    </span>
                    <Button onClick={onClose}>取消</Button>
                    <Button disabled={!content} onClick={() => importText(true)}>
                        导入整份文件
                    </Button>
                    <Button type="primary" disabled={!content} onClick={() => importText(false)}>
                        导入选中内容
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}

function ImportEmpty({ children }: { children: ReactNode }) {
    return <div className="drama-skill-import-empty">{children}</div>;
}
