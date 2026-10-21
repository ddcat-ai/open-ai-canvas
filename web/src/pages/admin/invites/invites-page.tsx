import { App, Button, ConfigProvider, Descriptions, Input, Modal, Select, Table, Tag } from "antd";
import { RefreshCw, Search, Settings2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, PaginationBar } from "../components/admin-ui";
import { AdminDrawer } from "../ui/overlays";
import { listAdminUsers } from "@/services/api/auth";
import { approveAdminInvite, deleteAdminInvite, freezeAdminInvite, getAdminInviteDetail, listAdminInvites, updateAdminInviteInviters, type AdminInviteDetail, type AdminInviteRecord, type InviteRewardRecord } from "@/services/api/invite";

const PAGE_SIZE = 20;

type DraftFilters = { status: string; keyword: string };
const emptyFilters: DraftFilters = { status: "", keyword: "" };

function formatYuan(microYuan: number) {
    return `¥ ${(microYuan / 1_000_000).toFixed(2)}`;
}

function InviteRecordBadge({ status }: { status: string }) {
    if (status === "pending") return <AdminStatusBadge label="待审核" tone="warning" />;
    if (status === "approved") return <AdminStatusBadge label="已通过" tone="success" />;
    return <AdminStatusBadge label="已冻结" tone="neutral" />;
}

function RewardStatusTag({ status }: { status: string }) {
    if (status === "pending") return <Tag color="warning">待审核</Tag>;
    if (status === "credited") return <Tag color="success">已入账</Tag>;
    return <Tag>已作废</Tag>;
}

