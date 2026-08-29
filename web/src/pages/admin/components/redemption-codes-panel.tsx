import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Ban, Copy, Eye, KeyRound, RefreshCw, Search, TicketCheck } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/services/api/request";
import { createAdminRedeemBatch, disableAdminRedeemBatch, disableAdminRedeemCode, listAdminRedeemBatchCodes, listAdminRedeemBatches, type AdminRedeemCode, type RedeemBatch } from "@/services/api/wallet";
import { AdminDataTable, AdminExportButton, AdminRowActions, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";

type RedeemFormValues = { amount?: number | null; count?: number | null; note?: string; expiresAt?: string };
type PendingRedeemBatch = {
    amountMicrocredits: number;
    count: number;
    totalMicrocredits: number;
    note?: string;
    expiresAt?: string;
};
type BatchValidity = "all" | "active" | "expired";
type DetailStatus = "all" | "available" | "redeemed" | "expired" | "disabled";

const MICRO_CREDITS_PER_CREDIT = 1_000_000;
const DEFAULT_CREATE_VALUES: RedeemFormValues = { amount: 10, count: 10 };
const GENERATED_PREVIEW_LIMIT = 200;
const DETAIL_STATUS_LABELS: Record<DetailStatus, string> = {
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
                limit: targetPageSize,
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

function CreateRedeemBatchDrawer({
    open,
    creating,
    pending,
    form,
    watchedAmount,
    watchedCount,
    draftTotal,
    onClose,
    onPreview,
    onPendingChange,
    onConfirm,
}: {
    open: boolean;
    creating: boolean;
    pending: PendingRedeemBatch | null;
    form: ReturnType<typeof Form.useForm<RedeemFormValues>>[0];
    watchedAmount?: number | null;
    watchedCount?: number | null;
    draftTotal: number | null;
    onClose: () => void;
    onPreview: (values: RedeemFormValues) => void;
    onPendingChange: (values: PendingRedeemBatch | null) => void;
    onConfirm: () => void;
}) {
    return (
        <>
            <Drawer
                title="生成兑换码批次"
                open={open && !pending}
                size="min(600px, 100vw)"
                onClose={onClose}
                rootClassName="admin-drawer admin-redemption-drawer"
                destroyOnHidden
                mask={{ closable: !creating && !pending }}
                keyboard={!creating && !pending}
                closable={!creating && !pending}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={creating || Boolean(pending)} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" loading={creating} disabled={Boolean(pending)} icon={<TicketCheck className="size-4" />} onClick={() => form.submit()}>
                            核对并继续
                        </Button>
                    </div>
                }
            >
                <div className="admin-redemption-drawer-intro">
                    <span className="admin-redemption-drawer-intro-icon" aria-hidden="true">
                        <KeyRound className="size-4" />
                    </span>
                    <div>
                        <strong>批量生成敏感凭证</strong>
                        <p>确认后会一次性写入完整批次。接口没有自动重试，遇到网络异常时请先回到列表核对。</p>
                    </div>
                </div>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={DEFAULT_CREATE_VALUES} onFinish={onPreview}>
                    <section className="admin-redemption-drawer-section">
                        <div className="admin-redemption-drawer-section-heading">
                            <h3>批次参数</h3>
                            <p>积分最多保留 6 位小数；单批最多生成 5,000 个兑换码。</p>
                        </div>
                        <div className="admin-redemption-form-grid">
                            <Form.Item
                                name="amount"
                                label="每个兑换码的积分"
                                rules={[
                                    { required: true, message: "请填写积分面额" },
                                    {
                                        validator: (_, value) => {
                                            const numberValue = Number(value);
                                            const microcredits = Math.round(numberValue * MICRO_CREDITS_PER_CREDIT);
                                            return Number.isFinite(numberValue) && numberValue > 0 && Number.isSafeInteger(microcredits) && microcredits > 0 ? Promise.resolve() : Promise.reject(new Error("请输入可安全处理且大于 0 的积分"));
                                        },
                                    },
                                ]}
                            >
                                <InputNumber className="w-full" min={0.000001} precision={6} placeholder="例如 10" />
                            </Form.Item>
                            <Form.Item
                                name="count"
                                label="生成数量"
                                rules={[
                                    { required: true, message: "请填写生成数量" },
                                    {
                                        validator: (_, value) => (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5000 ? Promise.resolve() : Promise.reject(new Error("请输入 1–5000 的整数"))),
                                    },
                                ]}
                            >
                                <InputNumber className="w-full" min={1} max={5000} precision={0} placeholder="例如 100" />
                            </Form.Item>
                        </div>
                        <Form.Item
                            name="expiresAt"
                            label="过期时间"
                            extra="留空表示永久有效；最终以服务器时间为准。"
                            rules={[
                                {
                                    validator: (_, value) => {
                                        if (!value) return Promise.resolve();
                                        const timestamp = new Date(value).getTime();
                                        return Number.isFinite(timestamp) && timestamp > Date.now() ? Promise.resolve() : Promise.reject(new Error("过期时间必须晚于当前时间"));
                                    },
                                },
                            ]}
                        >
                            <Input type="datetime-local" aria-label="批次过期时间" />
                        </Form.Item>
                        <Form.Item name="note" label="批次备注" extra="用于列表检索和后续追溯，不会展示给兑换用户。">
                            <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：2026 年秋季活动发放" />
                        </Form.Item>
                        <dl className="admin-redemption-live-summary" aria-label="待生成批次摘要">
                            <div>
                                <dt>单码积分</dt>
                                <dd>{Number(watchedAmount) > 0 ? formatCredits(Math.round(Number(watchedAmount) * MICRO_CREDITS_PER_CREDIT)) : "--"}</dd>
                            </div>
                            <div>
                                <dt>生成数量</dt>
                                <dd>{Number.isInteger(Number(watchedCount)) && Number(watchedCount) > 0 ? `${Number(watchedCount)} 个` : "--"}</dd>
                            </div>
                            <div className="is-emphasis">
                                <dt>批次总面值</dt>
                                <dd>{draftTotal !== null ? formatCredits(draftTotal) : "--"}</dd>
                            </div>
                        </dl>
                    </section>
                </Form>
            </Drawer>

            <Modal
                title="确认生成兑换码批次"
                open={Boolean(pending)}
                okText="确认生成"
                cancelText="返回修改"
                onCancel={() => {
                    if (!creating) onPendingChange(null);
                }}
                onOk={onConfirm}
                confirmLoading={creating}
                mask={{ closable: !creating }}
                closable={!creating}
                keyboard={!creating}
                destroyOnHidden
                rootClassName="admin-modal-root"
            >
                {pending ? (
                    <div className="admin-operation-confirmation">
                        <p className="admin-operation-confirmation-copy">请核对本批次的总发放额度和有效期。确认后会立即生成，不能撤销整批记录。</p>
                        <dl className="admin-operation-confirmation-grid">
                            <div>
                                <dt>单码积分</dt>
                                <dd>{formatCredits(pending.amountMicrocredits)}</dd>
                            </div>
                            <div>
                                <dt>生成数量</dt>
                                <dd>{pending.count} 个</dd>
                            </div>
                            <div>
                                <dt>批次总面值</dt>
                                <dd className="is-positive">{formatCredits(pending.totalMicrocredits)}</dd>
                            </div>
                            <div>
                                <dt>过期时间</dt>
                                <dd>{pending.expiresAt ? formatTime(pending.expiresAt) : "永久有效"}</dd>
                            </div>
                            <div className="is-wide">
                                <dt>批次备注</dt>
                                <dd>{pending.note || "未填写"}</dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Modal>
        </>
    );
}

function BatchStatusDistribution({ batch }: { batch: RedeemBatch }) {
    return (
        <div className="admin-redemption-status-distribution" aria-label={`可用 ${batch.availableCount ?? 0}，已核销 ${batch.redeemedCount ?? 0}，已过期 ${batch.expiredCount ?? 0}，已禁用 ${batch.disabledCount ?? 0}`}>
            <AdminStatusBadge label={`可用 ${batch.availableCount ?? 0}`} tone="success" />
            <AdminStatusBadge label={`核销 ${batch.redeemedCount ?? 0}`} tone="info" />
            <AdminStatusBadge label={`过期 ${batch.expiredCount ?? 0}`} tone="warning" />
            <AdminStatusBadge label={`禁用 ${batch.disabledCount ?? 0}`} tone="neutral" />
        </div>
    );
}

function GeneratedCodesModal({ codes, batchId, onClose }: { codes: string[]; batchId: string; onClose: () => void }) {
    const { message } = App.useApp();
    const content = codes.join("\n");
    const previewContent = codes.slice(0, GENERATED_PREVIEW_LIMIT).join("\n");
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            message.success("全部兑换码已复制");
        } catch {
            message.error("复制失败，请使用下载 TXT 保存兑换码");
        }
    };
    return (
        <Modal
            title={`已生成 ${codes.length} 个兑换码`}
            open={codes.length > 0}
            onCancel={onClose}
            destroyOnHidden
            rootClassName="admin-modal-root"
            footer={
                <Space>
                    <Button onClick={onClose}>完成</Button>
                    <Button icon={<Copy className="size-4" />} onClick={() => void copy()}>
                        复制全部
                    </Button>
                    <AdminExportButton
                        type="primary"
                        exportFile={() => new Blob([content + "\n"], { type: "text/plain;charset=utf-8" })}
                        fileName={() => `兑换码-${batchId.slice(0, 8) || "新批次"}-${new Date().toISOString().slice(0, 10)}.txt`}
                        label="下载 TXT"
                    />
                </Space>
            }
            width={760}
        >
            <div className="admin-redemption-sensitive-notice" role="status">
                兑换码已加密保存，可在批次明细中再次查看；它们仍属于敏感信息，不会写入浏览器存储，建议立即下载一份用于发放。
            </div>
            {codes.length > GENERATED_PREVIEW_LIMIT ? (
                <p className="admin-generated-codes-preview-note">
                    为保持页面流畅，这里仅预览前 {GENERATED_PREVIEW_LIMIT} 个；复制和下载仍包含全部 {codes.length} 个兑换码。
                </p>
            ) : null}
            <Input.TextArea aria-label="新生成的兑换码预览" value={previewContent} readOnly autoSize={{ minRows: 10, maxRows: 18 }} className="font-mono text-xs" />
        </Modal>
    );
}

function RedeemBatchCodesModal({ batch, onClose, onBatchChanged }: { batch: RedeemBatch | null; onClose: () => void; onBatchChanged: () => void | Promise<unknown> }) {
    const { message } = App.useApp();
    const [batchSummary, setBatchSummary] = useState<RedeemBatch | null>(batch);
    const [codes, setCodes] = useState<AdminRedeemCode[]>([]);
    const [loading, setLoading] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [plaintextAvailable, setPlaintextAvailable] = useState(true);
    const [status, setStatus] = useState<DetailStatus>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [total, setTotal] = useState(0);
    const [disablingCodeIds, setDisablingCodeIds] = useState<Set<string>>(() => new Set());
    const requestRef = useRef(0);
    const codeMutationsRef = useRef(new Set<string>());

    const loadDetails = async (targetPage = page, targetPageSize = pageSize, targetStatus = status) => {
        if (!batch) return false;
        const requestId = ++requestRef.current;
        setLoading(true);
        setDetailError("");
        setCodes([]);
        setTotal(0);
        try {
            const result = await listAdminRedeemBatchCodes(batch.id, { status: targetStatus === "all" ? undefined : targetStatus, page: targetPage, limit: targetPageSize });
            if (requestId !== requestRef.current) return false;
            const lastPage = Math.max(1, Math.ceil(result.total / targetPageSize));
            if (targetPage > lastPage) {
                setPage(lastPage);
                return true;
            }
            setCodes(result.codes);
            setTotal(result.total);
            setPlaintextAvailable(result.plaintextAvailable);
            setBatchSummary(result.batch);
            return true;
        } catch (error) {
            if (requestId === requestRef.current) {
                const detail = error instanceof Error ? error.message : "读取兑换码明细失败";
                setDetailError(detail);
                message.error(detail);
            }
            return false;
        } finally {
            if (requestId === requestRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        void loadDetails(page, pageSize, status);
    }, [batch, page, pageSize, status]);

    const copyCode = async (code?: string) => {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            message.success("兑换码已复制");
        } catch {
            message.error("复制失败，请检查浏览器剪贴板权限");
        }
    };
    const copyPage = async () => {
        const content = codes
            .map((item) => item.code)
            .filter((code): code is string => Boolean(code))
            .join("\n");
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            message.success("本页兑换码已复制");
        } catch {
            message.error("复制失败，请检查浏览器剪贴板权限");
        }
    };
    const disableCode = async (item: AdminRedeemCode) => {
        if (!batch || codeMutationsRef.current.has(item.id)) return;
        codeMutationsRef.current.add(item.id);
        setDisablingCodeIds((current) => new Set(current).add(item.id));
        try {
            await disableAdminRedeemCode(batch.id, item.id);
            message.success("兑换码已禁用");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "禁用兑换码失败";
            if (isMutationResultUncertain(error)) message.warning({ content: `禁用结果暂时无法确认：${detail}。已刷新明细，请核对后再操作。`, duration: 6 });
            else message.error(detail);
        } finally {
            await Promise.all([loadDetails(page, pageSize, status), Promise.resolve(onBatchChanged())]);
            codeMutationsRef.current.delete(item.id);
            setDisablingCodeIds((current) => {
                const next = new Set(current);
                next.delete(item.id);
                return next;
            });
        }
    };
    const detailsMutating = disablingCodeIds.size > 0;
    const columns: ColumnsType<AdminRedeemCode> = [
        {
            title: "兑换码",
            width: 330,
            render: (_, item) => (
                <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{item.code || `明文不可恢复 ····${item.codeSuffix}`}</code>
                    <Button type="text" size="small" aria-label="复制兑换码" icon={<Copy className="size-3.5" />} disabled={!item.code || loading || detailsMutating} onClick={() => void copyCode(item.code)} />
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", width: 110, align: "center", render: renderCodeStatus },
        {
            title: "核销用户",
            width: 190,
            render: (_, item) =>
                item.redeemedBy ? (
                    <div>
                        <div className="text-sm">{item.redeemedDisplayName || item.redeemedUsername || item.redeemedBy}</div>
                        <div className="truncate text-xs text-foreground/40">{item.redeemedUsername ? `@${item.redeemedUsername}` : item.redeemedBy}</div>
                    </div>
                ) : (
                    <span className="text-foreground/35">--</span>
                ),
        },
        { title: "核销时间", dataIndex: "redeemedAt", width: 180, align: "center", render: formatTime },
        { title: "核销 IP", dataIndex: "redeemedIp", width: 150, align: "center", render: (value) => value || <span className="text-foreground/35">--</span> },
        {
            title: "操作",
            width: 90,
            align: "center",
            render: (_, item) =>
                item.status === "unused" ? (
                    <Popconfirm
                        title={`禁用尾号 ${item.codeSuffix} 的兑换码？`}
                        description={`该兑换码面值 ${formatCredits(item.amountMicrocredits)} 积分，禁用后无法恢复。`}
                        okText="确认禁用"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => disableCode(item)}
                    >
                        <Button type="text" size="small" danger disabled={detailsMutating && !disablingCodeIds.has(item.id)} loading={disablingCodeIds.has(item.id)} icon={<Ban className="size-3.5" />} aria-label="禁用兑换码" />
                    </Popconfirm>
                ) : (
                    <span className="text-xs text-foreground/35">--</span>
                ),
        },
    ];

    return (
        <Modal
            title={batchSummary ? `兑换码明细 · ${batchSummary.note || formatTime(batchSummary.createdAt)}` : "兑换码明细"}
            open={Boolean(batch)}
            onCancel={() => {
                if (!detailsMutating) onClose();
            }}
            destroyOnHidden
            mask={{ closable: !detailsMutating }}
            keyboard={!detailsMutating}
            closable={!detailsMutating}
            footer={
                <Space>
                    <Button icon={<Copy className="size-4" />} disabled={loading || detailsMutating || !codes.some((item) => item.code)} onClick={() => void copyPage()}>
                        复制本页
                    </Button>
                    <Button type="primary" disabled={detailsMutating} onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }
            width={1080}
            rootClassName="admin-modal-root"
        >
            {!plaintextAvailable ? <div className="admin-redemption-sensitive-notice is-warning">该批次创建于加密回看功能上线前，系统当时只保存了哈希，无法恢复完整明文；核销状态和审计信息仍可查看。</div> : null}
            <div className="admin-redemption-detail-summary">
                <BatchStatusDistribution batch={batchSummary || batch || emptyBatchSummary} />
                <span>单码 {formatCredits(batchSummary?.amountMicrocredits ?? batch?.amountMicrocredits ?? 0)} 积分</span>
                <span>总数 {batchSummary?.count ?? batch?.count ?? 0}</span>
                <span>{batchSummary?.expiresAt || batch?.expiresAt ? `到期 ${formatTime(batchSummary?.expiresAt || batch?.expiresAt)}` : "永久有效"}</span>
                <span>创建 {formatTime(batchSummary?.createdAt || batch?.createdAt)}</span>
                <code>批次 {String(batchSummary?.id || batch?.id || "").slice(0, 8)}</code>
            </div>
            <div className={`admin-modal-data-table-shell${detailsMutating ? " is-mutating" : ""}`}>
                <AdminDataTable
                    toolbar={
                        <Select<DetailStatus>
                            aria-label="按兑换码状态筛选"
                            className="w-32"
                            disabled={detailsMutating}
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={(Object.entries(DETAIL_STATUS_LABELS) as Array<[DetailStatus, string]>).map(([value, label]) => ({ value, label }))}
                        />
                    }
                    toolbarActive={status !== "all"}
                    onReset={() => {
                        if (detailsMutating) return;
                        setStatus("all");
                        setPage(1);
                    }}
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, columns, dataSource: codes, pagination: false, scroll: { x: 960 } }}
                    empty={<AdminTableEmpty filtered={status !== "all"} title={detailError ? "明细读取失败" : status === "all" ? "暂无兑换码" : undefined} description={detailError || undefined} />}
                    footer={
                        <PaginationBar
                            alwaysShow
                            current={page}
                            pageSize={pageSize}
                            total={total}
                            onChange={(nextPage, nextSize) => {
                                setPage(nextSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextSize);
                            }}
                        />
                    }
                />
            </div>
        </Modal>
    );
}

