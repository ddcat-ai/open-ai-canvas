import { App, Button, Checkbox, Dropdown, Input } from "antd";
import { Ban, ChevronDown, Search, Settings2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { bulkDisableAdminUsers, deleteAdminUser, listAdminUsers, updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminBatchBar, AdminDataTable, AdminFilterChip, AdminTableEmpty } from "../components/admin-ui";
import { useTableUrlState } from "../lib/use-table-url-state";
import { AdminUserDetailDrawer } from "../components/admin-user-detail-drawer";
import { createUserColumns, userColumnOptions, type UserColumnKey } from "./users-columns";
import { AdminUserCreateDrawer, AdminUserEditDrawer } from "./users-drawer";
import { useTranslation } from "react-i18next";

const columnStorageKey = "admin-users-visible-columns";
const allColumnKeys = userColumnOptions.map((item) => item.key);

export default function UsersPanel({ onUserChanged }: { onUserChanged?: (user: LocalUser) => void }) {
    const { t } = useTranslation("canvas");
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
                if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : t("admin:failed-to-read-users"));
            })
            .finally(() => {
                if (sequence === requestSequence.current) setLoading(false);
            });
    }, [debouncedFilter, message, state.page, state.pageSize, state.role, state.status, update]);

    const replaceUser = useCallback(
        (nextUser: LocalUser) => {
            setUsers((items) => items.map((item) => (item.id === nextUser.id ? { ...item, ...nextUser } : item)));
            onUserChanged?.(nextUser);
        },
        [onUserChanged],
    );

    const addUser = useCallback(
        (user: AdminUser) => {
            setUsers((items) => [user, ...items].slice(0, state.pageSize));
            setTotal((value) => value + 1);
            onUserChanged?.(user);
            setCreateUserOpen(false);
        },
        [onUserChanged, state.pageSize],
    );

    const toggleStatus = useCallback(
        async (user: AdminUser) => {
            try {
                if (user.status === "active") {
                    await deleteAdminUser(user.id);
                    replaceUser({ ...user, status: "disabled" });
                    message.success(t("admin:user-disabled-and-sessions-cleared"));
                    return;
                }
                const result = await updateAdminUser(user.id, { status: "active" });
                replaceUser(result.user);
                message.success(t("admin:user-re-enabled"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("admin:failed-to-update-user-status"));
            }
        },
        [message, replaceUser],
    );

    const columns = useMemo(
        () =>
            createUserColumns({
                actorId: actor?.id,
                visibleColumns,
                onView: (user) => setDetailUserId(user.id),
                onEdit: (user) => {
                    setCreateUserOpen(false);
                    setEditingUser(user);
                },
                onToggleStatus: toggleStatus,
            }),
        [actor?.id, toggleStatus, visibleColumns],
    );

    const resetFilters = () => update({ filter: "", role: "all", status: "all", page: 1 });

    const bulkDisable = () => {
        modal.confirm({
            title: t("admin:disable-param-selected-users", { length: selectedUserIds.length }),
            content: t("admin:all-their-sessions-are-cleared-identity-tasks-and-credit-transactions-ar"),
            okText: t("admin:confirm-batch-disable"),
            cancelText: t("admin:cancel-4"),
            okButtonProps: { danger: true },
            onOk: async () => {
                setBulkDisabling(true);
                try {
                    const result = await bulkDisableAdminUsers(selectedUserIds);
                    result.users.forEach(replaceUser);
                    setSelectedUserIds([]);
                    message.success(t("admin:disabled-param-users", { disabledCount: result.disabledCount }));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("admin:failed-to-batch-disable-users"));
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
                            placeholder={t("admin:search-usernames-names-or-emails")}
                            onChange={(event) => update({ filter: event.target.value, page: 1 }, true)}
                        />
                    </>
                }
                toolbarActiveFilters={
                    <>
                        {state.filter ? <AdminFilterChip label={t("admin:search-param-2", { filter: state.filter })} onRemove={() => update({ filter: "", page: 1 })} /> : null}
                        {state.role !== "all" ? <AdminFilterChip label={`角色：${state.role === "admin" ? t("admin:admin") : t("admin:user")}`} onRemove={() => update({ role: "all", page: 1 })} /> : null}
                        {state.status !== "all" ? <AdminFilterChip label={`状态：${state.status === "active" ? t("admin:enabled") : t("admin:disabled")}`} onRemove={() => update({ status: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarActive={hasFilters}
                onReset={resetFilters}
                toolbarFilters={
                    <>
                        <FilterMenu
                            label={t("admin:role")}
                            value={state.role}
                            options={[
                                { value: "all", label: t("admin:all-roles") },
                                { value: "admin", label: t("admin:admin") },
                                { value: "user", label: t("admin:user") },
                            ]}
                            onChange={(role) => update({ role, page: 1 })}
                        />
                        <FilterMenu
                            label={t("admin:status")}
                            value={state.status}
                            options={[
                                { value: "all", label: t("admin:all-statuses") },
                                { value: "active", label: t("admin:enabled") },
                                { value: "disabled", label: t("admin:disabled") },
                            ]}
                            onChange={(status) => update({ status, page: 1 })}
                        />
                    </>
                }
                trailing={
                    <div className="flex items-center gap-2">
                        <Button
                            icon={<UserPlus className="size-4" />}
                            onClick={() => {
                                setEditingUser(null);
                                setCreateUserOpen(true);
                            }}
                        >
                            {t("admin:add-user")}
                        </Button>
                        <Dropdown
                            trigger={["click"]}
                            dropdownRender={() => (
                                <div className="w-48 rounded-md border border-border bg-popover p-2 shadow-lg">
                                    <div className="px-2 pb-2 text-xs font-medium text-foreground/55">{t("admin:visible-columns")}</div>
                                    <div className="space-y-0.5">
                                        {userColumnOptions.map((option) => (
                                            <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                                                <Checkbox
                                                    checked={visibleColumns.has(option.key)}
                                                    disabled={option.locked}
                                                    onChange={(event) =>
                                                        setVisibleColumns((current) => {
                                                            const next = new Set(current);
                                                            if (event.target.checked) next.add(option.key);
                                                            else next.delete(option.key);
                                                            return next;
                                                        })
                                                    }
                                                />
                                                {option.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        >
                            <Button icon={<Settings2 className="size-4" />}>{t("admin:column-settings")}</Button>
                        </Dropdown>
                    </div>
                }
                batchActions={
                    <AdminBatchBar count={selectedUserIds.length} onClear={() => setSelectedUserIds([])}>
                        <Button danger size="small" icon={<Ban className="size-3.5" />} loading={bulkDisabling} onClick={bulkDisable}>
                            {t("admin:batch-disable")}
                        </Button>
                    </AdminBatchBar>
                }
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

function FilterMenu({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
    const selected = options.find((option) => option.value === value)?.label || label;
    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                selectable: true,
                selectedKeys: [value],
                items: options.map((option) => ({ key: option.value, label: option.label })),
                onClick: ({ key }) => onChange(key),
            }}
        >
            <Button>
                {value === "all" ? label : selected}
                <ChevronDown className="ml-1 size-3.5" />
            </Button>
        </Dropdown>
    );
}