export default function InvitesPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const [draft, setDraft] = useState<DraftFilters>(emptyFilters);
    const [applied, setApplied] = useState<DraftFilters>(emptyFilters);
    const [page, setPage] = useState(1);
    const [records, setRecords] = useState<AdminInviteRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [detail, setDetail] = useState<AdminInviteDetail | null>(null);
    const [editTarget, setEditTarget] = useState<AdminInviteRecord | null>(null);
    const sequence = useRef(0);

    const load = useCallback(
        async (targetPage: number, filters: DraftFilters) => {
            const current = ++sequence.current;
            setLoading(true);
            setLoadError("");
            try {
                const result = await listAdminInvites({
                    status: filters.status,
                    keyword: filters.keyword.trim(),
                    page: targetPage,
                    pageSize: PAGE_SIZE,
                });
                if (current !== sequence.current) return;
                setRecords(result.records ?? []);
                setTotal(result.total ?? 0);
            } catch (error) {
                if (current === sequence.current) setLoadError(error instanceof Error ? error.message : "读取邀请记录失败");
            } finally {
                if (current === sequence.current) setLoading(false);
            }
        },
        [message],
    );

    useEffect(() => {
        void load(page, applied);
    }, [page, applied, load]);

    const filtersDirty = JSON.stringify(draft) !== JSON.stringify(applied);
    const query = () => {
        setPage(1);
        setApplied(draft);
    };
    const reload = () => void load(page, applied);

    const openDetail = async (record: AdminInviteRecord) => {
        try {
            setDetail(await getAdminInviteDetail(record.userId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取详情失败");
        }
    };

    const approve = (record: AdminInviteRecord) => {
        modal.confirm({
            title: record.status === "frozen" ? "恢复该邀请记录？" : "通过该邀请记录？",
            content:
                record.status === "frozen"
                    ? "恢复后该用户的后续订单可继续产生邀请奖励，已作废的历史奖励不会补发。"
                    : `被邀请人 ${record.inviteeDisplayName || record.inviteeUsername} 的待审核奖励（${formatYuan(record.pendingMicroYuan)}）将立即发放给对应邀请人。`,
            okText: record.status === "frozen" ? "确认恢复" : "确认通过",
            onOk: async () => {
                try {
                    await approveAdminInvite(record.userId);
                    message.success(record.status === "frozen" ? "邀请记录已恢复" : "邀请记录已通过，奖励已发放");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "操作失败");
                }
            },
        });
    };

    const freeze = (record: AdminInviteRecord) => {
        modal.confirm({
            title: "冻结该邀请记录？",
            content: record.status === "pending" ? "待审核奖励将作废，后续订单不再产生奖励。" : "冻结后该用户的后续订单不再产生奖励，已入账奖励不受影响。",
            okText: "确认冻结",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await freezeAdminInvite(record.userId);
                    message.success("邀请记录已冻结");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "操作失败");
                }
            },
        });
    };

    const remove = (record: AdminInviteRecord) => {
        modal.confirm({
            title: "删除该邀请记录？",
            content: "待审核奖励将作废；已入账奖励保留在邀请人账户。该操作不可撤销。",
            okText: "确认删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteAdminInvite(record.userId);
                    message.success("邀请记录已删除");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "操作失败");
                }
            },
        });
    };

    const columns = useMemo(
        () => [
            {
                title: "被邀请人",
                key: "invitee",
                width: 150,
                render: (_: unknown, record: AdminInviteRecord) => (
                    <div className="min-w-0">
                        <div className="truncate font-medium">{record.inviteeDisplayName || record.inviteeUsername}</div>
                        <div className="truncate text-xs text-foreground/45">{record.inviteeUsername}</div>
                    </div>
                ),
            },
            {
                title: "一级邀请人",
                key: "l1",
                width: 130,
                render: (_: unknown, record: AdminInviteRecord) => (record.l1InviterId ? <span className="truncate">{record.l1Username}</span> : <span className="text-foreground/35">--</span>),
            },
            {
                title: "二级邀请人",
                key: "l2",
                width: 130,
                render: (_: unknown, record: AdminInviteRecord) => (record.l2InviterId ? <span className="truncate">{record.l2Username}</span> : <span className="text-foreground/35">--</span>),
            },
            { title: "状态", key: "status", width: 96, render: (_: unknown, record: AdminInviteRecord) => <InviteRecordBadge status={record.status} /> },
            { title: "累计奖励", key: "credited", width: 110, render: (_: unknown, record: AdminInviteRecord) => <span className="tabular-nums">{formatYuan(record.creditedMicroYuan)}</span> },
            {
                title: "待发放",
                key: "pending",
                width: 110,
                render: (_: unknown, record: AdminInviteRecord) => <span className="tabular-nums text-amber-600 dark:text-amber-400">{record.pendingMicroYuan > 0 ? formatYuan(record.pendingMicroYuan) : "--"}</span>,
            },
            { title: "注册时间", key: "createdAt", width: 170, render: (_: unknown, record: AdminInviteRecord) => <span className="tabular-nums text-foreground/60">{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</span> },
            {
                title: "操作",
                key: "actions",
                width: 230,
                fixed: "right" as const,
                render: (_: unknown, record: AdminInviteRecord) => (
                    // Popup coordinates must update synchronously under reduced-motion styles.
                    <ConfigProvider dropdown={{ styles: { root: { transition: "none" } } }}>
                        <AdminRowActions
                            primary={{ label: "详情", onClick: () => void openDetail(record) }}
                            actions={[
                                ...(record.status === "pending" || record.status === "frozen" ? [{ key: "approve", label: record.status === "frozen" ? "恢复" : "通过", danger: false, onClick: () => approve(record) }] : []),
                                ...(record.status !== "frozen" ? [{ key: "freeze", label: "冻结", danger: true, onClick: () => freeze(record) }] : []),
                                { key: "edit", label: "编辑", danger: false, onClick: () => setEditTarget(record) },
                                { key: "delete", label: "删除", danger: true, onClick: () => remove(record) },
                            ]}
                            visibleActionCount={0}
                        />
                    </ConfigProvider>
                ),
            },
        ],
        [records],
    );

    return (
        <AdminPageFrame
            title="邀请记录"
            description="邀请关系、奖励审核与归属调整"
            actions={
                <div className="flex items-center gap-2">
                    <Button icon={<Settings2 className="size-4" />} onClick={() => navigate("/admin/settings/invite")}>
                        邀请配置
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} onClick={reload}>
                        刷新
                    </Button>
                </div>
            }
        >
            {loadError ? (
                <div role="alert" className="flex items-center justify-between gap-3 p-3 text-sm text-destructive">
                    <span>{loadError}</span>
                    <Button onClick={reload} icon={<RefreshCw className="size-4" />}>
                        重试
                    </Button>
                </div>
            ) : null}
            <AdminDataTable
                toolbar={
                    <Input
                        className="app-list-search"
                        prefix={<Search className="size-4" />}
                        placeholder="被邀请人 / 邀请人 / 用户 ID"
                        value={draft.keyword}
                        allowClear
                        onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
                        onPressEnter={query}
                    />
                }
                toolbarFilters={
                    <>
                        <Select
                            className="w-32"
                            placeholder="状态"
                            allowClear
                            value={draft.status || undefined}
                            onChange={(value) => setDraft({ ...draft, status: value ?? "" })}
                            options={[
                                { label: "待审核", value: "pending" },
                                { label: "已通过", value: "approved" },
                                { label: "已冻结", value: "frozen" },
                            ]}
                        />
                        <Button type="primary" onClick={query}>
                            查询
                        </Button>
                        {filtersDirty ? <Tag color="warning">筛选未应用</Tag> : null}
                    </>
                }
                table={{
                    rowKey: "userId",
                    loading,
                    columns,
                    dataSource: records,
                    pagination: false,
                    tableLayout: "fixed",
                    scroll: { x: 1240 },
                }}
                footer={<PaginationBar alwaysShow current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />}
                empty={
                    <div className="flex flex-col items-center gap-2 py-10 text-foreground/45">
                        <UsersRound className="size-5" />
                        <div className="text-sm">暂无邀请记录</div>
                        <div className="text-xs">用户通过邀请码注册后会在这里建立邀请关系。</div>
                    </div>
                }
            />

            <AdminDrawer title="邀请记录详情" open={Boolean(detail)} onClose={() => setDetail(null)} size="min(680px, 100vw)">
                {detail ? (
                    <div className="flex flex-col gap-4">
                        <Descriptions
                            column={1}
                            bordered
                            size="small"
                            items={[
                                { key: "invitee", label: "被邀请人", children: `${detail.invitee?.displayName || detail.invitee?.username || "--"}（${detail.record.inviteeUsername}）` },
                                { key: "l1", label: "一级邀请人", children: detail.record.l1InviterId ? `${detail.l1Inviter?.displayName || detail.record.l1Username}（${detail.record.l1Username}）` : "--" },
                                { key: "l2", label: "二级邀请人", children: detail.record.l2InviterId ? `${detail.l2Inviter?.displayName || detail.record.l2Username}（${detail.record.l2Username}）` : "--" },
                                { key: "code", label: "注册使用邀请码", children: detail.record.codeUsed || "--" },
                                { key: "status", label: "状态", children: <InviteRecordBadge status={detail.record.status} /> },
                                { key: "credited", label: "累计产生奖励", children: `${formatYuan(detail.record.creditedMicroYuan)}（待发放 ${formatYuan(detail.record.pendingMicroYuan)}）` },
                                { key: "createdAt", label: "注册时间", children: new Date(detail.record.createdAt).toLocaleString("zh-CN", { hour12: false }) },
                            ]}
                        />
                        <div>
                            <div className="mb-2 text-sm font-medium">奖励明细</div>
                            <Table
                                rowKey="id"
                                size="small"
                                pagination={false}
                                dataSource={detail.rewardRecords ?? []}
                                columns={[
                                    { title: "级别", key: "level", width: 70, render: (_: unknown, record: InviteRewardRecord) => `${record.level} 级` },
                                    { title: "来源", key: "source", width: 90, render: () => "充值商品" },
                                    { title: "订单金额", key: "order", width: 100, render: (_: unknown, record: InviteRewardRecord) => <span className="tabular-nums">¥ {(record.orderAmountFen / 100).toFixed(2)}</span> },
                                    { title: "奖励率", key: "rate", width: 80, render: (_: unknown, record: InviteRewardRecord) => `${(record.rateBp / 100).toFixed(2)}%` },
                                    { title: "奖励金额", key: "amount", width: 100, render: (_: unknown, record: InviteRewardRecord) => <span className="tabular-nums">{formatYuan(record.amountMicroYuan)}</span> },
                                    { title: "状态", key: "status", width: 90, render: (_: unknown, record: InviteRewardRecord) => <RewardStatusTag status={record.status} /> },
                                    { title: "时间", key: "createdAt", render: (_: unknown, record: InviteRewardRecord) => <span className="tabular-nums text-foreground/60">{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</span> },
                                ]}
                                scroll={{ x: 640 }}
                            />
                        </div>
                    </div>
                ) : null}
            </AdminDrawer>

            {editTarget ? (
                <EditInvitersModal
                    record={editTarget}
                    onClose={() => setEditTarget(null)}
                    onSaved={() => {
                        setEditTarget(null);
                        reload();
                    }}
                />
            ) : null}
        </AdminPageFrame>
    );
}

