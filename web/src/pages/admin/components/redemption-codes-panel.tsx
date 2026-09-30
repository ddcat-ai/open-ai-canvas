import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Form, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Ban, Eye, RefreshCw, Search, TicketCheck } from "lucide-react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/services/api/request";
import { createAdminRedeemBatch, disableAdminRedeemBatch, listAdminRedeemBatches, type AdminRedeemCode, type RedeemBatch } from "@/services/api/wallet";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";
import { Select } from "@/components/ui/base/select";
import { BatchStatusDistribution, CreateRedeemBatchDrawer, GeneratedCodesModal, RedeemBatchCodesModal } from "./redemption-codes-modals";

export type RedeemFormValues = { amount?: number | null; count?: number | null; note?: string; expiresAt?: string };
export type PendingRedeemBatch = {
    amountMicrocredits: number;
    count: number;
    totalMicrocredits: number;
    note?: string;
    expiresAt?: string;
};
type BatchValidity = "all" | "active" | "expired";
export type DetailStatus = "all" | "available" | "redeemed" | "expired" | "disabled";

export const MICRO_CREDITS_PER_CREDIT = 1_000_000;
export const DEFAULT_CREATE_VALUES: RedeemFormValues = { amount: 10, count: 10 };
export const GENERATED_PREVIEW_LIMIT = 200;
export const DETAIL_STATUS_LABELS: Record<DetailStatus, string> = {
    all: "全部状态",
    available: "可用",
    redeemed: "已核销",
    expired: "已过期",
    disabled: "已禁用",
};

