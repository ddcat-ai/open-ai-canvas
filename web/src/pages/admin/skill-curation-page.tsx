import { useEffect, useState } from "react";
import { Alert, App, Button, Input, InputNumber, Select } from "antd";
import { Check, Edit3, Plus, RefreshCw, Shapes, SlidersHorizontal } from "lucide-react";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, SettingsSectionCard } from "./components/admin-ui";
import { AdminSwitch } from "./ui/controls";
import { getSkillCuration, updateSkillCuration, type CurationCategory, type CurationChange, type CurationRoot, type SkillCuration } from "@/services/api/skill-curation";
import { curationIcon, curationIconKeys, curationIconLabels } from "@/components/skills/skill-curation-browser";
import { listSkills, type Skill } from "@/services/api/skills";
import "./skill-curation-page.css";

const emptyRoot = (): CurationRoot => ({ id: "", name: "", iconKey: "shapes", sortOrder: 0, enabled: true });
const emptyCategory = (rootTag = "drama"): CurationCategory => ({ id: "", rootTag, name: "", sortOrder: 0, enabled: true });

export default function SkillCurationPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<SkillCuration | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [root, setRoot] = useState<CurationRoot>(emptyRoot);
    const [category, setCategory] = useState<CurationCategory>(emptyCategory);
    const [search, setSearch] = useState("");
    const [skills, setSkills] = useState<Skill[]>([]);
    const [skillId, setSkillId] = useState("");
    const [assignedRoot, setAssignedRoot] = useState("");
    const [categoryIds, setCategoryIds] = useState<string[]>([]);

    const selectedSkill = skills.find((skill) => skill.skillId === skillId);
    const selectedRoot = data?.roots?.find((item) => item.id === assignedRoot);
    const availableCategories = data?.categories.filter((item) => item.enabled && item.rootTag === (assignedRoot || selectedSkill?.tag)) ?? [];

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

    const save = async (change: CurationChange) => {
        if (!data) return;
        setBusy(true);
        try {
            setData(await updateSkillCuration(data.revision, change));
            setError("");
            message.success("已保存");
            window.dispatchEvent(new Event("canvas-skills-changed"));
        } catch (e) {
            setError(`${String(e)}；请重新加载后核对修改`);
        } finally {
            setBusy(false);
        }
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

                <div className="admin-skill-curation-grid">
                    <SettingsSectionCard
                        layout="stacked"
                        className="admin-skill-curation-panel"
                        icon={<Shapes className="size-4" aria-hidden="true" />}
                        title="分类维护"
                        description="先维护一级分类和子分类，再把公开技能归入对应分类。"
                        status={<AdminStatusBadge label={`${(data?.roots?.length ?? 0) + (data?.categories.length ?? 0)} 个分类`} tone="info" />}
                    >
                        <div className="admin-skill-curation-form" aria-label="一级分类编辑表单">
                            <div className="admin-skill-curation-section-heading">
                                <div>
                                    <h3>一级分类</h3>
                                    <p>一级分类用于组织技能库的主导航和图示。</p>
                                </div>
                                {root.id ? <AdminStatusBadge label={`正在编辑「${root.name}」`} tone="warning" /> : null}
                            </div>
                            <div className="admin-skill-curation-fields admin-skill-curation-fields-root">
                                <label className="admin-skill-curation-field">
                                    <span>分类名称</span>
                                    <Input aria-label="一级分类名称" placeholder="例如：视频创作" maxLength={64} value={root.name} onChange={(e) => setRoot({ ...root, name: e.target.value })} />
                                </label>
                                <label className="admin-skill-curation-field">
                                    <span>分类图示</span>
                                    <Select
                                        aria-label="一级分类图示"
                                        className="admin-skill-curation-control"
                                        value={root.iconKey || "shapes"}
                                        options={curationIconKeys.map((key) => {
                                            const Icon = curationIcon(key);
                                            return {
                                                value: key,
                                                label: (
                                                    <span className="admin-skill-curation-icon-option">
                                                        <Icon className="size-3.5" />
                                                        {curationIconLabels[key]}
                                                    </span>
                                                ),
                                            };
                                        })}
                                        onChange={(iconKey) => setRoot({ ...root, iconKey })}
                                    />
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
                            </div>
                            <div className="admin-skill-curation-form-actions">
                                <span className="admin-skill-curation-hint">停用一级分类后，技能仍保留原有数据，不再作为可选归类。</span>
                                <div className="admin-skill-curation-action-buttons">
                                    <Button onClick={() => setRoot(emptyRoot())} disabled={busy || (!root.id && !root.name)}>
                                        清空
                                    </Button>
                                    <Button type="primary" icon={root.id ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} loading={busy} disabled={!data || !root.name.trim()} onClick={() => void save({ root })}>
                                        {root.id ? "保存一级分类" : "新增一级分类"}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="admin-skill-curation-table-wrap">
                            <AdminDataTable<CurationRoot>
                                className="admin-skill-curation-table"
                                table={{
                                    rowKey: "id",
                                    dataSource: data?.roots || [],
                                    pagination: false,
                                    loading: !data,
                                    columns: [
                                        { title: "一级分类", dataIndex: "name" },
                                        {
                                            title: "图示",
                                            width: 88,
                                            render: (_, item) => {
                                                const Icon = curationIcon(item.iconKey);
                                                return <Icon className="size-4" aria-hidden="true" />;
                                            },
                                        },
                                        { title: "排序", dataIndex: "sortOrder", width: 78, align: "center" },
                                        { title: "状态", width: 90, render: (_, item) => <AdminStatusBadge label={item.enabled ? "启用" : "停用"} tone={item.enabled ? "success" : "neutral"} /> },
                                        {
                                            title: "操作",
                                            width: 90,
                                            render: (_, item) => (
                                                <Button type="text" size="small" className="admin-row-action admin-row-action-primary" icon={<Edit3 className="size-3.5" />} onClick={() => setRoot({ ...item })}>
                                                    编辑
                                                </Button>
                                            ),
                                        },
                                    ],
                                }}
                                empty={
                                    <AdminTableEmpty
                                        title="还没有一级分类"
                                        description="先创建一个一级分类，再继续添加子分类。"
                                        action={
                                            <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={() => document.querySelector<HTMLInputElement>("[aria-label=一级分类名称]")?.focus()}>
                                                创建一级分类
                                            </Button>
                                        }
                                    />
                                }
                            />
                        </div>

                        <div className="admin-skill-curation-subsection">
                            <div className="admin-skill-curation-section-heading">
                                <div>
                                    <h3>子分类</h3>
                                    <p>子分类必须归属于一个启用中的一级分类。</p>
                                </div>
                            </div>
                            <div className="admin-skill-curation-fields admin-skill-curation-fields-category">
                                <label className="admin-skill-curation-field">
                                    <span>所属一级分类</span>
                                    <Select
                                        aria-label="所属一级分类"
                                        className="admin-skill-curation-control"
                                        value={category.rootTag}
                                        disabled={Boolean(category.id)}
                                        options={data?.roots?.map((item) => ({ value: item.id, label: item.name, disabled: !item.enabled }))}
                                        onChange={(rootTag) => setCategory({ ...category, rootTag })}
                                    />
                                </label>
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
                                    <Button onClick={() => setCategory(emptyCategory(data?.roots?.[0]?.id || "drama"))} disabled={busy || (!category.id && !category.name)}>
                                        清空
                                    </Button>
                                    <Button type="primary" icon={category.id ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} loading={busy} disabled={!data || !category.name.trim()} onClick={() => void save({ category })}>
                                        {category.id ? "保存分类" : "新增子分类"}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="admin-skill-curation-table-wrap">
                            <AdminDataTable<CurationCategory>
                                className="admin-skill-curation-table"
                                table={{
                                    rowKey: "id",
                                    dataSource: data?.categories || [],
                                    pagination: false,
                                    loading: !data,
                                    columns: [
                                        { title: "一级分类", render: (_, row) => data?.roots?.find((item) => item.id === row.rootTag)?.name || "未归入启用分类" },
                                        { title: "子分类", dataIndex: "name" },
                                        { title: "排序", dataIndex: "sortOrder", width: 78, align: "center" },
                                        { title: "状态", width: 90, render: (_, row) => <AdminStatusBadge label={row.enabled ? "启用" : "停用"} tone={row.enabled ? "success" : "neutral"} /> },
                                        {
                                            title: "操作",
                                            width: 90,
                                            render: (_, row) => (
                                                <Button type="text" size="small" className="admin-row-action admin-row-action-primary" icon={<Edit3 className="size-3.5" />} onClick={() => setCategory({ ...row })}>
                                                    编辑
                                                </Button>
                                            ),
                                        },
                                    ],
                                }}
                                empty={
                                    <AdminTableEmpty
                                        title="还没有子分类"
                                        description="先在上方创建一个子分类，技能归类时就能直接选择。"
                                        action={
                                            <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={() => document.querySelector<HTMLInputElement>("[aria-label=分类名称]")?.focus()}>
                                                创建子分类
                                            </Button>
                                        }
                                    />
                                }
                            />
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        layout="stacked"
                        className="admin-skill-curation-panel"
                        icon={<Check className="size-4" aria-hidden="true" />}
                        title="技能归类"
                        description="搜索公开技能，选择一级分类和它应该出现的子分类。"
                        status={<AdminStatusBadge label={skillId ? "已选择技能" : "等待选择"} tone={skillId ? "success" : "neutral"} />}
                    >
                        <div className="admin-skill-curation-assignment-form" aria-label="技能归类表单">
                            <label className="admin-skill-curation-field">
                                <span>搜索技能</span>
                                <Input aria-label="搜索公开技能" placeholder="按名称搜索公开技能" value={search} onChange={(e) => setSearch(e.target.value)} allowClear />
                            </label>
                            <label className="admin-skill-curation-field">
                                <span>选择技能</span>
                                <Select
                                    aria-label="选择技能"
                                    className="admin-skill-curation-control"
                                    value={skillId || undefined}
                                    placeholder="请选择一个技能"
                                    options={skills.map((skill) => ({ value: skill.skillId, label: skill.skillName }))}
                                    onChange={selectSkill}
                                    showSearch
                                    optionFilterProp="label"
                                    notFoundContent={search ? "没有找到匹配的公开技能" : "暂无公开技能"}
                                />
                            </label>
                            <label className="admin-skill-curation-field">
                                <span>技能一级分类</span>
                                <Select
                                    aria-label="技能一级分类"
                                    className="admin-skill-curation-control"
                                    value={assignedRoot || undefined}
                                    placeholder="按原始分类"
                                    options={[{ value: "", label: "按原始分类" }, ...(data?.roots || []).map((item) => ({ value: item.id, label: item.name, disabled: !item.enabled }))]}
                                    onChange={(id) => {
                                        setAssignedRoot(id);
                                        setCategoryIds([]);
                                    }}
                                />
                            </label>
                            <label className="admin-skill-curation-field">
                                <span>技能子分类</span>
                                <Select
                                    mode="multiple"
                                    aria-label="技能子分类"
                                    className="admin-skill-curation-control admin-skill-curation-multi-select"
                                    placeholder={selectedSkill ? "请选择一个或多个子分类" : "先选择技能"}
                                    value={categoryIds}
                                    disabled={!selectedSkill}
                                    onChange={setCategoryIds}
                                    options={availableCategories.map((item) => ({ value: item.id, label: item.name }))}
                                    maxTagCount="responsive"
                                    notFoundContent={selectedRoot || selectedSkill ? "该一级分类暂无启用的子分类" : "先选择技能"}
                                />
                            </label>
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
        </AdminPageFrame>
    );
}
