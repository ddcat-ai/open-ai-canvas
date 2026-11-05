import { App, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ArchiveRestore, ArchiveX, Code2, Eye, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Select } from "@/components/ui/base/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { fallbackSkillCategories, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { deleteAdminSkill, listAdminSkills, setAdminSkillEnabled, updateAdminSkillInfo, type AdminSkill, type AdminSkillSourceFilter, type AdminSkillStatusFilter } from "@/services/api/admin-skills";
import type { SkillCategory } from "@/services/api/skills";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty, PaginationBar, type AdminRowAction } from "../components/admin-ui";

const sourceLabels: Record<string, string> = { builtin: "内置", markdown: "Markdown", zip: "技能包", github: "GitHub" };
const statusOptions: Array<{ value: AdminSkillStatusFilter; label: string }> = [
    { value: "", label: "全部状态" },
    { value: "enabled", label: "已上架" },
    { value: "disabled", label: "已下架" },
];
const sourceOptions: Array<{ value: AdminSkillSourceFilter; label: string }> = [
    { value: "", label: "全部来源" },
    { value: "builtin", label: "内置" },
    { value: "markdown", label: "Markdown" },
    { value: "zip", label: "技能包" },
    { value: "github", label: "GitHub" },
];
const pageSizes = [20, 50, 100];

function sourceLabel(sourceType: string) {
    return sourceLabels[sourceType] || "Markdown";
}

