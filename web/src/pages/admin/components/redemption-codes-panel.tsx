import { useEffect, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { Ban, Copy, Eye, KeyRound, RefreshCw, Search, TicketCheck } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createAdminRedeemBatch, disableAdminRedeemBatch, disableAdminRedeemCode, listAdminRedeemBatchCodes, listAdminRedeemBatches, type AdminRedeemCode, type RedeemBatch } from "@/services/api/wallet";
import { AdminDataTable, AdminExportButton, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type RedeemFormValues = { amount: number; count: number; note?: string; expiresAt?: string };

export default function RedemptionCodesPanel() {
    const { t, i18n } = useTranslation("canvas");
    const { message } = App.useApp();
    const [batches, setBatches] = useState<RedeemBatch[]>([]);
    const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
    const [selectedBatch, setSelectedBatch] = useState<RedeemBatch | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [validity, setValidity] = useState<"all" | "active" | "expired">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [form] = Form.useForm<RedeemFormValues>();

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        setLoading(true);
        try {
            const result = await listAdminRedeemBatches({ keyword: debouncedKeyword || undefined, validity: validity === "all" ? undefined : validity, page: targetPage, limit: targetPageSize });
            setBatches(result.batches);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-read-redemption-code-batches"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        form.setFieldsValue({ amount: 10, count: 10 });
    }, [form]);

    useEffect(() => {
        void reload(page, pageSize);
    }, [debouncedKeyword, validity, page, pageSize]);

    const createBatch = async () => {
        const values = await form.validateFields();
        setCreating(true);
        try {
            const result = await createAdminRedeemBatch({
                amountMicrocredits: Math.round(values.amount * 1_000_000),
                count: values.count,
                note: values.note?.trim(),
                expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined,
            });
            setGeneratedCodes(result.codes);
            const createdBatch: RedeemBatch = { ...result.batch, availableCount: result.batch.count, redeemedCount: 0, disabledCount: 0, expiredCount: 0 };
            setBatches((current) => [createdBatch, ...current.filter((item) => item.id !== createdBatch.id)].slice(0, pageSize));
            setTotal((current) => current + 1);
            setPage(1);
            message.success(t("admin:generated-param-redemption-codes", { length: result.codes.length }));
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("admin:failed-to-generate-redemption-codes");
            message.error(detail.toLowerCase().includes("timeout") ? t("admin:generation-took-over-30-seconds-it-may-still-have-completed-in-the-backg") : detail);
        } finally {
            setCreating(false);
        }
    };

    const columns: ColumnsType<RedeemBatch> = [
        { title: t("admin:created-at"), dataIndex: "createdAt", width: 180, render: formatTime },
        { title: t("admin:credits-per-code"), dataIndex: "amountMicrocredits", width: 130, align: "right", render: (value) => <span className="font-medium tabular-nums">{formatCredits(value)}</span> },
        { title: t("admin:count-2"), dataIndex: "count", width: 100, align: "right", render: (value) => <span className="tabular-nums">{value}</span> },
        {
            title: t("admin:redemption-status"),
            width: 180,
            render: (_, batch) => (
                <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">
                        {batch.redeemedCount ?? 0}/{batch.count}
                    </span>
                    <span className="text-xs text-foreground/45">{t("admin:redeemed-2")}</span>
                    {(batch.expiredCount ?? 0) > 0 ? <AdminStatusBadge label={t("admin:param-expired", { expiredCount: batch.expiredCount })} tone="warning" /> : null}
                </div>
            ),
        },
        { title: t("admin:validity-period"), dataIndex: "expiresAt", width: 180, render: (value) => (value ? formatTime(value) : <AdminStatusBadge label={t("admin:never-expires")} tone="info" />) },
        { title: t("admin:batch-note"), dataIndex: "note", render: (value) => value || <span className="text-foreground/35">{t("admin:not-filled-in-3")}</span> },
        {
            title: t("admin:actions"),
            width: 210,
            render: (_, batch) => (
                <AdminRowActions
                    primary={{ label: t("admin:view-details"), icon: <Eye className="size-3.5" />, onClick: () => setSelectedBatch(batch) }}
                    actions={[
                        {
                            key: "disable",
                            label: t("admin:disable-batch"),
                            icon: <Ban className="size-3.5" />,
                            danger: true,
                            disabled: (batch.availableCount ?? 0) <= 0,
                            confirm: { title: t("admin:disable-the-available-codes-in-this-batch"), description: t("admin:redeemed-and-expired-records-remain-unchanged"), okText: t("admin:confirm-disable-3") },
                            onClick: async () => {
                                try {
                                    const result = await disableAdminRedeemBatch(batch.id);
                                    message.success(t("admin:disabled-param-redemption-codes", { disabledCount: result.disabledCount }));
                                    await reload();
                                } catch (error) {
                                    message.error(error instanceof Error ? error.message : t("admin:failed-to-disable-batch"));
                                }
                            },
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <section className="shrink-0 rounded-lg bg-background p-4">
                <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                        <KeyRound className="size-4" />
                    </span>
                    <h2 className="text-sm font-semibold">{t("admin:generate-redemption-code-batch")}</h2>
                </div>
                <Form form={form} layout="vertical" requiredMark={false} className="mt-3 grid gap-x-3 md:grid-cols-12">
                    <Form.Item name="amount" label={t("admin:credits-per-code-2")} rules={[{ required: true, message: t("admin:enter-the-credit-amount") }]} className="md:col-span-3">
                        <InputNumber style={{ width: "100%" }} min={0.000001} precision={6} />
                    </Form.Item>
                    <Form.Item name="count" label={t("admin:generation-count")} rules={[{ required: true, message: t("admin:enter-the-generation-count") }]} className="md:col-span-2">
                        <InputNumber style={{ width: "100%" }} min={1} max={5000} precision={0} />
                    </Form.Item>
                    <Form.Item
                        name="expiresAt"
                        label={t("admin:expiration")}
                        className="md:col-span-3"
                        getValueFromEvent={(value) => (value ? value.toISOString() : undefined)}
                        getValueProps={(value?: string) => ({ value: value ? dayjs(value) : undefined })}
                    >
                        <DatePicker
                            showTime={{ format: "HH:mm" }}
                            format="YYYY-MM-DD HH:mm"
                            placeholder={i18n.language.startsWith("zh") ? "选择日期和时间" : "Select date and time"}
                            style={{ width: "100%" }}
                        />
                    </Form.Item>
                    <Form.Item name="note" label={t("admin:batch-note")} className="md:col-span-4">
                        <Input maxLength={500} placeholder={t("admin:e-g-july-campaign-giveaway")} />
                    </Form.Item>
                    <div className="flex items-center justify-end md:col-span-12">
                        <Button type="primary" loading={creating} icon={<TicketCheck className="size-4" />} onClick={() => void createBatch()}>
                            {t("admin:generate-codes")}
                        </Button>
                    </div>
                </Form>
            </section>

            <section className="flex min-h-0 flex-1">
                <AdminDataTable
                    toolbar={
                        <Input
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("admin:search-batch-notes-credits-or-count")}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                    }
                    toolbarActiveFilters={
                        <>
                            {keyword ? (
                                <AdminFilterChip
                                    label={t("admin:search-param", { keyword: keyword })}
                                    onRemove={() => {
                                        setKeyword("");
                                        setPage(1);
                                    }}
                                />
                            ) : null}
                            {validity !== "all" ? (
                                <AdminFilterChip
                                    label={`有效期：${validity === "active" ? t("admin:active") : t("admin:expired")}`}
                                    onRemove={() => {
                                        setValidity("all");
                                        setPage(1);
                                    }}
                                />
                            ) : null}
                        </>
                    }
                    toolbarActive={Boolean(keyword || validity !== "all")}
                    toolbarFilters={
                        <Select
                            className="w-36"
                            value={validity}
                            onChange={(value) => {
                                setValidity(value);
                                setPage(1);
                            }}
                            options={[
                                { label: t("admin:all-validity-periods"), value: "all" },
                                { label: t("admin:active"), value: "active" },
                                { label: t("admin:expired"), value: "expired" },
                            ]}
                        />
                    }
                    onReset={() => {
                        setKeyword("");
                        setValidity("all");
                        setPage(1);
                    }}
                    trailing={
                        <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void reload()}>
                            {t("admin:refresh-3")}
                        </Button>
                    }
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: batches, scroll: { x: 1080 } }}
                    empty={<AdminTableEmpty filtered={Boolean(keyword || validity !== "all")} title={t("admin:no-redemption-batches-yet")} />}
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

            <GeneratedCodesModal codes={generatedCodes} onClose={() => setGeneratedCodes([])} />
            <RedeemBatchCodesModal key={selectedBatch?.id || "closed"} batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
        </div>
    );
}

function GeneratedCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const content = codes.join("\n");
    const copy = async () => {
        await navigator.clipboard.writeText(content);
        message.success(t("admin:code-copied"));
    };
    return (
        <Modal
            title={t("admin:generated-param-redemption-codes", { length: codes.length })}
            open={codes.length > 0}
            onCancel={onClose}
            footer={
                <Space>
                    <Button icon={<Copy className="size-4" />} onClick={() => void copy()}>
                        {t("admin:copy-all")}
                    </Button>
                    <AdminExportButton type="primary" exportFile={() => new Blob([content + "\n"], { type: "text/plain;charset=utf-8" })} fileName={() => `兑换码-${new Date().toISOString().slice(0, 10)}.txt`} label={t("admin:download-txt")} />
                </Space>
            }
            width={760}
        >
            <div className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t("admin:codes-are-stored-encrypted-and-viewable-in-batch-details-downloading-a-c")}</div>
            <Input.TextArea value={content} readOnly autoSize={{ minRows: 10, maxRows: 18 }} className="font-mono text-xs" />
        </Modal>
    );
}

