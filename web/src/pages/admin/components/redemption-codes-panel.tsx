import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Ban, Copy, Download, Eye, KeyRound, RefreshCw, Search, TicketCheck } from "lucide-react";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createAdminRedeemBatch, disableAdminRedeemBatch, disableAdminRedeemCode, listAdminRedeemBatchCodes, listAdminRedeemBatches, type AdminRedeemCode, type RedeemBatch } from "@/services/api/wallet";

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
                    {(batch.expiredCount ?? 0) > 0 ? (
                        <Tag bordered={false} color="default">
                            {batch.expiredCount} 已过期
                        </Tag>
                    ) : null}
                </div>
            ),
        },
        { title: "有效期", dataIndex: "expiresAt", width: 180, render: (value) => (value ? formatTime(value) : <Tag bordered={false}>永久有效</Tag>) },
        { title: "批次备注", dataIndex: "note", render: (value) => value || <span className="text-foreground/35">未填写</span> },
        {
            title: "操作",
            width: 210,
            fixed: "right",
            render: (_, batch) => (
                <Space size={6}>
                    <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setSelectedBatch(batch)}>
                        查看明细
                    </Button>
                    <Popconfirm
                        title="禁用该批次的可用兑换码？"
                        description="已核销和已过期记录不会变更。"
                        okText="禁用"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                            try {
                                const result = await disableAdminRedeemBatch(batch.id);
                                message.success(`已禁用 ${result.disabledCount} 个兑换码`);
                                await reload();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "禁用批次失败");
                            }
                        }}
                    >
                        <Button size="small" danger icon={<Ban className="size-3.5" />} disabled={(batch.availableCount ?? 0) <= 0}>
                            禁用
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="space-y-8">
            <section className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">
                        <KeyRound className="size-4" />
                    </span>
                    <div>
                        <h2 className="text-base font-semibold">生成兑换码批次</h2>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">兑换码为 32 位随机字符串，生成后加密保存，可在批次明细中再次查看。</p>
                    </div>
                </div>
                <Form form={form} layout="vertical" requiredMark={false} className="grid gap-x-4 px-5 pt-5 md:grid-cols-12">
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
                    <div className="flex items-center justify-between gap-4 border-t border-border py-4 md:col-span-12">
                        <span className="text-xs text-foreground/45">单批最多生成 5,000 个。生成成功后会立即显示结果，请及时下载留存。</span>
                        <Button type="primary" loading={creating} icon={<TicketCheck className="size-4" />} onClick={() => void createBatch()}>
                            生成兑换码
                        </Button>
                    </div>
                </Form>
            </section>

            <section>
                <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">批次记录</h2>
                        <p className="mt-1 text-xs text-foreground/55">查看每个兑换码的当前状态、核销用户、时间和来源 IP。</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                </div>
                <ListToolbar
                    active={Boolean(keyword || validity !== "all")}
                    onReset={() => {
                        setKeyword("");
                        setValidity("all");
                        setPage(1);
                    }}
                >
                    <Input
                        allowClear
                        className="w-full sm:w-72"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索批次备注、积分或数量"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                    <Select
                        className="w-36"
                        value={validity}
                        onChange={(value) => {
                            setValidity(value);
                            setPage(1);
                        }}
                        options={[
                            { label: "全部有效期", value: "all" },
                            { label: "有效", value: "active" },
                            { label: "已过期", value: "expired" },
                        ]}
                    />
                </ListToolbar>
                <TableSurface>
                    <Table
                        className="app-data-table"
                        rowKey="id"
                        size="middle"
                        loading={loading}
                        columns={columns}
                        dataSource={batches}
                        pagination={{
                            current: page,
                            pageSize,
                            total,
                            showSizeChanger: true,
                            pageSizeOptions: [20, 50, 100],
                            showTotal: (value, range) => `${range[0]}-${range[1]} / 共 ${value} 个批次`,
                            onChange: (nextPage, nextPageSize) => {
                                setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextPageSize);
                            },
                        }}
                        scroll={{ x: 1080 }}
                    />
                </TableSurface>
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
    const download = () => {
        const url = URL.createObjectURL(new Blob([content + "\n"], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `兑换码-${new Date().toISOString().slice(0, 10)}.txt`;
        link.click();
        URL.revokeObjectURL(url);
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
                    <Button type="primary" icon={<Download className="size-4" />} onClick={download}>
                        下载 TXT
                    </Button>
                </Space>
            }
            width={680}
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
            fixed: "right",
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
        >
            {!plaintextAvailable ? <div className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">该批次创建于加密回看功能上线前，系统当时只保存了哈希，无法恢复完整明文；核销状态和审计信息仍可查看。</div> : null}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <Tag bordered={false} color="green">
                        可用 {batchSummary?.availableCount ?? 0}
                    </Tag>
                    <Tag bordered={false} color="blue">
                        已核销 {batchSummary?.redeemedCount ?? 0}
                    </Tag>
                    <Tag bordered={false}>已过期 {batchSummary?.expiredCount ?? 0}</Tag>
                    <Tag bordered={false}>已禁用 {batchSummary?.disabledCount ?? 0}</Tag>
                </div>
                <Select
                    className="w-32"
                    value={status}
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                    options={[
                        { label: "全部状态", value: "all" },
                        { label: "可用", value: "available" },
                        { label: "已核销", value: "redeemed" },
                        { label: "已过期", value: "expired" },
                        { label: "已禁用", value: "disabled" },
                    ]}
                />
            </div>
            <Table
                className="app-data-table"
                rowKey="id"
                size="small"
                loading={loading}
                columns={columns}
                dataSource={codes}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    pageSizeOptions: [20, 50, 100],
                    showTotal: (value) => `共 ${value} 个兑换码`,
                    onChange: (nextPage, nextSize) => {
                        setPage(nextSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextSize);
                    },
                }}
                scroll={{ x: 960, y: 460 }}
            />
        </Modal>
    );
}

function renderCodeStatus(status: AdminRedeemCode["status"]) {
    const config = {
        unused: { label: "可用", color: "green" },
        redeemed: { label: "已核销", color: "blue" },
        disabled: { label: "已禁用", color: "default" },
        expired: { label: "已过期", color: "default" },
    }[status];
    return (
        <Tag bordered={false} color={config.color}>
            {config.label}
        </Tag>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
