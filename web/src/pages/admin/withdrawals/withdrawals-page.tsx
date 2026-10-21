import { App, Button, DatePicker, Descriptions, Input, Modal, Select, Tag } from "antd";
import { Banknote, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminRowActions, PaginationBar } from "../components/admin-ui";
import { AdminDrawer } from "../ui/overlays";
import { approveAdminWithdrawal, getAdminWithdrawalDetail, listAdminWithdrawals, rejectAdminWithdrawal, type AdminWithdrawDetail, type AdminWithdrawRecord } from "@/services/api/invite";

const PAGE_SIZE = 20;

type DraftFilters = { status: string; method: string; keyword: string; range: [string, string] | null };
const emptyFilters: DraftFilters = { status: "", method: "", keyword: "", range: null };

function formatYuan(microYuan: number) {
    return `¥ ${(microYuan / 1_000_000).toFixed(2)}`;
}

export function WithdrawStatusBadge({ status }: { status: 0 | 1 | 2 }) {
    if (status === 0) return <AdminStatusBadge label="审核中" tone="warning" />;
    if (status === 1) return <AdminStatusBadge label="已驳回" tone="error" />;
    return <AdminStatusBadge label="已成功" tone="success" />;
}

export default function WithdrawalsPage() {
    const { message, modal } = App.useApp();
    const [draft, setDraft] = useState<DraftFilters>(emptyFilters);
    const [applied, setApplied] = useState<DraftFilters>(emptyFilters);
    const [page, setPage] = useState(1);
    const [records, setRecords] = useState<AdminWithdrawRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [rejecting, setRejecting] = useState(false);
    const rejectingRef = useRef(false);
    const [detail, setDetail] = useState<AdminWithdrawDetail | null>(null);
    const [rejectTarget, setRejectTarget] = useState<AdminWithdrawRecord | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const sequence = useRef(0);

    const load = useCallback(
        async (targetPage: number, filters: DraftFilters) => {
            const current = ++sequence.current;
            setLoading(true);
            setLoadError("");
            try {
                const result = await listAdminWithdrawals({
                    status: filters.status === "" ? "" : Number(filters.status),
                    method: filters.method,
                    keyword: filters.keyword.trim(),
                    from: filters.range?.[0],
                    until: filters.range?.[1],
                    page: targetPage,
                    pageSize: PAGE_SIZE,
                });
                if (current !== sequence.current) return;
                setRecords(result.records ?? []);
                setTotal(result.total ?? 0);
            } catch (error) {
                if (current === sequence.current) setLoadError(error instanceof Error ? error.message : "读取提现记录失败");
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

    const approve = (record: AdminWithdrawRecord) => {
        modal.confirm({
            title: "确认该提现已打款成功？",
            content: `用户 ${record.displayName || record.username} · ${formatYuan(record.amountMicroYuan)}（实到 ${formatYuan(record.actualMicroYuan)}）。确认后冻结余额转为已使用，操作不可撤销。`,
            okText: "确认成功",
            okButtonProps: { danger: false },
            onOk: async () => {
                try {
                    await approveAdminWithdrawal(record.id);
                    message.success("提现已确认成功");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "操作失败");
                }
            },
        });
    };

    const reject = async () => {
        if (!rejectTarget || rejectingRef.current) return;
        if (!rejectReason.trim()) {
            message.warning("请填写驳回原因");
            return;
        }
        rejectingRef.current = true;
        setRejecting(true);
        try {
            await rejectAdminWithdrawal(rejectTarget.id, rejectReason.trim());
            message.success("已驳回，冻结金额已退回用户可用余额");
            setRejectTarget(null);
            setRejectReason("");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            rejectingRef.current = false;
            setRejecting(false);
        }
    };

    const openDetail = async (record: AdminWithdrawRecord) => {
        try {
            setDetail(await getAdminWithdrawalDetail(record.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取详情失败");
        }
    };

    const methodLabel = (method: string) => (method === "wechat" ? "微信" : method === "alipay" ? "支付宝" : "银行卡");

    const columns = [
        {
            title: "用户",
            key: "user",
            width: 160,
            render: (_: unknown, record: AdminWithdrawRecord) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{record.displayName || record.username}</div>
                    <div className="truncate text-xs text-foreground/45">{record.username}</div>
                </div>
            ),
        },
        { title: "金额", key: "amount", width: 110, render: (_: unknown, record: AdminWithdrawRecord) => <span className="font-medium tabular-nums">{formatYuan(record.amountMicroYuan)}</span> },
        { title: "手续费", key: "fee", width: 100, render: (_: unknown, record: AdminWithdrawRecord) => <span className="tabular-nums text-foreground/60">{formatYuan(record.feeMicroYuan)}</span> },
        { title: "实到", key: "actual", width: 110, render: (_: unknown, record: AdminWithdrawRecord) => <span className="font-medium tabular-nums">{formatYuan(record.actualMicroYuan)}</span> },
        { title: "方式", key: "method", width: 90, render: (_: unknown, record: AdminWithdrawRecord) => methodLabel(record.method) },
        { title: "状态", key: "status", width: 100, render: (_: unknown, record: AdminWithdrawRecord) => <WithdrawStatusBadge status={record.status} /> },
        { title: "申请时间", key: "createdAt", width: 170, render: (_: unknown, record: AdminWithdrawRecord) => <span className="tabular-nums text-foreground/60">{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</span> },
        {
            title: "审核时间",
            key: "reviewedAt",
            width: 170,
            render: (_: unknown, record: AdminWithdrawRecord) => <span className="tabular-nums text-foreground/60">{record.reviewedAt ? new Date(record.reviewedAt).toLocaleString("zh-CN", { hour12: false }) : "--"}</span>,
        },
        {
            title: "操作",
            key: "actions",
            width: 190,
            fixed: "right" as const,
            render: (_: unknown, record: AdminWithdrawRecord) => (
                <AdminRowActions
                    primary={{ label: "详情", onClick: () => void openDetail(record) }}
                    actions={[
                        ...(record.status === 0
                            ? [
                                  { key: "approve", label: "确认成功", danger: false, onClick: () => approve(record) },
                                  {
                                      key: "reject",
                                      label: "驳回",
                                      danger: true,
                                      onClick: () => {
                                          setRejectTarget(record);
                                          setRejectReason("");
                                      },
                                  },
                              ]
                            : []),
                    ]}
                    visibleActionCount={2}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="提现记录"
            description="奖励余额提现申请的审核与记账"
            actions={
                <Button icon={<RefreshCw className="size-4" />} onClick={reload}>
                    刷新
                </Button>
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
                        placeholder="用户名 / 显示名称 / 用户 ID"
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
                                { label: "审核中", value: "0" },
                                { label: "已驳回", value: "1" },
                                { label: "已成功", value: "2" },
                            ]}
                        />
                        <Select
                            className="w-32"
                            placeholder="方式"
                            allowClear
                            value={draft.method || undefined}
                            onChange={(value) => setDraft({ ...draft, method: value ?? "" })}
                            options={[
                                { label: "微信", value: "wechat" },
                                { label: "支付宝", value: "alipay" },
                                { label: "银行卡", value: "bank" },
                            ]}
                        />
                        <DatePicker.RangePicker
                            value={draft.range ? [dayjs(draft.range[0]), dayjs(draft.range[1])] : null}
                            onChange={(_, dateString) => {
                                const pair = Array.isArray(dateString) && dateString[0] ? ([dateString[0], dateString[1]] as [string, string]) : null;
                                setDraft({ ...draft, range: pair });
                            }}
                        />
                        <Button type="primary" onClick={query}>
                            查询
                        </Button>
                        {filtersDirty ? <Tag color="warning">筛选未应用</Tag> : null}
                    </>
                }
                table={{
                    rowKey: "id",
                    loading,
                    columns,
                    dataSource: records,
                    pagination: false,
                    tableLayout: "fixed",
                    scroll: { x: 1220 },
                }}
                footer={<PaginationBar alwaysShow current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />}
                empty={
                    <div className="flex flex-col items-center gap-2 py-10 text-foreground/45">
                        <Banknote className="size-5" />
                        <div className="text-sm">暂无提现记录</div>
                        <div className="text-xs">用户提交的提现申请会出现在这里。</div>
                    </div>
                }
            />

            <AdminDrawer title="提现详情" open={Boolean(detail)} onClose={() => setDetail(null)} size="min(560px, 100vw)">
                {detail ? (
                    <div className="flex flex-col gap-4">
                        <Descriptions
                            column={1}
                            bordered
                            size="small"
                            items={[
                                { key: "user", label: "用户", children: `${detail.record.displayName || detail.record.username}（${detail.record.username}）` },
                                { key: "amount", label: "提现金额", children: formatYuan(detail.record.amountMicroYuan) },
                                { key: "fee", label: "手续费", children: formatYuan(detail.record.feeMicroYuan) },
                                { key: "actual", label: "实际到账", children: formatYuan(detail.record.actualMicroYuan) },
                                { key: "method", label: "提现方式", children: methodLabel(detail.record.method) },
                                { key: "status", label: "状态", children: <WithdrawStatusBadge status={detail.record.status} /> },
                                { key: "createdAt", label: "申请时间", children: new Date(detail.record.createdAt).toLocaleString("zh-CN", { hour12: false }) },
                                ...(detail.record.rejectReason ? [{ key: "reason", label: "驳回原因", children: detail.record.rejectReason }] : []),
                            ]}
                        />
                        <div>
                            <div className="mb-2 text-sm font-medium">收款信息</div>
                            <Descriptions
                                column={1}
                                bordered
                                size="small"
                                items={
                                    detail.record.method === "bank"
                                        ? [
                                              { key: "bankName", label: "开户行", children: detail.account?.bankName || "--" },
                                              { key: "cardNumber", label: "银行卡号", children: detail.account?.cardNumber || "--" },
                                              { key: "holderName", label: "持卡人", children: detail.account?.holderName || "--" },
                                          ]
                                        : [
                                              { key: "account", label: "收款账号", children: detail.account?.account || "--" },
                                              { key: "realName", label: "实名", children: detail.account?.realName || "--" },
                                              { key: "qrCodeUrl", label: "收款码", children: detail.account?.qrCodeUrl || "未填写" },
                                          ]
                                }
                            />
                        </div>
                    </div>
                ) : null}
            </AdminDrawer>

            <Modal
                title="驳回提现申请"
                open={Boolean(rejectTarget)}
                onOk={() => void reject()}
                onCancel={() => setRejectTarget(null)}
                okText="确认驳回"
                confirmLoading={rejecting}
                cancelButtonProps={{ disabled: rejecting }}
                closable={!rejecting}
                maskClosable={!rejecting}
                okButtonProps={{ danger: true }}
            >
                <div className="flex flex-col gap-3 py-2">
                    <div className="text-sm text-foreground/60">驳回后冻结金额将退回用户可用余额，必须说明原因。</div>
                    <Input.TextArea rows={3} maxLength={200} showCount placeholder="请填写驳回原因" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
                </div>
            </Modal>
        </AdminPageFrame>
    );
}