export default function RedemptionCodesPanel({ createOpen, onCreateOpenChange, onCreateBlockedChange }: { createOpen: boolean; onCreateOpenChange: (open: boolean) => void; onCreateBlockedChange: (blocked: boolean) => void }) {
    const { message } = App.useApp();
    const [batches, setBatches] = useState<RedeemBatch[]>([]);
    const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
    const [generatedBatchId, setGeneratedBatchId] = useState("");
    const [selectedBatch, setSelectedBatch] = useState<RedeemBatch | null>(null);
    const [pendingCreate, setPendingCreate] = useState<PendingRedeemBatch | null>(null);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState("");
    const [uncertainCreateNotice, setUncertainCreateNotice] = useState("");
    const [creating, setCreating] = useState(false);
    const [disablingBatchIds, setDisablingBatchIds] = useState<Set<string>>(() => new Set());
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [validity, setValidity] = useState<BatchValidity>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [form] = Form.useForm<RedeemFormValues>();
    const listRequestRef = useRef(0);
    const createInFlightRef = useRef(false);
    const batchMutationsRef = useRef(new Set<string>());
    const watchedAmount = Form.useWatch("amount", form);
    const watchedCount = Form.useWatch("count", form);

    const draftTotal = useMemo(() => {
        const amount = Number(watchedAmount);
        const count = Number(watchedCount);
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(count) || count <= 0) return null;
        const amountMicrocredits = Math.round(amount * MICRO_CREDITS_PER_CREDIT);
        const totalMicrocredits = amountMicrocredits * count;
        return Number.isSafeInteger(amountMicrocredits) && Number.isSafeInteger(totalMicrocredits) ? totalMicrocredits : null;
    }, [watchedAmount, watchedCount]);

    const reload = async (targetPage = page, targetPageSize = pageSize, queryOverride?: { keyword?: string; validity?: BatchValidity }) => {
        const requestId = ++listRequestRef.current;
        const queryKeyword = (queryOverride?.keyword ?? debouncedKeyword).trim();
        const queryValidity = queryOverride?.validity ?? validity;
        setLoading(true);
        setListError("");
        setBatches([]);
        setTotal(0);
        try {
            const result = await listAdminRedeemBatches({
                keyword: queryKeyword || undefined,
                validity: queryValidity === "all" ? undefined : queryValidity,
                page: targetPage,
                pageSize: targetPageSize,
            });
            if (requestId !== listRequestRef.current) return false;
            const lastPage = Math.max(1, Math.ceil(result.total / targetPageSize));
            if (targetPage > lastPage) {
                setPage(lastPage);
                return true;
            }
            setBatches(result.batches);
            setTotal(result.total);
            return true;
        } catch (error) {
            if (requestId === listRequestRef.current) {
                const detail = error instanceof Error ? error.message : "读取兑换码批次失败";
                setListError(detail);
                message.error(detail);
            }
            return false;
        } finally {
            if (requestId === listRequestRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        if (createOpen) form.setFieldsValue(DEFAULT_CREATE_VALUES);
    }, [createOpen, form]);

    useEffect(() => {
        void reload(page, pageSize);
    }, [debouncedKeyword, validity, page, pageSize]);

    const closeCreateDrawer = () => {
        if (creating || pendingCreate) return;
        form.resetFields();
        onCreateOpenChange(false);
    };

    const previewCreate = (values: RedeemFormValues) => {
        const amount = Number(values.amount);
        const count = Number(values.count);
        const amountMicrocredits = Math.round(amount * MICRO_CREDITS_PER_CREDIT);
        const totalMicrocredits = amountMicrocredits * count;
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountMicrocredits) || amountMicrocredits <= 0 || !Number.isInteger(count) || count < 1 || count > 5000 || !Number.isSafeInteger(totalMicrocredits)) {
            message.error("积分面额或生成数量超出可安全处理的范围");
            return;
        }
        let expiresAt: string | undefined;
        if (values.expiresAt) {
            const timestamp = new Date(values.expiresAt);
            if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() <= Date.now()) {
                form.setFields([{ name: "expiresAt", errors: ["过期时间必须晚于当前时间"] }]);
                return;
            }
            expiresAt = timestamp.toISOString();
        }
        setPendingCreate({ amountMicrocredits, count, totalMicrocredits, note: values.note?.trim() || undefined, expiresAt });
    };

    const createBatch = async () => {
        if (!pendingCreate || createInFlightRef.current) return;
        createInFlightRef.current = true;
        setCreating(true);
        try {
            const result = await createAdminRedeemBatch({
                amountMicrocredits: pendingCreate.amountMicrocredits,
                count: pendingCreate.count,
                note: pendingCreate.note,
                expiresAt: pendingCreate.expiresAt,
            });
            setPendingCreate(null);
            form.resetFields();
            onCreateOpenChange(false);
            setGeneratedCodes(result.codes);
            setGeneratedBatchId(result.batch.id);
            setPage(1);
            await reload(1, pageSize);
            message.success(`已生成 ${result.codes.length} 个兑换码`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "生成兑换码失败";
            if (isMutationResultUncertain(error)) {
                setPendingCreate(null);
                form.resetFields();
                onCreateOpenChange(false);
                onCreateBlockedChange(true);
                setPage(1);
                setKeyword("");
                setValidity("all");
                const refreshed = await reload(1, pageSize, { keyword: "", validity: "all" });
                setUncertainCreateNotice(`上一次生成请求的结果暂时无法确认：${detail}。${refreshed ? "已切换到未筛选的完整列表，请核对最新批次。" : "完整列表刷新失败，请在网络恢复后再次刷新。"} 核对完成前，生成入口已暂停。`);
                message.warning({ content: "生成结果待核对，系统没有自动重试。请检查完整批次列表后再继续。", duration: 7 });
            } else {
                setPendingCreate(null);
                message.error(detail);
            }
        } finally {
            createInFlightRef.current = false;
            setCreating(false);
        }
    };

    const disableBatch = async (batch: RedeemBatch) => {
        if (batchMutationsRef.current.has(batch.id)) return;
        batchMutationsRef.current.add(batch.id);
        setDisablingBatchIds((current) => new Set(current).add(batch.id));
        try {
            const result = await disableAdminRedeemBatch(batch.id);
            message.success(`已禁用 ${result.disabledCount} 个兑换码`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "禁用批次失败";
            if (isMutationResultUncertain(error)) message.warning({ content: `禁用结果暂时无法确认：${detail}。已刷新批次状态，请核对后再操作。`, duration: 6 });
            else message.error(detail);
        } finally {
            batchMutationsRef.current.delete(batch.id);
            setDisablingBatchIds((current) => {
                const next = new Set(current);
                next.delete(batch.id);
                return next;
            });
            await reload(page, pageSize);
        }
    };

    const columns: ColumnsType<RedeemBatch> = [
        {
            title: "批次",
            width: 240,
            render: (_, batch) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{batch.note || "未备注批次"}</div>
                    <div className="mt-0.5 text-xs text-foreground/45">{formatTime(batch.createdAt)}</div>
                </div>
            ),
        },
        { title: "单码积分", dataIndex: "amountMicrocredits", width: 120, align: "center", render: (value) => <span className="font-medium tabular-nums">{formatCredits(value)}</span> },
        { title: "总数", dataIndex: "count", width: 80, align: "center", render: (value) => <span className="tabular-nums">{value}</span> },
        { title: "状态分布", width: 300, align: "center", render: (_, batch) => <BatchStatusDistribution batch={batch} /> },
        { title: "过期时间", dataIndex: "expiresAt", width: 180, align: "center", render: (value) => (value ? formatTime(value) : <AdminStatusBadge label="永久有效" tone="info" />) },
        {
            title: "操作",
            width: 220,
            align: "center",
            render: (_, batch) => (
                <div className="flex justify-center">
                    <AdminRowActions
                        primary={{ label: "查看明细", icon: <Eye className="size-3.5" />, onClick: () => setSelectedBatch(batch) }}
                        actions={[
                            {
                                key: "disable",
                                label: "禁用批次",
                                icon: <Ban className="size-3.5" />,
                                danger: true,
                                disabled: (batch.availableCount ?? 0) <= 0 || disablingBatchIds.has(batch.id),
                                confirm: {
                                    title: "禁用该批次的可用兑换码？",
                                    description: `${batch.note || `批次 ${batch.id.slice(0, 8)}`}：${formatBatchDisableImpact(batch)}；已核销和已过期记录不变，操作不可撤销。`,
                                    okText: "确认禁用",
                                },
                                onClick: () => disableBatch(batch),
                            },
                        ]}
                    />
                </div>
            ),
        },
    ];
    const hasFilters = Boolean(keyword.trim() || validity !== "all");

    return (
        <div className="admin-redemption-codes flex min-h-0 flex-1 flex-col">
            {uncertainCreateNotice ? (
                <div className="admin-redemption-uncertain-notice" role="alert">
                    <div>
                        <strong>生成结果待核对</strong>
                        <p>{uncertainCreateNotice}</p>
                    </div>
                    <Button
                        loading={loading}
                        onClick={() => {
                            void (async () => {
                                setKeyword("");
                                setValidity("all");
                                setPage(1);
                                const refreshed = await reload(1, pageSize, { keyword: "", validity: "all" });
                                if (!refreshed) return;
                                setUncertainCreateNotice("");
                                onCreateBlockedChange(false);
                                message.success("完整批次列表已刷新，请确认没有重复批次后再生成");
                            })();
                        }}
                    >
                        刷新完整列表
                    </Button>
                </div>
            ) : null}
            <section className="flex min-h-0 flex-1" aria-label="兑换码批次列表">
                <AdminDataTable
                    toolbar={
                        <Input
                            allowClear
                            aria-label="搜索兑换码批次"
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索批次备注、积分或数量"
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                    }
                    toolbarActive={hasFilters}
                    toolbarFilters={
                        <Select<BatchValidity>
                            aria-label="按批次到期状态筛选"
                            className="w-44"
                            value={validity}
                            onChange={(value) => {
                                setValidity(value);
                                setPage(1);
                            }}
                            options={[
                                { label: "全部到期状态", value: "all" },
                                { label: "批次未到期", value: "active" },
                                { label: "批次已到期", value: "expired" },
                            ]}
                        />
                    }
                    onReset={() => {
                        setKeyword("");
                        setValidity("all");
                        setPage(1);
                    }}
                    trailing={
                        <Button
                            type="text"
                            size="small"
                            icon={<RefreshCw className="size-3.5" />}
                            loading={loading}
                            onClick={() => {
                                void reload();
                            }}
                        >
                            刷新
                        </Button>
                    }
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: batches }}
                    empty={
                        <AdminTableEmpty
                            filtered={hasFilters}
                            title={listError ? "批次读取失败" : !hasFilters ? "暂无兑换码批次" : undefined}
                            description={listError || (!hasFilters ? "生成后的批次会在这里集中展示和追踪。" : undefined)}
                            action={
                                !listError && !hasFilters && !uncertainCreateNotice ? (
                                    <Button type="primary" icon={<TicketCheck className="size-4" />} onClick={() => onCreateOpenChange(true)}>
                                        生成首个批次
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                    footer={
                        <PaginationBar
                            alwaysShow
                            current={page}
                            pageSize={pageSize}
                            total={total}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    }
                />
            </section>

            <CreateRedeemBatchDrawer
                open={createOpen}
                creating={creating}
                pending={pendingCreate}
                form={form}
                watchedAmount={watchedAmount}
                watchedCount={watchedCount}
                draftTotal={draftTotal}
                onClose={closeCreateDrawer}
                onPreview={previewCreate}
                onPendingChange={setPendingCreate}
                onConfirm={() => void createBatch()}
            />

            <GeneratedCodesModal
                codes={generatedCodes}
                batchId={generatedBatchId}
                onClose={() => {
                    setGeneratedCodes([]);
                    setGeneratedBatchId("");
                }}
            />
            <RedeemBatchCodesModal key={selectedBatch?.id || "closed"} batch={selectedBatch} onClose={() => setSelectedBatch(null)} onBatchChanged={() => reload(page, pageSize)} />
        </div>
    );
}

export const emptyBatchSummary: RedeemBatch = {
    id: "",
    amountMicrocredits: 0,
    count: 0,
    createdBy: "",
    createdAt: "",
    availableCount: 0,
    redeemedCount: 0,
    disabledCount: 0,
    expiredCount: 0,
};

export function renderCodeStatus(status: AdminRedeemCode["status"]) {
    const config: Record<AdminRedeemCode["status"], { label: string; tone: AdminStatusTone }> = {
        unused: { label: "可用", tone: "success" },
        redeemed: { label: "已核销", tone: "info" },
        disabled: { label: "已禁用", tone: "neutral" },
        expired: { label: "已过期", tone: "warning" },
    };
    const configForStatus = config[status] || { label: "未知状态", tone: "neutral" as const };
    return <AdminStatusBadge label={configForStatus.label} tone={configForStatus.tone} />;
}

export function isMutationResultUncertain(error: unknown) {
    if (!(error instanceof ApiError)) return true;
    return error.status === undefined || error.retryable || error.status >= 500;
}

function formatBatchDisableImpact(batch: RedeemBatch) {
    const availableCount = batch.availableCount ?? 0;
    const affectedMicrocredits = batch.amountMicrocredits * availableCount;
    const total = Number.isSafeInteger(affectedMicrocredits) ? `，面值合计 ${formatCredits(affectedMicrocredits)} 积分` : "";
    return `将禁用当前 ${availableCount} 个可用兑换码（单码 ${formatCredits(batch.amountMicrocredits)} 积分${total}）`;
}

export function formatTime(value?: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
