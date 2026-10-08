import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Input, InputNumber } from "antd";
import { Check, CheckCircle2, ChevronRight, FolderTree, Plus, RefreshCw, Search, Shapes, SlidersHorizontal } from "lucide-react";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminStatusBadge, AdminTableEmpty, SettingsSectionCard } from "./components/admin-ui";
import { AdminSwitch } from "./ui/controls";
import { getSkillCuration, updateSkillCuration, type CurationCategory, type CurationChange, type CurationRoot, type SkillCuration } from "@/services/api/skill-curation";
import { curationIcon, curationIconKeys, curationIconLabels } from "@/components/skills/skill-curation-browser";
import { listSkills, type Skill } from "@/services/api/skills";
import "./skill-curation-page.css";

const emptyRoot = (): CurationRoot => ({ id: "", name: "", iconKey: "shapes", sortOrder: 0, enabled: true });
const emptyCategory = (rootTag = "drama"): CurationCategory => ({ id: "", rootTag, name: "", sortOrder: 0, enabled: true });

type EditorTarget =
    | { kind: "root"; id: string }
    | { kind: "category"; id: string }
    | { kind: "new-root" }
    | { kind: "new-category"; rootTag: string }
    | null;

function normalizeName(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

export default function SkillCurationPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<SkillCuration | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [root, setRoot] = useState<CurationRoot>(emptyRoot);
    const [category, setCategory] = useState<CurationCategory>(emptyCategory);
    const [target, setTarget] = useState<EditorTarget>(null);
    const [search, setSearch] = useState("");
    const [skills, setSkills] = useState<Skill[]>([]);
    const [skillId, setSkillId] = useState("");
    const [assignedRoot, setAssignedRoot] = useState("");
    const [categoryIds, setCategoryIds] = useState<string[]>([]);

    const sortedRoots = useMemo(() => [...(data?.roots || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [data?.roots]);
    const sortedCategories = useMemo(() => [...(data?.categories || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [data?.categories]);
    const categoriesByRoot = useMemo(() => {
        const grouped = new Map<string, CurationCategory[]>();
        sortedCategories.forEach((item) => {
            const list = grouped.get(item.rootTag) || [];
            list.push(item);
            grouped.set(item.rootTag, list);
        });
        return grouped;
    }, [sortedCategories]);
    const orphanCategories = useMemo(() => sortedCategories.filter((item) => !data?.roots?.some((rootItem) => rootItem.id === item.rootTag)), [data?.roots, sortedCategories]);

    const selectedSkill = skills.find((skill) => skill.skillId === skillId);
    const selectedRoot = data?.roots?.find((item) => item.id === assignedRoot);
    const availableCategories = data?.categories.filter((item) => item.enabled && item.rootTag === (assignedRoot || selectedSkill?.tag)) ?? [];
    const selectedEditorRootId = target?.kind === "root" ? target.id : target?.kind === "category" ? category.rootTag : target?.kind === "new-category" ? target.rootTag : "";
    const editorIsRoot = target?.kind === "root" || target?.kind === "new-root";
    const editorIsCategory = target?.kind === "category" || target?.kind === "new-category";
    const editorTitle = target?.kind === "new-root" ? "新增一级分类" : target?.kind === "new-category" ? "新增子分类" : target?.kind === "root" ? `编辑一级分类 · ${root.name || "未命名"}` : target?.kind === "category" ? `编辑子分类 · ${category.name || "未命名"}` : "选择一个分类";
    const editorDescription = editorIsRoot ? "一级分类用于组织技能库的主导航和图示。" : editorIsCategory ? "子分类必须归属于一个启用中的一级分类。" : "从左侧分类树选择一个节点，或先创建新的一级分类。";

    const reload = async () => {
        try {
            setData(await getSkillCuration(true));
            setError("");
        } catch (e) {
            setError(String(e));
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            listSkills({ scope: "public", search, pageSize: 50 })
                .then((result) => {
                    if (!cancelled) setSkills(result.skills);
                })
                .catch((e) => {
                    if (!cancelled) setError(String(e));
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [search]);

    useEffect(() => {
        if (!data || target) return;
        const firstRoot = sortedRoots[0];
        if (firstRoot) {
            setRoot({ ...firstRoot });
            setTarget({ kind: "root", id: firstRoot.id });
        }
    }, [data, sortedRoots, target]);

    useEffect(() => {
        if (!data || !target) return;
        if (target.kind === "root") {
            const next = data.roots?.find((item) => item.id === target.id);
            if (next) setRoot({ ...next });
            else setTarget(null);
        }
        if (target.kind === "category") {
            const next = data.categories.find((item) => item.id === target.id);
            if (next) setCategory({ ...next });
            else setTarget(null);
        }
    }, [data, target]);

    const save = async (change: CurationChange, onSaved?: (next: SkillCuration) => void) => {
        if (!data) return;
        setBusy(true);
        try {
            const next = await updateSkillCuration(data.revision, change);
            setData(next);
            setError("");
            onSaved?.(next);
            message.success("已保存");
            window.dispatchEvent(new Event("canvas-skills-changed"));
        } catch (e) {
            setError(`${String(e)}；请重新加载后核对修改`);
        } finally {
            setBusy(false);
        }
    };

    const selectRoot = (item: CurationRoot) => {
        setRoot({ ...item });
        setTarget({ kind: "root", id: item.id });
    };

    const selectCategory = (item: CurationCategory) => {
        setCategory({ ...item });
        setTarget({ kind: "category", id: item.id });
    };

    const startNewRoot = () => {
        setRoot(emptyRoot());
        setTarget({ kind: "new-root" });
    };

    const startNewCategory = (rootId = selectedEditorRootId) => {
        const nextRootId = rootId && sortedRoots.some((item) => item.id === rootId && item.enabled) ? rootId : sortedRoots.find((item) => item.enabled)?.id || "";
        if (!nextRootId) return;
        setCategory(emptyCategory(nextRootId));
        setTarget({ kind: "new-category", rootTag: nextRootId });
    };

    const resetEditor = () => {
        if (target?.kind === "root") {
            const current = data?.roots?.find((item) => item.id === target.id);
            if (current) setRoot({ ...current });
            return;
        }
        if (target?.kind === "category") {
            const current = data?.categories.find((item) => item.id === target.id);
            if (current) setCategory({ ...current });
            return;
        }
        if (target?.kind === "new-category") {
            setCategory(emptyCategory(target.rootTag));
            return;
        }
        setRoot(emptyRoot());
    };

    const saveRoot = () => {
        const payload = { ...root, name: normalizeName(root.name) };
        void save({ root: payload }, (next) => {
            const saved = next.roots?.find((item) => item.id === payload.id || item.name === payload.name);
            if (saved) {
                setRoot({ ...saved });
                setTarget({ kind: "root", id: saved.id });
            }
        });
    };

    const saveCategory = () => {
        const payload = { ...category, name: normalizeName(category.name) };
        void save({ category: payload }, (next) => {
            const saved = next.categories.find((item) => item.id === payload.id || (item.rootTag === payload.rootTag && item.name === payload.name));
            if (saved) {
                setCategory({ ...saved });
                setTarget({ kind: "category", id: saved.id });
            }
        });
    };

    const selectSkill = (id: string) => {
        const nextRoot = data?.rootAssignments?.find((item) => item.skillId === id)?.rootId || "";
        setSkillId(id);
        setAssignedRoot(nextRoot);
        setCategoryIds(data?.assignments.filter((item) => item.skillId === id).map((item) => item.categoryId) || []);
    };

    return (
        <AdminPageFrame
            title="技能分类"
            description="管理平台技能的一级分类、子分类和技能归属。"
            scroll
            actions={
                <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void reload()} disabled={busy}>
                    重新加载
                </Button>
            }
        >
            <div className="admin-skill-curation">
                {error ? <Alert type="error" showIcon title={error} /> : null}

                <section className="admin-skill-curation-policy" aria-label="平台策展模式">
                    <div className="admin-skill-curation-policy-icon">
                        <SlidersHorizontal className="size-4" aria-hidden="true" />
                    </div>
                    <div className="admin-skill-curation-policy-copy">
                        <div className="admin-skill-curation-policy-title">平台策展模式</div>
                        <p>开启后，技能库会优先使用这里维护的分类和归属；关闭时不影响现有技能展示。</p>
                    </div>
                    <div className="admin-skill-curation-policy-control">
                        <AdminStatusBadge label={data?.enabled ? "已开启" : "未开启"} tone={data?.enabled ? "success" : "neutral"} />
                        <AdminSwitch aria-label="平台策展模式" checked={data?.enabled ?? false} disabled={!data || busy} onChange={(enabled) => void save({ enabled })} />
                    </div>
                </section>

                <div className="admin-skill-curation-workspace">
                    <SettingsSectionCard
                        layout="stacked"
                        className="admin-skill-curation-tree-panel"
                        icon={<FolderTree className="size-4" aria-hidden="true" />}
                        title="分类树"
                        description="选择分类后，在右侧编辑；也可以从这里直接新增。"
                        status={<AdminStatusBadge label={`${(data?.roots?.length ?? 0) + (data?.categories.length ?? 0)} 个节点`} tone="info" />}
                    >
                        <div className="admin-skill-curation-tree-toolbar">
                            <span className="admin-skill-curation-tree-toolbar-label">一级分类与子分类</span>
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={startNewRoot} disabled={busy}>
                                新增一级
                            </Button>
                        </div>
                        <div className="admin-skill-curation-tree-list" role="tree" aria-label="技能分类树">
                            {!data ? (
                                <div className="admin-skill-curation-tree-loading" role="status">
                                    正在加载分类…
                                </div>
                            ) : sortedRoots.length ? (
                                <>
                                    {sortedRoots.map((rootItem) => {
                                        const Icon = curationIcon(rootItem.iconKey);
                                        const children = categoriesByRoot.get(rootItem.id) || [];
                                        const active = (target?.kind === "root" && target.id === rootItem.id) || (target?.kind === "new-category" && target.rootTag === rootItem.id);
                                        return (
                                            <div key={rootItem.id} className="admin-skill-curation-tree-branch">
                                                <div className="admin-skill-curation-tree-node-row">
                                                    <button
                                                        type="button"
                                                        role="treeitem"
                                                        aria-selected={active}
                                                        className={`admin-skill-curation-tree-node admin-skill-curation-tree-node-root${active ? " is-active" : ""}`}
                                                        onClick={() => selectRoot(rootItem)}
                                                    >
                                                        <span className="admin-skill-curation-tree-node-icon">
                                                            <Icon className="size-4" aria-hidden="true" />
                                                        </span>
                                                        <span className="admin-skill-curation-tree-node-copy">
                                                            <span className="admin-skill-curation-tree-node-name">{rootItem.name}</span>
                                                            <span className="admin-skill-curation-tree-node-meta">
                                                                {children.length ? `${children.length} 个子分类` : "暂无子分类"}
                                                                {!rootItem.enabled ? <AdminStatusBadge label="已停用" tone="neutral" /> : null}
                                                            </span>
                                                        </span>
                                                        <ChevronRight className="admin-skill-curation-tree-node-chevron size-4" aria-hidden="true" />
                                                    </button>
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        className="admin-skill-curation-tree-node-add"
                                                        icon={<Plus className="size-3.5" />}
                                                        aria-label={`在${rootItem.name}下新增子分类`}
                                                        title={rootItem.enabled ? "新增子分类" : "启用一级分类后才能新增子分类"}
                                                        onClick={() => startNewCategory(rootItem.id)}
                                                        disabled={busy || !rootItem.enabled}
                                                    />
                                                </div>
                                                {children.length ? (
                                                    <div className="admin-skill-curation-tree-children" role="group">
                                                        {children.map((item) => {
                                                            const childActive = target?.kind === "category" && target.id === item.id;
                                                            return (
                                                                <button
                                                                    key={item.id}
                                                                    type="button"
                                                                    role="treeitem"
                                                                    aria-selected={childActive}
                                                                    className={`admin-skill-curation-tree-node admin-skill-curation-tree-node-child${childActive ? " is-active" : ""}${!item.enabled ? " is-disabled" : ""}`}
                                                                    onClick={() => selectCategory(item)}
                                                                >
                                                                    <span className="admin-skill-curation-tree-node-marker" aria-hidden="true" />
                                                                    <span className="admin-skill-curation-tree-node-copy">
                                                                        <span className="admin-skill-curation-tree-node-name">{item.name}</span>
                                                                        <span className="admin-skill-curation-tree-node-meta">{item.enabled ? "启用中" : "已停用"}</span>
                                                                    </span>
                                                                    <ChevronRight className="admin-skill-curation-tree-node-chevron size-3.5" aria-hidden="true" />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                    {orphanCategories.length ? (
                                        <div className="admin-skill-curation-tree-orphans">
                                            <div className="admin-skill-curation-tree-orphans-title">未关联一级分类</div>
                                            {orphanCategories.map((item) => (
                                                <button key={item.id} type="button" role="treeitem" aria-selected={target?.kind === "category" && target.id === item.id} className={`admin-skill-curation-tree-node admin-skill-curation-tree-node-child${target?.kind === "category" && target.id === item.id ? " is-active" : ""}`} onClick={() => selectCategory(item)}>
                                                    <span className="admin-skill-curation-tree-node-marker" aria-hidden="true" />
                                                    <span className="admin-skill-curation-tree-node-copy">
                                                        <span className="admin-skill-curation-tree-node-name">{item.name}</span>
                                                        <span className="admin-skill-curation-tree-node-meta">{item.enabled ? "启用中" : "已停用"}</span>
                                                    </span>
                                                    <ChevronRight className="admin-skill-curation-tree-node-chevron size-3.5" aria-hidden="true" />
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <AdminTableEmpty
                                    title="还没有一级分类"
                                    description="先创建一个一级分类，再继续添加子分类。"
                                    action={
                                        <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={startNewRoot}>
                                            创建一级分类
                                        </Button>
                                    }
                                />
                            )}
                        </div>
                    </SettingsSectionCard>

                    <div className="admin-skill-curation-detail-column">
                        <SettingsSectionCard
                            layout="stacked"
                            className="admin-skill-curation-editor-panel"
                            icon={<Shapes className="size-4" aria-hidden="true" />}
                            title={editorTitle}
                            description={editorDescription}
                            status={editorIsRoot || editorIsCategory ? <AdminStatusBadge label={target?.kind?.startsWith("new-") ? "新建中" : "已选中"} tone={target?.kind?.startsWith("new-") ? "warning" : "info"} /> : <AdminStatusBadge label="未选择" tone="neutral" />}
                        >
                            {!data ? (
                                <div className="admin-skill-curation-editor-empty" role="status">
                                    正在加载编辑器…
                                </div>
                            ) : editorIsRoot ? (
                                <div className="admin-skill-curation-form" aria-label="一级分类编辑表单">
                                    <div className="admin-skill-curation-editor-context">
                                        <span className="admin-skill-curation-editor-kicker">一级分类</span>
                                        <strong>{root.id ? `正在编辑「${root.name || "未命名"}」` : "准备创建一个新的一级分类"}</strong>
                                        <span>一级分类会显示在技能库主导航中，并决定子分类的归属。</span>
                                    </div>
                                    <div className="admin-skill-curation-fields admin-skill-curation-fields-root">
                                        <label className="admin-skill-curation-field">
                                            <span>分类名称</span>
                                            <Input aria-label="一级分类名称" placeholder="例如：视频创作" maxLength={64} value={root.name} onChange={(e) => setRoot({ ...root, name: e.target.value })} />
                                        </label>
                                        <label className="admin-skill-curation-field is-order">
                                            <span>排序</span>
                                            <InputNumber aria-label="一级分类排序" className="admin-skill-curation-control" precision={0} min={0} value={root.sortOrder} onChange={(sortOrder) => setRoot({ ...root, sortOrder: sortOrder ?? 0 })} />
                                        </label>
                                        <div className="admin-skill-curation-field is-switch">
                                            <span>状态</span>
                                            <div className="admin-skill-curation-switch-row">
                                                <AdminSwitch aria-label="一级分类启用" checked={root.enabled} onChange={(enabled) => setRoot({ ...root, enabled })} />
                                                <span>{root.enabled ? "启用" : "停用"}</span>
                                            </div>
                                        </div>
                                        <div className="admin-skill-curation-field admin-skill-curation-icon-field">
                                            <span>分类图示</span>
                                            <div className="admin-skill-curation-icon-grid" role="radiogroup" aria-label="一级分类图示">
                                                {curationIconKeys.map((key) => {
                                                    const Icon = curationIcon(key);
                                                    const selected = (root.iconKey || "shapes") === key;
                                                    return (
                                                        <button key={key} type="button" role="radio" aria-checked={selected} className={`admin-skill-curation-icon-choice${selected ? " is-selected" : ""}`} onClick={() => setRoot({ ...root, iconKey: key })}>
                                                            <Icon className="size-4" aria-hidden="true" />
                                                            <span>{curationIconLabels[key]}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="admin-skill-curation-form-actions">
                                        <span className="admin-skill-curation-hint">停用一级分类后，技能仍保留原有数据，不再作为可选归类。</span>
                                        <div className="admin-skill-curation-action-buttons">
                                            <Button onClick={resetEditor} disabled={busy || (!root.id && !root.name)}>
                                                {root.id ? "还原" : "清空"}
                                            </Button>
                                            <Button type="primary" icon={root.id ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} loading={busy} disabled={!data || !root.name.trim()} onClick={saveRoot}>
                                                {root.id ? "保存一级分类" : "新增一级分类"}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : editorIsCategory ? (
                                <div className="admin-skill-curation-form" aria-label="子分类编辑表单">
                                    <div className="admin-skill-curation-editor-context">
                                        <span className="admin-skill-curation-editor-kicker">子分类</span>
                                        <strong>{category.id ? `正在编辑「${category.name || "未命名"}」` : "准备创建一个新的子分类"}</strong>
                                        <span>子分类只能在创建后归属于当前一级分类，已保存的子分类不能移动到其他一级分类。</span>
                                    </div>
                                    <div className="admin-skill-curation-fields admin-skill-curation-fields-category">
                                        <div className="admin-skill-curation-field admin-skill-curation-parent-field">
                                            <span>所属一级分类</span>
                                            <div className="admin-skill-curation-direct-list" role="radiogroup" aria-label="所属一级分类">
                                                {sortedRoots.length ? (
                                                    sortedRoots.map((item) => {
                                                        const Icon = curationIcon(item.iconKey);
                                                        const selected = category.rootTag === item.id;
                                                        return (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                role="radio"
                                                                aria-checked={selected}
                                                                className={`admin-skill-curation-direct-choice${selected ? " is-selected" : ""}`}
                                                                disabled={Boolean(category.id) || !item.enabled}
                                                                onClick={() => setCategory({ ...category, rootTag: item.id })}
                                                            >
                                                                <span className="admin-skill-curation-direct-choice-icon">
                                                                    <Icon className="size-3.5" aria-hidden="true" />
                                                                </span>
                                                                <span className="admin-skill-curation-direct-choice-copy">
                                                                    <strong>{item.name}</strong>
                                                                    <small>{item.enabled ? "可用于新建子分类" : "已停用"}</small>
                                                                </span>
                                                                {selected ? <CheckCircle2 className="admin-skill-curation-choice-check size-3.5" aria-hidden="true" /> : null}
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="admin-skill-curation-direct-empty">还没有可用的一级分类</div>
                                                )}
                                            </div>
                                        </div>
                                        <label className="admin-skill-curation-field">
                                            <span>子分类名称</span>
                                            <Input aria-label="分类名称" placeholder="例如：分镜设计" value={category.name} maxLength={64} onChange={(e) => setCategory({ ...category, name: e.target.value })} />
                                        </label>
                                        <label className="admin-skill-curation-field is-order">
                                            <span>排序</span>
                                            <InputNumber aria-label="排序" className="admin-skill-curation-control" value={category.sortOrder} precision={0} min={0} onChange={(sortOrder) => setCategory({ ...category, sortOrder: sortOrder ?? 0 })} />
                                        </label>
                                        <div className="admin-skill-curation-field is-switch">
                                            <span>状态</span>
                                            <div className="admin-skill-curation-switch-row">
                                                <AdminSwitch aria-label="分类启用" checked={category.enabled} onChange={(enabled) => setCategory({ ...category, enabled })} />
                                                <span>{category.enabled ? "启用" : "停用"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="admin-skill-curation-form-actions">
                                        <span className="admin-skill-curation-hint">{category.id ? `正在编辑「${category.name}」` : "新增后即可在技能归类中使用"}</span>
                                        <div className="admin-skill-curation-action-buttons">
                                            <Button onClick={resetEditor} disabled={busy || (!category.id && !category.name)}>
                                                {category.id ? "还原" : "清空"}
                                            </Button>
                                            <Button type="primary" icon={category.id ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} loading={busy} disabled={!data || !category.name.trim() || !category.rootTag} onClick={saveCategory}>
                                                {category.id ? "保存子分类" : "新增子分类"}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="admin-skill-curation-editor-empty">
                                    <AdminTableEmpty
                                        title="还没有选择分类"
                                        description="从左侧选择一个分类，或先创建一个新的一级分类。"
                                        action={
                                            <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={startNewRoot}>
                                                新增一级分类
                                            </Button>
                                        }
                                    />
                                </div>
                            )}
                        </SettingsSectionCard>

                        <SettingsSectionCard
                            layout="stacked"
                            className="admin-skill-curation-assignment-panel"
                            icon={<Check className="size-4" aria-hidden="true" />}
                            title="技能归类"
                            description="搜索公开技能，选择一级分类和它应该出现的子分类。"
                            status={<AdminStatusBadge label={skillId ? "已选择技能" : "等待选择"} tone={skillId ? "success" : "neutral"} />}
                        >
                            <div className="admin-skill-curation-assignment-form" aria-label="技能归类表单">
                                <label className="admin-skill-curation-field admin-skill-curation-assignment-search">
                                    <span>搜索技能</span>
                                    <Input prefix={<Search className="size-3.5" aria-hidden="true" />} aria-label="搜索公开技能" placeholder="按名称搜索公开技能" value={search} onChange={(e) => setSearch(e.target.value)} allowClear />
                                </label>
                                <div className="admin-skill-curation-field admin-skill-curation-skill-field">
                                    <div className="admin-skill-curation-field-heading">
                                        <span>选择技能</span>
                                        <small>{skills.length ? `${skills.length} 个结果` : search ? "没有匹配结果" : "暂无公开技能"}</small>
                                    </div>
                                    <div className="admin-skill-curation-skill-list" role="listbox" aria-label="选择技能">
                                        {skills.length ? (
                                            skills.map((skill) => {
                                                const selected = skill.skillId === skillId;
                                                return (
                                                    <button key={skill.skillId} type="button" role="option" aria-selected={selected} className={`admin-skill-curation-skill-row${selected ? " is-selected" : ""}`} onClick={() => selectSkill(skill.skillId)}>
                                                        <strong>{skill.skillName || skill.skillId}</strong>
                                                        <em>{skill.tag || "未分类"}</em>
                                                        {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                                                    </button>
                                                );
                                            })
                                        ) : (
                                            <div className="admin-skill-curation-direct-empty">{search ? "没有找到匹配的公开技能" : "暂无公开技能"}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="admin-skill-curation-field admin-skill-curation-assignment-root-field">
                                    <div className="admin-skill-curation-field-heading">
                                        <span>技能一级分类</span>
                                        <small>{assignedRoot ? selectedRoot?.name || "已指定分类" : "沿用原始分类"}</small>
                                    </div>
                                    <div className="admin-skill-curation-assign-chips" role="radiogroup" aria-label="技能一级分类">
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={!assignedRoot}
                                            className={`admin-skill-curation-assign-chip${!assignedRoot ? " is-selected" : ""}`}
                                            onClick={() => {
                                                setAssignedRoot("");
                                                setCategoryIds([]);
                                            }}
                                        >
                                            <Shapes className="size-4" aria-hidden="true" />
                                            <span>按原始分类{selectedSkill?.tag ? ` · ${selectedSkill.tag}` : ""}</span>
                                        </button>
                                        {sortedRoots.map((item) => {
                                            const Icon = curationIcon(item.iconKey);
                                            const selected = assignedRoot === item.id;
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={selected}
                                                    className={`admin-skill-curation-assign-chip${selected ? " is-selected" : ""}`}
                                                    disabled={!item.enabled}
                                                    onClick={() => {
                                                        setAssignedRoot(item.id);
                                                        setCategoryIds([]);
                                                    }}
                                                >
                                                    <Icon className="size-4" aria-hidden="true" />
                                                    <span>{item.name}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="admin-skill-curation-field admin-skill-curation-assignment-category-field">
                                    <div className="admin-skill-curation-field-heading">
                                        <span>技能子分类</span>
                                        <small>{selectedSkill ? `${categoryIds.length} 个已选` : "先选择技能"}</small>
                                    </div>
                                    <div className={`admin-skill-curation-assign-chips${!selectedSkill ? " is-disabled" : ""}`} role="listbox" aria-label="技能子分类" aria-multiselectable="true">
                                        {availableCategories.length ? (
                                            availableCategories.map((item) => {
                                                const selected = categoryIds.includes(item.id);
                                                return (
                                                    <button key={item.id} type="button" role="option" aria-selected={selected} aria-pressed={selected} className={`admin-skill-curation-assign-chip${selected ? " is-selected" : ""}`} disabled={!selectedSkill} onClick={() => setCategoryIds((current) => (selected ? current.filter((id) => id !== item.id) : [...current, item.id]))}>
                                                        <span>{item.name}</span>
                                                    </button>
                                                );
                                            })
                                        ) : (
                                            <div className="admin-skill-curation-direct-empty">{selectedSkill ? (selectedRoot || assignedRoot ? "该一级分类暂无启用的子分类" : "原始分类下暂无启用的子分类") : "先选择技能"}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="admin-skill-curation-assignment-footer">
                                    <span className="admin-skill-curation-hint">{selectedSkill ? `当前技能：${selectedSkill.skillName}` : "未选择技能时不会修改任何归类"}</span>
                                    <Button type="primary" loading={busy} disabled={!skillId || !data} onClick={() => void save({ assignment: { skillId, categoryIds, rootId: assignedRoot } })}>
                                        保存技能归类
                                    </Button>
                                </div>
                            </div>
                        </SettingsSectionCard>
                    </div>
                </div>
            </div>
        </AdminPageFrame>
    );
}