const emptyBatchSummary: RedeemBatch = {
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

function renderCodeStatus(status: AdminRedeemCode["status"]) {
    const config: Record<AdminRedeemCode["status"], { label: string; tone: AdminStatusTone }> = {
        unused: { label: "可用", tone: "success" },
        redeemed: { label: "已核销", tone: "info" },
        disabled: { label: "已禁用", tone: "neutral" },
        expired: { label: "已过期", tone: "warning" },
    };
    const configForStatus = config[status] || { label: "未知状态", tone: "neutral" as const };
    return <AdminStatusBadge label={configForStatus.label} tone={configForStatus.tone} />;
}

function isMutationResultUncertain(error: unknown) {
    if (!(error instanceof ApiError)) return true;
    return error.status === undefined || error.retryable || error.status >= 500;
}

function formatBatchDisableImpact(batch: RedeemBatch) {
    const availableCount = batch.availableCount ?? 0;
    const affectedMicrocredits = batch.amountMicrocredits * availableCount;
    const total = Number.isSafeInteger(affectedMicrocredits) ? `，面值合计 ${formatCredits(affectedMicrocredits)} 积分` : "";
    return `将禁用当前 ${availableCount} 个可用兑换码（单码 ${formatCredits(batch.amountMicrocredits)} 积分${total}）`;
}

function formatTime(value?: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