function EditInvitersModal({ record, onClose, onSaved }: { record: AdminInviteRecord; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [l1, setL1] = useState(record.l1InviterId);
    const [l2, setL2] = useState(record.l2InviterId);
    const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setL1(record.l1InviterId);
        setL2(record.l2InviterId);
        const initial: Array<{ value: string; label: string }> = [];
        if (record.l1InviterId) initial.push({ value: record.l1InviterId, label: record.l1Username || record.l1InviterId });
        if (record.l2InviterId && record.l2InviterId !== record.l1InviterId) initial.push({ value: record.l2InviterId, label: record.l2Username || record.l2InviterId });
        setOptions(initial);
    }, [record]);

    const search = useCallback(
        async (keyword: string) => {
            try {
                const result = await listAdminUsers({ keyword, page: 1, pageSize: 20 });
                setOptions((result.users ?? []).map((user) => ({ value: user.id, label: `${user.displayName || user.username}（${user.username}）` })));
            } catch (error) {
                message.error(error instanceof Error ? error.message : "搜索用户失败");
            }
        },
        [message],
    );

    const save = async () => {
        setSaving(true);
        try {
            await updateAdminInviteInviters(record.userId, { l1InviterId: l1, l2InviterId: l2 });
            message.success("邀请关系已更新，待审核奖励已改挂");
            onSaved();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`编辑邀请关系 · ${record.inviteeDisplayName || record.inviteeUsername}`} open onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="保存">
            <div className="flex flex-col gap-4 py-2">
                <div>
                    <div className="mb-1.5 text-xs text-foreground/55">一级邀请人（留空表示清除）</div>
                    <Select
                        showSearch
                        allowClear
                        className="w-full"
                        placeholder="搜索用户名"
                        value={l1 || undefined}
                        defaultActiveFirstOption={false}
                        filterOption={false}
                        onSearch={(keyword) => void search(keyword)}
                        onChange={(value) => setL1(value ?? "")}
                        options={options}
                    />
                </div>
                <div>
                    <div className="mb-1.5 text-xs text-foreground/55">二级邀请人（留空表示清除）</div>
                    <Select
                        showSearch
                        allowClear
                        className="w-full"
                        placeholder="搜索用户名"
                        value={l2 || undefined}
                        defaultActiveFirstOption={false}
                        filterOption={false}
                        onSearch={(keyword) => void search(keyword)}
                        onChange={(value) => setL2(value ?? "")}
                        options={options}
                    />
                </div>
                <div className="text-xs text-foreground/40">保存后，该用户名下待审核奖励将改挂到新的邀请人；已入账奖励保持不变。</div>
            </div>
        </Modal>
    );
}