function RedeemBatchCodesModal({ batch, onClose }: { batch: RedeemBatch | null; onClose: () => void }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [batchSummary, setBatchSummary] = useState<RedeemBatch | null>(batch);
    const [codes, setCodes] = useState<AdminRedeemCode[]>([]);
    const [loading, setLoading] = useState(false);
    const [plaintextAvailable, setPlaintextAvailable] = useState(true);
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        if (!batch) return;
        let active = true;
        setLoading(true);
        void listAdminRedeemBatchCodes(batch.id, { status: status === "all" ? undefined : status, page, limit: pageSize })
            .then((result) => {
                if (!active) return;
                setCodes(result.codes);
                setTotal(result.total);
                setPlaintextAvailable(result.plaintextAvailable);
                setBatchSummary(result.batch);
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-read-code-details")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [batch, message, page, pageSize, status]);

    const copyCode = async (code?: string) => {
        if (!code) return;
        await navigator.clipboard.writeText(code);
        message.success(t("admin:code-copied"));
    };
    const copyPage = async () => {
        const content = codes
            .map((item) => item.code)
            .filter(Boolean)
            .join("\n");
        if (!content) return;
        await navigator.clipboard.writeText(content);
        message.success(t("admin:codes-on-this-page-copied"));
    };
    const disableCode = async (item: AdminRedeemCode) => {
        if (!batch) return;
        try {
            await disableAdminRedeemCode(batch.id, item.id);
            setCodes((current) => current.map((code) => (code.id === item.id ? { ...code, status: "disabled" } : code)));
            setBatchSummary((current) => (current ? { ...current, availableCount: Math.max(0, current.availableCount - 1), disabledCount: current.disabledCount + 1 } : current));
            message.success(t("admin:codes-disabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-disable-codes"));
        }
    };
    const columns: ColumnsType<AdminRedeemCode> = [
        {
            title: t("admin:redemption-codes"),
            width: 330,
            render: (_, item) => (
                <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{item.code || t("admin:plaintext-unrecoverable-param", { codeSuffix: item.codeSuffix })}</code>
                    <Button type="text" size="small" aria-label={t("admin:copy-code")} icon={<Copy className="size-3.5" />} disabled={!item.code} onClick={() => void copyCode(item.code)} />
                </div>
            ),
        },
        { title: t("admin:status"), dataIndex: "status", width: 110, render: renderCodeStatus },
        {
            title: t("admin:redeemed-by"),
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
        { title: t("admin:redeemed-at"), dataIndex: "redeemedAt", width: 180, render: formatTime },
        { title: t("admin:redemption-ip"), dataIndex: "redeemedIp", width: 150, render: (value) => value || <span className="text-foreground/35">--</span> },
        {
            title: t("admin:actions"),
            width: 90,
            render: (_, item) =>
                item.status === "unused" ? (
                    <Popconfirm title={t("admin:disable-this-code")} okText={t("admin:disable")} cancelText={t("admin:cancel-4")} okButtonProps={{ danger: true }} onConfirm={() => void disableCode(item)}>
                        <Button type="text" size="small" danger icon={<Ban className="size-3.5" />} aria-label={t("admin:disable-code")} />
                    </Popconfirm>
                ) : (
                    <span className="text-xs text-foreground/35">--</span>
                ),
        },
    ];

    return (
        <Modal
            title={batchSummary ? `兑换码明细 · ${batchSummary.note || formatTime(batchSummary.createdAt)}` : t("admin:code-details")}
            open={Boolean(batch)}
            onCancel={onClose}
            footer={
                <Space>
                    <Button icon={<Copy className="size-4" />} disabled={!codes.some((item) => item.code)} onClick={() => void copyPage()}>
                        {t("admin:copy-this-page")}
                    </Button>
                    <Button type="primary" onClick={onClose}>
                        {t("admin:close-4")}
                    </Button>
                </Space>
            }
            width={1080}
            rootClassName="admin-modal-root"
        >
            {!plaintextAvailable ? <div className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t("admin:this-batch-was-created-before-encrypted-lookups-shipped-only-hashes-were")}</div> : null}
            <div className="mb-3 flex flex-wrap gap-2">
                <AdminStatusBadge label={`可用 ${batchSummary?.availableCount ?? 0}`} tone="success" />
                <AdminStatusBadge label={`已核销 ${batchSummary?.redeemedCount ?? 0}`} tone="info" />
                <AdminStatusBadge label={`已过期 ${batchSummary?.expiredCount ?? 0}`} tone="warning" />
                <AdminStatusBadge label={`已禁用 ${batchSummary?.disabledCount ?? 0}`} tone="neutral" />
            </div>
            <div className="admin-modal-data-table-shell">
                <AdminDataTable
                    toolbar={
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: t("admin:all-statuses"), value: "all" },
                                { label: t("admin:available-2"), value: "available" },
                                { label: t("admin:redeemed-2"), value: "redeemed" },
                                { label: t("admin:expired"), value: "expired" },
                                { label: t("admin:disabled-3"), value: "disabled" },
                            ]}
                        />
                    }
                    toolbarActiveFilters={
                        status !== "all" ? (
                            <AdminFilterChip
                                label={t("admin:status-param", { status: status })}
                                onRemove={() => {
                                    setStatus("all");
                                    setPage(1);
                                }}
                            />
                        ) : null
                    }
                    toolbarActive={status !== "all"}
                    onReset={() => {
                        setStatus("all");
                        setPage(1);
                    }}
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, columns, dataSource: codes, pagination: false, scroll: { x: 960 } }}
                    empty={<AdminTableEmpty filtered={status !== "all"} title={t("admin:no-redemption-codes-yet")} />}
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

function renderCodeStatus(status: AdminRedeemCode["status"]) {
    const config: Record<AdminRedeemCode["status"], { label: string; tone: AdminStatusTone }> = {
        unused: { label: t("admin:available-2"), tone: "success" },
        redeemed: { label: t("admin:redeemed-2"), tone: "info" },
        disabled: { label: t("admin:disabled-3"), tone: "neutral" },
        expired: { label: t("admin:expired"), tone: "warning" },
    };
    const configForStatus = config[status];
    return <AdminStatusBadge label={configForStatus.label} tone={configForStatus.tone} />;
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