/** 后台技能管理：全站技能（含私有和已下架）的基本信息、内容、上下架与删除。 */
export default function AdminSkillsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("keyword") || "";
    const status = (searchParams.get("status") || "") as AdminSkillStatusFilter;
    const sourceType = (searchParams.get("sourceType") || "") as AdminSkillSourceFilter;
    const tag = searchParams.get("tag") || "";
    const rawPage = Number(searchParams.get("page") || 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawSize = Number(searchParams.get("pageSize") || 20);
    const pageSize = pageSizes.includes(rawSize) ? rawSize : 20;
    const debouncedKeyword = useDebouncedValue(keyword);

    const [skills, setSkills] = useState<AdminSkill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [editing, setEditing] = useState<AdminSkill | null>(null);
    const filtered = Boolean(keyword || status || sourceType || tag);

    const update = useCallback(
        (patch: Record<string, string | number>, replace = false) => {
            setSearchParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    for (const [key, value] of Object.entries(patch)) {
                        if (value === "" || (key === "page" && value === 1) || (key === "pageSize" && value === 20)) next.delete(key);
                        else next.set(key, String(value));
                    }
                    return next;
                },
                { replace },
            );
        },
        [setSearchParams],
    );

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        listAdminSkills({ keyword: debouncedKeyword || undefined, status: status || undefined, sourceType: sourceType || undefined, tag: tag || undefined, page, pageSize }, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return;
                setSkills(data.skills);
                setTotal(data.total);
                if (data.categories.length) setCategories(data.categories);
                if (page > 1 && data.skills.length === 0 && data.total > 0) update({ page: 1 }, true);
            })
            .catch((cause) => {
                if (controller.signal.aborted) return;
                setSkills([]);
                setTotal(0);
                setError(cause instanceof Error ? cause.message : "读取技能列表失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [debouncedKeyword, status, sourceType, tag, page, pageSize, reloadKey, update]);

    const replaceSkill = useCallback((next: AdminSkill) => setSkills((items) => items.map((item) => (item.skillId === next.skillId ? next : item))), []);

    const toggleEnabled = useCallback(
        async (skill: AdminSkill) => {
            try {
                const result = await setAdminSkillEnabled(skill.skillId, !skill.enabled);
                replaceSkill(result.skill);
                message.success(result.skill.enabled ? `已上架「${skill.skillName}」` : `已下架「${skill.skillName}」`);
            } catch (cause) {
                message.error(cause instanceof Error ? cause.message : "修改上架状态失败");
            }
        },
        [message, replaceSkill],
    );

    const remove = useCallback(
        async (skill: AdminSkill) => {
            try {
                await deleteAdminSkill(skill.skillId);
                message.success(`已删除「${skill.skillName}」`);
                setReloadKey((value) => value + 1);
            } catch (cause) {
                message.error(cause instanceof Error ? cause.message : "删除技能失败");
            }
        },
        [message],
    );

    const columns = useMemo<ColumnsType<AdminSkill>>(
        () => [
            {
                key: "skill",
                title: "技能",
                render: (_, skill) => (
                    <div className="min-w-0 max-w-[420px]">
                        <div className="flex min-w-0 items-center gap-2">
                            <button type="button" className="admin-table-primary-link truncate font-medium" title="编辑基本信息" onClick={() => setEditing(skill)}>
                                {skill.skillName}
                            </button>
                            {skill.isPrivate ? <AdminStatusBadge label="私有" /> : null}
                            {skill.adminInfoEditedAt || skill.adminContentEditedAt ? <AdminStatusBadge label="后台改过" tone="info" title={adminEditTitle(skill)} /> : null}
                        </div>
                        <div className="line-clamp-1 text-xs text-foreground/50" title={skill.description}>
                            {skill.description}
                        </div>
                    </div>
                ),
            },
            {
                key: "source",
                title: "来源",
                width: 120,
                render: (_, skill) => (
                    <div className="min-w-0">
                        <div>{sourceLabel(skill.sourceType)}</div>
                        {skill.sourceType === "github" && skill.sourceUrl ? (
                            <div className="truncate text-xs text-foreground/50" title={skill.sourceUrl}>
                                {skill.sourceUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
                            </div>
                        ) : null}
                    </div>
                ),
            },
            { key: "author", title: "作者", width: 140, render: (_, skill) => <span className="truncate">{skill.effectiveUser.name || "—"}</span> },
            { key: "tag", title: "分类", width: 110, render: (_, skill) => skillCategoryLabel(skill.tag, categories) },
            { key: "version", title: "版本", width: 130, render: (_, skill) => <span className="text-xs tabular-nums" title={skill.versionId}>{`v${skill.version || "1"} · ${skill.fileCount || 1} 个文件`}</span> },
            { key: "added", title: "加入数", width: 80, align: "center", render: (_, skill) => <span className="tabular-nums">{skill.addedCount}</span> },
            { key: "status", title: "状态", width: 90, render: (_, skill) => <AdminStatusBadge label={skill.enabled ? "已上架" : "已下架"} tone={skill.enabled ? "success" : "warning"} /> },
            { key: "updatedAt", title: "更新时间", width: 150, render: (_, skill) => <span className="text-xs tabular-nums">{dayjs(skill.updatedAt).format("YYYY-MM-DD HH:mm")}</span> },
            {
                key: "actions",
                title: "操作",
                // 编辑信息 + 编辑内容/查看文件 + 上/下架 + 更多 实测约 295px，再加单元格左右 12px 内边距。
                width: 328,
                fixed: "right",
                render: (_, skill) => {
                    const actions: AdminRowAction[] = [
                        {
                            key: "content",
                            label: skill.contentEditable ? "编辑内容" : "查看文件",
                            icon: skill.contentEditable ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />,
                            onClick: () => navigate(`/admin/skills/${encodeURIComponent(skill.skillId)}/edit`),
                        },
                        skill.enabled
                            ? {
                                  key: "disable",
                                  label: "下架",
                                  icon: <ArchiveX className="size-3.5" />,
                                  confirm: { title: `下架「${skill.skillName}」？`, description: "下架后技能从技能广场、用户技能库和 Agent 目录中隐藏，作者也无法使用；数据与用户关系保留，可随时重新上架。", okText: "确认下架" },
                                  onClick: () => toggleEnabled(skill),
                              }
                            : { key: "enable", label: "上架", icon: <ArchiveRestore className="size-3.5" />, onClick: () => toggleEnabled(skill) },
                        {
                            key: "delete",
                            label: "删除",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: {
                                title: `永久删除「${skill.skillName}」？`,
                                description:
                                    skill.sourceType === "builtin"
                                        ? "将删除技能的全部版本、文件和用户的加入、收藏记录，且不可恢复；系统升级也不会重建这个内置技能。只想暂时隐藏请使用下架。"
                                        : "将删除技能的全部版本、文件和用户的加入、收藏记录，且不可恢复。只想暂时隐藏请使用下架。",
                                okText: "永久删除",
                            },
                            onClick: () => remove(skill),
                        },
                    ];
                    return <AdminRowActions primary={{ label: "编辑信息", icon: <Pencil className="size-3.5" />, onClick: () => setEditing(skill) }} actions={actions} visibleActionCount={2} />;
                },
            },
        ],
        [categories, navigate, remove, toggleEnabled],
    );

    return (
        <AdminPageFrame
            title="技能管理"
            description="全站技能（含私有和已下架）· GitHub 同步的技能只能编辑基本信息"
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setReloadKey((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            <AdminDataTable<AdminSkill>
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索名称、简介、作者、ID 或仓库"
                        aria-label="搜索技能"
                        onValueChange={(value) => update({ keyword: value, page: 1 }, true)}
                    />
                }
                toolbarActive={filtered}
                onReset={() => update({ keyword: "", status: "", sourceType: "", tag: "", page: 1 })}
                toolbarFilters={
                    <>
                        <Select className="w-32" ariaLabel="上架状态" value={status} options={statusOptions} onChange={(value) => update({ status: value, page: 1 })} />
                        <Select className="w-32" ariaLabel="技能来源" value={sourceType} options={sourceOptions} onChange={(value) => update({ sourceType: value, page: 1 })} />
                        <Select className="w-32" ariaLabel="技能分类" value={tag} options={[{ value: "", label: "全部分类" }, ...categories.map(({ value, label }) => ({ value, label }))]} onChange={(value) => update({ tag: value, page: 1 })} />
                    </>
                }
                empty={
                    error ? (
                        <div className="admin-inline-load-error" role="status">
                            <span>技能列表暂不可用：{error}</span>
                            <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <AdminTableEmpty filtered={filtered} title={filtered ? "没有符合条件的技能" : "还没有技能"} description={filtered ? "调整筛选条件后重试。" : undefined} />
                    )
                }
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} pageSizeOptions={pageSizes} onChange={(next, size) => update({ page: next, pageSize: size })} />}
                skeletonColumns={columns.length}
                table={{ className: "app-data-table", size: "small", rowKey: "skillId", loading, columns, dataSource: skills, pagination: false, scroll: { x: 1430 } }}
            />
            <SkillEditorDrawer
                open={Boolean(editing)}
                skill={editing}
                admin={{ save: updateAdminSkillInfo }}
                onClose={() => setEditing(null)}
                onSaved={(next) => {
                    replaceSkill(next as AdminSkill);
                    setEditing(null);
                }}
            />
        </AdminPageFrame>
    );
}

function adminEditTitle(skill: AdminSkill) {
    const parts: string[] = [];
    if (skill.adminInfoEditedAt) parts.push(`基本信息 ${dayjs(skill.adminInfoEditedAt).format("YYYY-MM-DD HH:mm")}`);
    if (skill.adminContentEditedAt) parts.push(`文件内容 ${dayjs(skill.adminContentEditedAt).format("YYYY-MM-DD HH:mm")}`);
    return `管理员修改过：${parts.join("；")}。内置技能和 GitHub 同步不再覆盖这些部分。`;
}
