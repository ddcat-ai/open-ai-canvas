import { App, Button, Checkbox, Dropdown, Input, Select } from "antd";
import { Ban, Search, Settings2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { bulkDisableAdminUsers, deleteAdminUser, listAdminUsers, updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminBatchBar, AdminDataTable, AdminTableEmpty } from "../components/admin-ui";
import { useTableUrlState } from "../lib/use-table-url-state";
import { AdminUserDetailDrawer } from "../components/admin-user-detail-drawer";
import { createUserColumns, userColumnOptions, type UserColumnKey } from "./users-columns";
import { AdminUserCreateDrawer, AdminUserEditDrawer } from "./users-drawer";

const columnStorageKey = "admin-users-visible-columns";
const allColumnKeys = userColumnOptions.map((item) => item.key);

export default function UsersPanel({ onUserChanged }: { onUserChanged?: (user: LocalUser) => void }) {
    const actor = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const { state, update } = useTableUrlState();
    const debouncedFilter = useDebouncedValue(state.filter);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [createUserOpen, setCreateUserOpen] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkDisabling, setBulkDisabling] = useState(false);
    const [visibleColumns, setVisibleColumns] = useState<Set<UserColumnKey>>(() => {
        if (typeof window === "undefined") return new Set(allColumnKeys);
        try {
            const saved = JSON.parse(window.localStorage.getItem(columnStorageKey) || "[]") as UserColumnKey[];
            const valid = saved.filter((key) => allColumnKeys.includes(key));
            return new Set(valid.length ? [...valid, "user", "actions"] : allColumnKeys);
        } catch {
            return new Set(allColumnKeys);
        }
    });
    const requestSequence = useRef(0);
    const hasFilters = Boolean(state.filter || state.role !== "all" || state.status !== "all");
    const detailIndex = detailUserId ? users.findIndex((user) => user.id === detailUserId) : -1;
    const previousUserId = detailIndex > 0 ? users[detailIndex - 1]?.id : undefined;
    const nextUserId = detailIndex >= 0 && detailIndex < users.length - 1 ? users[detailIndex + 1]?.id : undefined;

    useEffect(() => {
        window.localStorage.setItem(columnStorageKey, JSON.stringify([...visibleColumns]));
    }, [visibleColumns]);

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        void listAdminUsers({
            keyword: debouncedFilter || undefined,
            role: state.role === "all" ? undefined : state.role,
            status: state.status === "all" ? undefined : state.status,
            page: state.page,
            limit: state.pageSize,
        })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setUsers(result.users);
                setTotal(result.total);
                setSelectedUserIds([]);
                if (result.total > 0 && result.users.length === 0 && state.page > 1) update({ page: 1 }, true);
            })
            .catch((error) => {
                if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : "读取用户失败");
            })
            .finally(() => {
                if (sequence === requestSequence.current) setLoading(false);
            });
    }, [debouncedFilter, message, state.page, state.pageSize, state.role, state.status, update]);

    const replaceUser = useCallback((nextUser: LocalUser) => {
        setUsers((items) => items.map((item) => item.id === nextUser.id ? { ...item, ...nextUser } : item));
        onUserChanged?.(nextUser);
    }, [onUserChanged]);

    const addUser = useCallback((user: AdminUser) => {
        setUsers((items) => [user, ...items].slice(0, state.pageSize));
        setTotal((value) => value + 1);
        onUserChanged?.(user);
        setCreateUserOpen(false);
    }, [onUserChanged, state.pageSize]);

    const toggleStatus = useCallback(async (user: AdminUser) => {
        try {
            if (user.status === "active") {
                await deleteAdminUser(user.id);
                replaceUser({ ...user, status: "disabled" });
                message.success("用户已停用并清除登录状态");
                return;
            }
            const result = await updateAdminUser(user.id, { status: "active" });
            replaceUser(result.user);
            message.success("用户已重新启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新用户状态失败");
        }
    }, [message, replaceUser]);

    const columns = useMemo(() => createUserColumns({
        actorId: actor?.id,
        visibleColumns,
        onView: (user) => setDetailUserId(user.id),
        onEdit: (user) => { setCreateUserOpen(false); setEditingUser(user); },
        onToggleStatus: toggleStatus,
    }), [actor?.id, toggleStatus, visibleColumns]);

    const resetFilters = () => update({ filter: "", role: "all", status: "all", page: 1 });

    const bulkDisable = () => {
        modal.confirm({
            title: `停用选中的 ${selectedUserIds.length} 个用户？`,
            content: "这些用户的全部登录态会被清除，身份、任务和积分流水继续保留。操作会整体成功或整体回滚。",
            okText: "确认批量停用",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setBulkDisabling(true);
                try {
                    const result = await bulkDisableAdminUsers(selectedUserIds);
                    result.users.forEach(replaceUser);
                    setSelectedUserIds([]);
                    message.success(`已停用 ${result.disabledCount} 个用户`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "批量停用用户失败");
                } finally {
                    setBulkDisabling(false);
                }
            },
        });
    };

    return (
        <>
            <AdminDataTable
                toolbar={
                    <>
                        <Input
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={state.filter}
                            aria-label="搜索用户"
                            placeholder="搜索用户名、名称或邮箱"
                            onChange={(event) => update({ filter: event.target.value, page: 1 }, true)}
                        />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={resetFilters}
                toolbarFilters={
                    <>
                        <Select
                            aria-label="筛选用户角色"
                            className="w-32"
                            value={state.role}
                            options={[{ value: "all", label: "全部角色" }, { value: "admin", label: "管理员" }, { value: "user", label: "普通用户" }]}
                            onChange={(role) => update({ role, page: 1 })}
                        />
                        <Select
                            aria-label="筛选用户状态"
                            className="w-32"
                            value={state.status}
                            options={[{ value: "all", label: "全部状态" }, { value: "active", label: "已启用" }, { value: "disabled", label: "已停用" }]}
                            onChange={(status) => update({ status, page: 1 })}
                        />
                    </>
                }
                trailing={
                    <div className="flex items-center gap-2">
                        <Button icon={<UserPlus className="size-4" />} onClick={() => { setEditingUser(null); setCreateUserOpen(true); }}>{"\u6dfb\u52a0\u7528\u6237"}</Button>
                        <Dropdown
                            trigger={["click"]}
                            popupRender={() => (
                                <div className="w-48 rounded-md border border-border bg-popover p-2 shadow-lg">
                                    <div className="px-2 pb-2 text-xs font-medium text-foreground/55">显示列</div>
                                    <div className="space-y-0.5">
                                        {userColumnOptions.map((option) => (
                                            <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                                                <Checkbox
                                                    checked={visibleColumns.has(option.key)}
                                                    disabled={option.locked}
                                                    onChange={(event) => setVisibleColumns((current) => {
                                                        const next = new Set(current);
                                                        if (event.target.checked) next.add(option.key);
                                                        else next.delete(option.key);
                                                        return next;
                                                    })}
                                                />
                                                {option.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        >
                            <Button icon={<Settings2 className="size-4" />}>列设置</Button>
                        </Dropdown>
                    </div>
                }
                batchActions={<AdminBatchBar count={selectedUserIds.length} onClear={() => setSelectedUserIds([])}><Button danger size="small" icon={<Ban className="size-3.5" />} loading={bulkDisabling} onClick={bulkDisable}>批量停用</Button></AdminBatchBar>}
                skeletonColumns={Math.max(4, columns.length)}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    rowSelection: {
                        selectedRowKeys: selectedUserIds,
                        preserveSelectedRowKeys: false,
                        onChange: (keys) => setSelectedUserIds(keys.map(String)),
                        getCheckboxProps: (user) => ({ disabled: user.id === actor?.id || user.status === "disabled", name: user.displayName || user.username }),
                    },
                    columns,
                    dataSource: users,
                    pagination: false,
                    scroll: { x: 860 },
                }}
                empty={<AdminTableEmpty filtered={hasFilters} />}
                footer={<PaginationBar alwaysShow current={state.page} pageSize={state.pageSize} total={total} onChange={(page, pageSize) => update({ page: pageSize !== state.pageSize ? 1 : page, pageSize })} />}
            />

            <AdminUserDetailDrawer userId={detailUserId} previousUserId={previousUserId} nextUserId={nextUserId} onNavigate={setDetailUserId} onClose={() => setDetailUserId(null)} />
            <AdminUserCreateDrawer open={createUserOpen} onClose={() => setCreateUserOpen(false)} onCreated={addUser} />
            <AdminUserEditDrawer user={editingUser} actorId={actor?.id} onClose={() => setEditingUser(null)} onSaved={replaceUser} />
        </>
    );
}
