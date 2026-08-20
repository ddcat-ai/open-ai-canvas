import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Ban, Copy, Eye, KeyRound, RefreshCw, Search, TicketCheck } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createAdminRedeemBatch, disableAdminRedeemBatch, disableAdminRedeemCode, listAdminRedeemBatchCodes, listAdminRedeemBatches, type AdminRedeemCode, type RedeemBatch } from "@/services/api/wallet";
import { AdminDataTable, AdminExportButton, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";

type RedeemFormValues = { amount: number; count: number; note?: string; expiresAt?: string };

export default function RedemptionCodesPanel() {
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
            message.error(error instanceof Error ? error.message : "读取兑换码批次失败");
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
            message.success(`已生成 ${result.codes.length} 个兑换码`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "生成兑换码失败";
            message.error(detail.toLowerCase().includes("timeout") ? "生成超过 30 秒，后台可能仍已完成；请刷新批次列表确认，兑换码可从批次明细重新查看。" : detail);
        } finally {
            setCreating(false);
        }
    };

    const columns: ColumnsType<RedeemBatch> = [
        { title: "创建时间", dataIndex: "createdAt", width: 180, render: formatTime },
        { title: "单码积分", dataIndex: "amountMicrocredits", width: 130, align: "right", render: (value) => <span className="font-medium tabular-nums">{formatCredits(value)}</span> },
        { title: "数量", dataIndex: "count", width: 100, align: "right", render: (value) => <span className="tabular-nums">{value}</span> },
        {
            title: "核销状态",
            width: 180,
            render: (_, batch) => (
                <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">
                        {batch.redeemedCount ?? 0}/{batch.count}
                    </span>
                    <span className="text-xs text-foreground/45">已核销</span>
                    {(batch.expiredCount ?? 0) > 0 ? <AdminStatusBadge label={`${batch.expiredCount} 已过期`} tone="warning" /> : null}
                </div>
            ),
        },
        { title: "有效期", dataIndex: "expiresAt", width: 180, render: (value) => (value ? formatTime(value) : <AdminStatusBadge label="永久有效" tone="info" />) },
        { title: "批次备注", dataIndex: "note", render: (value) => value || <span className="text-foreground/35">未填写</span> },
        {
            title: "操作",
            width: 210,
            render: (_, batch) => <AdminRowActions primary={{ label: "查看明细", icon: <Eye className="size-3.5" />, onClick: () => setSelectedBatch(batch) }} actions={[{ key: "disable", label: "禁用批次", icon: <Ban className="size-3.5" />, danger: true, disabled: (batch.availableCount ?? 0) <= 0, confirm: { title: "禁用该批次的可用兑换码？", description: "已核销和已过期记录不会变更。", okText: "确认禁用" }, onClick: async () => { try { const result = await disableAdminRedeemBatch(batch.id); message.success(`已禁用 ${result.disabledCount} 个兑换码`); await reload(); } catch (error) { message.error(error instanceof Error ? error.message : "禁用批次失败"); } } }]} />,
        },
    ];

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <section className="shrink-0 rounded-lg bg-background p-4">
                <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                        <KeyRound className="size-4" />
                    </span>
                    <h2 className="text-sm font-semibold">生成兑换码批次</h2>
                </div>
                <Form form={form} layout="vertical" requiredMark={false} className="mt-3 grid gap-x-3 md:grid-cols-12">
                    <Form.Item name="amount" label="每个兑换码的积分" rules={[{ required: true, message: "请填写积分面额" }]} className="md:col-span-3">
                        <InputNumber style={{ width: "100%" }} min={0.000001} precision={6} />
                    </Form.Item>
                    <Form.Item name="count" label="生成数量" rules={[{ required: true, message: "请填写生成数量" }]} className="md:col-span-2">
                        <InputNumber style={{ width: "100%" }} min={1} max={5000} precision={0} />
                    </Form.Item>
                    <Form.Item name="expiresAt" label="过期时间" className="md:col-span-3">
                        <Input type="datetime-local" />
                    </Form.Item>
                    <Form.Item name="note" label="批次备注" className="md:col-span-4">
                        <Input maxLength={500} placeholder="例如：7 月活动赠送" />
                    </Form.Item>
                    <div className="flex items-center justify-end md:col-span-12">
                        <Button type="primary" loading={creating} icon={<TicketCheck className="size-4" />} onClick={() => void createBatch()}>
                            生成兑换码
                        </Button>
                    </div>
                </Form>
            </section>

            <section className="flex min-h-0 flex-1">
                <AdminDataTable
                    toolbar={<Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索批次备注、积分或数量"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />}
                    toolbarActiveFilters={<>{keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => { setKeyword(""); setPage(1); }} /> : null}{validity !== "all" ? <AdminFilterChip label={`有效期：${validity === "active" ? "有效" : "已过期"}`} onRemove={() => { setValidity("all"); setPage(1); }} /> : null}</>}
                    toolbarActive={Boolean(keyword || validity !== "all")}
                    toolbarFilters={<Select className="w-36" value={validity} onChange={(value) => { setValidity(value); setPage(1); }} options={[{ label: "全部有效期", value: "all" }, { label: "有效", value: "active" }, { label: "已过期", value: "expired" }]} />}
                    onReset={() => { setKeyword(""); setValidity("all"); setPage(1); }}
                    trailing={<Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void reload()}>刷新</Button>}
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: batches, scroll: { x: 1080 } }}
                    empty={<AdminTableEmpty filtered={Boolean(keyword || validity !== "all")} title="暂无兑换码批次" />}
                    footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />}
                />
            </section>

            <GeneratedCodesModal codes={generatedCodes} onClose={() => setGeneratedCodes([])} />
            <RedeemBatchCodesModal key={selectedBatch?.id || "closed"} batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
        </div>
    );
}

function GeneratedCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
    const { message } = App.useApp();
    const content = codes.join("\n");
    const copy = async () => {
        await navigator.clipboard.writeText(content);
        message.success("兑换码已复制");
    };
    return (
        <Modal
            title={`已生成 ${codes.length} 个兑换码`}
            open={codes.length > 0}
            onCancel={onClose}
            footer={
                <Space>
                    <Button icon={<Copy className="size-4" />} onClick={() => void copy()}>
                        复制全部
                    </Button>
                    <AdminExportButton type="primary" exportFile={() => new Blob([content + "\n"], { type: "text/plain;charset=utf-8" })} fileName={() => `兑换码-${new Date().toISOString().slice(0, 10)}.txt`} label="下载 TXT" />
                </Space>
            }
            width={760}
        >
            <div className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">兑换码已加密保存，可在批次明细中再次查看；仍建议立即下载一份用于发放。</div>
            <Input.TextArea value={content} readOnly autoSize={{ minRows: 10, maxRows: 18 }} className="font-mono text-xs" />
        </Modal>
    );
}

function RedeemBatchCodesModal({ batch, onClose }: { batch: RedeemBatch | null; onClose: () => void }) {
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取兑换码明细失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [batch, message, page, pageSize, status]);

    const copyCode = async (code?: string) => {
        if (!code) return;
        await navigator.clipboard.writeText(code);
        message.success("兑换码已复制");
    };
    const copyPage = async () => {
        const content = codes
            .map((item) => item.code)
            .filter(Boolean)
            .join("\n");
        if (!content) return;
        await navigator.clipboard.writeText(content);
        message.success("本页兑换码已复制");
    };
    const disableCode = async (item: AdminRedeemCode) => {
        if (!batch) return;
        try {
            await disableAdminRedeemCode(batch.id, item.id);
            setCodes((current) => current.map((code) => (code.id === item.id ? { ...code, status: "disabled" } : code)));
            setBatchSummary((current) => (current ? { ...current, availableCount: Math.max(0, current.availableCount - 1), disabledCount: current.disabledCount + 1 } : current));
            message.success("兑换码已禁用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "禁用兑换码失败");
        }
    };
    const columns: ColumnsType<AdminRedeemCode> = [
        {
            title: "兑换码",
            width: 330,
            render: (_, item) => (
                <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{item.code || `明文不可恢复 ····${item.codeSuffix}`}</code>
                    <Button type="text" size="small" aria-label="复制兑换码" icon={<Copy className="size-3.5" />} disabled={!item.code} onClick={() => void copyCode(item.code)} />
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", width: 110, render: renderCodeStatus },
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
        { title: "核销时间", dataIndex: "redeemedAt", width: 180, render: formatTime },
        { title: "核销 IP", dataIndex: "redeemedIp", width: 150, render: (value) => value || <span className="text-foreground/35">--</span> },
        {
            title: "操作",
            width: 90,
            render: (_, item) =>
                item.status === "unused" ? (
                    <Popconfirm title="禁用这个兑换码？" okText="禁用" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void disableCode(item)}>
                        <Button type="text" size="small" danger icon={<Ban className="size-3.5" />} aria-label="禁用兑换码" />
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
            onCancel={onClose}
            footer={
                <Space>
                    <Button icon={<Copy className="size-4" />} disabled={!codes.some((item) => item.code)} onClick={() => void copyPage()}>
                        复制本页
                    </Button>
                    <Button type="primary" onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }
            width={1080}
            rootClassName="admin-modal-root"
        >
            {!plaintextAvailable ? <div className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">该批次创建于加密回看功能上线前，系统当时只保存了哈希，无法恢复完整明文；核销状态和审计信息仍可查看。</div> : null}
            <div className="mb-3 flex flex-wrap gap-2">
                <AdminStatusBadge label={`可用 ${batchSummary?.availableCount ?? 0}`} tone="success" />
                <AdminStatusBadge label={`已核销 ${batchSummary?.redeemedCount ?? 0}`} tone="info" />
                <AdminStatusBadge label={`已过期 ${batchSummary?.expiredCount ?? 0}`} tone="warning" />
                <AdminStatusBadge label={`已禁用 ${batchSummary?.disabledCount ?? 0}`} tone="neutral" />
            </div>
            <div className="admin-modal-data-table-shell">
                <AdminDataTable
                    toolbar={<Select className="w-32" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ label: "全部状态", value: "all" }, { label: "可用", value: "available" }, { label: "已核销", value: "redeemed" }, { label: "已过期", value: "expired" }, { label: "已禁用", value: "disabled" }]} />}
                    toolbarActiveFilters={status !== "all" ? <AdminFilterChip label={`状态：${status}`} onRemove={() => { setStatus("all"); setPage(1); }} /> : null}
                    toolbarActive={status !== "all"}
                    onReset={() => { setStatus("all"); setPage(1); }}
                    table={{ className: "app-data-table", rowKey: "id", size: "small", loading, columns, dataSource: codes, pagination: false, scroll: { x: 960 } }}
                    empty={<AdminTableEmpty filtered={status !== "all"} title="暂无兑换码" />}
                    footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => { setPage(nextSize !== pageSize ? 1 : nextPage); setPageSize(nextSize); }} />}
                />
            </div>
        </Modal>
    );
}

function renderCodeStatus(status: AdminRedeemCode["status"]) {
    const config: Record<AdminRedeemCode["status"], { label: string; tone: AdminStatusTone }> = {
        unused: { label: "可用", tone: "success" },
        redeemed: { label: "已核销", tone: "info" },
        disabled: { label: "已禁用", tone: "neutral" },
        expired: { label: "已过期", tone: "warning" },
    };
    const configForStatus = config[status];
    return <AdminStatusBadge label={configForStatus.label} tone={configForStatus.tone} />;
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
