import { Button, Input, Modal, Segmented, Skeleton, Tooltip, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { Check, ChevronRight, Code2, ExternalLink, File, FileArchive, FileCode2, FileImage, FileText, Folder, FolderOpen, Heart, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatSkillCount, formatSkillDate, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { getSkillFile, listSkillFiles, skillFileRawURL, type Skill, type SkillCategory, type SkillPackageFile, type SkillPackageFileContent } from "@/services/api/skills";

type PreviewMode = "preview" | "source";

export function SkillDetailModal({ skill, loading, mutating, categories, onClose, onAdd, onLike, onEdit, onSync }: { skill: Skill | null; loading: boolean; mutating: boolean; categories: SkillCategory[]; onClose: () => void; onAdd: (skill: Skill) => void; onLike: (skill: Skill) => void; onEdit: (skill: Skill) => void; onSync: (skill: Skill) => void }) {
    const [files, setFiles] = useState<SkillPackageFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [filesError, setFilesError] = useState("");
    const [activePath, setActivePath] = useState("SKILL.md");
    const [content, setContent] = useState<SkillPackageFileContent | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState("");
    const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
    const [pathFilter, setPathFilter] = useState("");

    useEffect(() => {
        if (!skill) {
            setFiles([]);
            setContent(null);
            return;
        }
        let cancelled = false;
        setFilesLoading(true);
        setFilesError("");
        setPathFilter("");
        listSkillFiles(skill.skill_id)
            .then((result) => {
                if (cancelled) return;
                setFiles(result.files);
                const first = result.files.find((file) => file.path === "SKILL.md")?.path || result.files[0]?.path || "";
                setActivePath(first);
            })
            .catch((error) => {
                if (cancelled) return;
                setFiles([]);
                setFilesError(error instanceof Error ? error.message : "技能文件加载失败");
            })
            .finally(() => {
                if (!cancelled) setFilesLoading(false);
            });
        return () => { cancelled = true; };
    }, [skill?.skill_id, skill?.version_id]);

    useEffect(() => {
        if (!skill || !activePath) {
            setContent(null);
            return;
        }
        let cancelled = false;
        setContentLoading(true);
        setContentError("");
        getSkillFile(skill.skill_id, activePath)
            .then((result) => { if (!cancelled) setContent(result.file); })
            .catch((error) => {
                if (cancelled) return;
                setContent(null);
                setContentError(error instanceof Error ? error.message : "文件读取失败");
            })
            .finally(() => { if (!cancelled) setContentLoading(false); });
        return () => { cancelled = true; };
    }, [activePath, skill?.skill_id, skill?.version_id]);

    useEffect(() => {
        setPreviewMode("preview");
    }, [activePath]);

    const visibleFiles = useMemo(() => {
        const needle = pathFilter.trim().toLowerCase();
        return needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files;
    }, [files, pathFilter]);
    const treeData = useMemo(() => buildSkillTree(visibleFiles), [visibleFiles]);
    const filePaths = useMemo(() => new Set(files.map((file) => file.path)), [files]);
    const selectedFile = files.find((file) => file.path === activePath);
    const canPreviewMarkdown = selectedFile?.kind === "markdown" && !content?.binary;

    return (
        <Modal
            className="skill-package-modal"
            open={Boolean(skill)}
            width="82vw"
            footer={null}
            destroyOnHidden
            onCancel={onClose}
            styles={{ container: { height: "82vh", padding: 0, overflow: "hidden" }, body: { height: "100%", padding: 0 } }}
        >
            {skill ? (
                <div className="skill-package-shell">
                    <header className="skill-package-header">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[var(--fs-label)] text-foreground/45">
                                <span>{skillCategoryLabel(skill.tag, categories)}</span><span aria-hidden="true">/</span><span>{sourceLabel(skill.source_type)}</span><span aria-hidden="true">/</span><span>v{skill.version || "1"}</span><span aria-hidden="true">/</span><span>更新于 {formatSkillDate(skill.update_time)}</span>
                            </div>
                            <h1 className="mt-1 truncate text-[var(--fs-heading-lg)] font-semibold text-foreground">{skill.skill_name}</h1>
                            <p className="mt-1 line-clamp-2 max-w-4xl text-sm leading-5 text-foreground/58">{skill.description}</p>
                        </div>
                        <div className="skill-package-actions">
                            {skill.source_type === "github" && skill.is_owner ? <Tooltip title={skill.sync_error || "从 GitHub 检查并同步最新提交"}><Button loading={mutating} icon={<RefreshCw className="size-4" />} onClick={() => onSync(skill)}>同步</Button></Tooltip> : null}
                            {skill.is_owner ? <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(skill)}>编辑</Button> : null}
                            <Button loading={mutating} icon={<Heart className={`size-4 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />} onClick={() => onLike(skill)}>{skill.is_like ? "已收藏" : "收藏"}</Button>
                            <Button type={skill.is_added ? "default" : "primary"} loading={mutating} disabled={skill.is_owner} icon={skill.is_added ? <Check className="size-4" /> : <Plus className="size-4" />} onClick={() => onAdd(skill)}>{skill.is_owner ? "我的技能" : skill.is_added ? "已加入" : "加入技能"}</Button>
                        </div>
                    </header>

                    <div className="skill-package-workspace">
                        <aside className="skill-package-sidebar" aria-label="技能文件">
                            <div className="skill-package-sidebar-summary">
                                <span><FileArchive className="size-3.5" />{skill.file_count || files.length} 个文件</span>
                                <span>{formatBytes(skill.total_bytes)}</span>
                            </div>
                            <Input allowClear size="small" value={pathFilter} onChange={(event) => setPathFilter(event.target.value)} placeholder="筛选文件…" prefix={<File className="size-3.5 text-foreground/30" />} />
                            <div className="skill-package-tree thin-scrollbar">
                                {filesLoading || loading ? <Skeleton active title={false} paragraph={{ rows: 10 }} /> : filesError ? <div className="skill-package-empty">{filesError}</div> : treeData.length ? (
                                    <Tree
                                        blockNode
                                        showIcon
                                        showLine={false}
                                        defaultExpandAll
                                        expandAction="click"
                                        selectedKeys={activePath ? [activePath] : []}
                                        treeData={treeData}
                                        switcherIcon={({ expanded, isLeaf }) => isLeaf ? null : <ChevronRight aria-hidden="true" className={`skill-package-tree-chevron size-3.5 ${expanded ? "is-expanded" : ""}`} />}
                                        onSelect={(keys, info) => { if (!info.node.children?.length && keys[0]) setActivePath(String(keys[0])); }}
                                    />
                                ) : <div className="skill-package-empty">没有匹配文件</div>}
                            </div>
                            <div className="skill-package-sidebar-footer">
                                <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{formatSkillCount(skill.added_count)} 人加入</span>
                                <span>{skill.is_private ? "仅自己可见" : "公开"}</span>
                            </div>
                        </aside>

                        <main className="skill-package-preview">
                            <div className="skill-package-preview-toolbar">
                                <div className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/58">{activePath || "请选择文件"}</div>
                                {canPreviewMarkdown ? <Segmented size="small" value={previewMode} onChange={(value) => setPreviewMode(value as PreviewMode)} options={[{ value: "preview", label: <span className="inline-flex items-center gap-1"><FileText className="size-3.5" />预览</span> }, { value: "source", label: <span className="inline-flex items-center gap-1"><Code2 className="size-3.5" />源码</span> }]} /> : null}
                                {activePath ? <Tooltip title="打开原始文件"><a className="skill-package-raw-link" href={skillFileRawURL(skill.skill_id, activePath)} target="_blank" rel="noreferrer" aria-label="打开原始文件"><ExternalLink className="size-4" /></a></Tooltip> : null}
                            </div>
                            <div className="skill-package-preview-body thin-scrollbar">
                                {contentLoading ? <Skeleton active paragraph={{ rows: 18 }} /> : contentError ? <div className="skill-package-empty">{contentError}</div> : content && selectedFile ? (
                                    <SkillFilePreview skill={skill} file={selectedFile} content={content} mode={previewMode} filePaths={filePaths} onNavigate={setActivePath} />
                                ) : <div className="skill-package-empty">从左侧选择一个文件</div>}
                            </div>
                        </main>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function SkillFilePreview({ skill, file, content, mode, filePaths, onNavigate }: { skill: Skill; file: SkillPackageFile; content: SkillPackageFileContent; mode: PreviewMode; filePaths: Set<string>; onNavigate: (path: string) => void }) {
    const rawURL = skillFileRawURL(skill.skill_id, file.path);
    if (content.binary) {
        if (file.kind === "image") return <div className="skill-package-media-stage"><img src={rawURL} alt={file.path} /></div>;
        if (file.kind === "video") return <div className="skill-package-media-stage"><video src={rawURL} controls playsInline preload="metadata" /></div>;
        if (file.kind === "audio") return <div className="skill-package-media-stage"><audio src={rawURL} controls preload="metadata" /></div>;
        return <div className="skill-package-empty"><FileArchive className="mb-3 size-9" /><div>该文件不支持在线预览</div><a className="mt-3 inline-flex items-center gap-1 text-foreground underline" href={rawURL} target="_blank" rel="noreferrer">打开原始文件<ExternalLink className="size-3.5" /></a></div>;
    }
    if (file.kind === "markdown" && mode === "preview") {
        return <SkillMarkdown source={content.content} currentPath={file.path} filePaths={filePaths} onNavigate={onNavigate} />;
    }
    return <pre className="skill-package-source"><code>{content.content}</code></pre>;
}

function SkillMarkdown({ source, currentPath, filePaths, onNavigate }: { source: string; currentPath: string; filePaths: Set<string>; onNavigate: (path: string) => void }) {
    const navigate = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
        const target = resolveSkillPath(currentPath, href || "");
        if (!target || !filePaths.has(target)) return;
        event.preventDefault();
        onNavigate(target);
    };
    return (
        <article className="skill-package-markdown">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ children, href }) => <a href={href} target={isExternalURL(href) ? "_blank" : undefined} rel={isExternalURL(href) ? "noreferrer" : undefined} onClick={(event) => navigate(event, href)}>{children}</a>,
                    table: ({ children }) => <div className="skill-package-table-wrap"><table>{children}</table></div>,
                    img: ({ src, alt }) => {
                        if (isExternalURL(src)) return <img src={src} alt={alt || ""} loading="lazy" />;
                        const target = resolveSkillPath(currentPath, src || "");
                        if (target && filePaths.has(target)) return <button type="button" className="skill-package-inline-file" onClick={() => onNavigate(target)}><FileImage className="size-4" />{alt || target}</button>;
                        return <span className="skill-package-inline-missing">{alt || src || "图片"}</span>;
                    },
                }}
            >{source}</ReactMarkdown>
        </article>
    );
}

function buildSkillTree(files: SkillPackageFile[]): DataNode[] {
    type MutableNode = DataNode & { children?: MutableNode[]; file?: SkillPackageFile };
    const roots: MutableNode[] = [];
    const folders = new Map<string, MutableNode>();
    for (const file of files) {
        const parts = file.path.split("/");
        let children = roots;
        let prefix = "";
        parts.forEach((part, index) => {
            const isLeaf = index === parts.length - 1;
            prefix = prefix ? `${prefix}/${part}` : part;
            if (isLeaf) {
                children.push({ key: file.path, title: treeTitle(part, file), icon: fileIcon(file), isLeaf: true, file });
                return;
            }
            let folder = folders.get(prefix);
            if (!folder) {
                folder = {
                    key: `folder:${prefix}`,
                    title: <span className="skill-package-folder-title">{part}</span>,
                    icon: ({ expanded }) => expanded ? <FolderOpen aria-hidden="true" className="size-4" /> : <Folder aria-hidden="true" className="size-4" />,
                    children: [],
                };
                folders.set(prefix, folder);
                children.push(folder);
            }
            children = folder.children || [];
        });
    }
    return roots;
}

function treeTitle(name: string, file: SkillPackageFile): ReactNode {
    return <span className="skill-package-tree-title"><span>{name}</span><span>{formatBytes(file.size)}</span></span>;
}

function fileIcon(file: SkillPackageFile) {
    if (file.kind === "markdown" || file.kind === "text") return <FileText aria-hidden="true" className="size-3.5" />;
    if (file.kind === "code") return <FileCode2 aria-hidden="true" className="size-3.5" />;
    if (file.kind === "image") return <FileImage aria-hidden="true" className="size-3.5" />;
    return <File aria-hidden="true" className="size-3.5" />;
}

function resolveSkillPath(currentPath: string, href: string) {
    const cleanHref = href.split("#", 1)[0]?.split("?", 1)[0] || "";
    if (!cleanHref || isExternalURL(cleanHref) || cleanHref.startsWith("/")) return "";
    const base = currentPath.split("/").slice(0, -1);
    let decoded = cleanHref;
    try {
        decoded = decodeURIComponent(cleanHref);
    } catch {
        return "";
    }
    for (const segment of decoded.replaceAll("\\", "/").split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") base.pop();
        else base.push(segment);
    }
    return base.join("/");
}

function isExternalURL(value?: string) {
    return Boolean(value && /^(https?:|mailto:|data:)/i.test(value));
}

function sourceLabel(source: string) {
    if (source === "github") return "GitHub";
    if (source === "zip") return "ZIP 技能包";
    if (source === "builtin") return "内置技能";
    return "Markdown";
}

function formatBytes(value: number) {
    if (!value) return "0 B";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
