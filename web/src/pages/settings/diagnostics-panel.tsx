import { App, Button, Input, Select } from "antd";
import { Activity, CheckCircle2, Clock3, Download, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { exportDiagnosticBundle, downloadDiagnosticBundle, previewDiagnosticBundle, type DiagnosticExportInput, type DiagnosticPreview } from "@/services/diagnostics/diagnostics-api";
import { getClientDiagnosticEvents, getDiagnosticRuntime } from "@/services/diagnostics/client-diagnostics";

type DiagnosticsPanelProps = {
    taskId?: string;
    projectId?: string;
};

type DiagnosticRange = "15m" | "30m" | "1h" | "24h";

const rangeOptions = [
    { value: "15m", label: "最近 15 分钟" },
    { value: "30m", label: "最近 30 分钟" },
    { value: "1h", label: "最近 1 小时" },
    { value: "24h", label: "最近 24 小时" },
];

export default function DiagnosticsPanel({ taskId, projectId }: DiagnosticsPanelProps) {
    const { message } = App.useApp();
    const [range, setRange] = useState<DiagnosticRange>("30m");
    const [description, setDescription] = useState("");
    const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [bundleId, setBundleId] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoadingPreview(true);
        void previewDiagnosticBundle(buildInput(range, undefined, taskId, projectId))
            .then((result) => {
                if (!cancelled) setPreview(result);
            })
            .catch(() => {
                if (!cancelled) setPreview(null);
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, range, taskId]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const download = await exportDiagnosticBundle(buildInput(range, description, taskId, projectId));
            downloadDiagnosticBundle(download);
            setBundleId(download.bundleId);
            message.success("诊断包已下载，请连同诊断编号提交给支持人员");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出诊断包失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="settings-pane diagnostics-page">
            <div className="settings-section max-w-4xl pb-8">
                <header className="border-b border-border/60 pb-6 pt-1">
                    <div className="mb-3 flex items-center gap-2 text-[var(--fs-tiny)] font-semibold tracking-[0.12em] text-foreground/42">
                        <span className="h-px w-6 bg-[var(--workspace-accent)]" aria-hidden="true" />
                        <span>排障工具</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)] md:items-end md:gap-10">
                        <div className="min-w-0">
                            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">问题诊断</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/55">遇到报错、任务失败或生成卡住时，导出一份给开发人员排查。</p>
                        </div>
                        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-3.5 py-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/[.12] text-emerald-600 dark:text-emerald-400">
                                <ShieldCheck className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground/85">默认已脱敏</div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">不包含 API Key、Cookie、完整提示词或原始媒体。</p>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="mt-6 space-y-4">
                    <section className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5" aria-labelledby="diagnostic-window-heading">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/55 pb-4">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
                                    <Clock3 className="size-4 text-foreground/55" strokeWidth={1.8} aria-hidden="true" />
                                    <h3 id="diagnostic-window-heading">收集范围</h3>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">选择问题发生前后的日志时间窗口。</p>
                            </div>
                            <span className="rounded-full bg-foreground/[.045] px-2.5 py-1 text-[var(--fs-tiny)] font-medium text-foreground/48">最长 24 小时</span>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,230px)_minmax(0,1fr)] md:items-end">
                            <label className="block" htmlFor="diagnostic-range">
                                <span className="mb-2 block text-xs font-semibold text-foreground/65">时间范围</span>
                                <Select id="diagnostic-range" className="w-full" value={range} options={rangeOptions} onChange={setRange} />
                            </label>
                            <div className="rounded-lg border border-border/55 bg-foreground/[.025] px-3.5 py-3" aria-live="polite">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground/78">
                                    <Activity className="size-4 text-emerald-500" strokeWidth={1.8} aria-hidden="true" />
                                    <span>当前账号的可用记录</span>
                                </div>
                                <div className="mt-3 grid grid-cols-3 divide-x divide-border/55">
                                    <DiagnosticMetric label="前端事件" value={loadingPreview ? "读取中" : "最多 500"} />
                                    <DiagnosticMetric label="任务" value={loadingPreview ? "读取中" : preview ? String(preview.taskCount) : "待统计"} />
                                    <DiagnosticMetric label="上游调用" value={loadingPreview ? "读取中" : preview ? String(preview.apiCallCount) : "待统计"} />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5" aria-labelledby="diagnostic-description-heading">
                        <div className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-4 text-foreground/55" strokeWidth={1.8} aria-hidden="true" />
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
                                    <h3 id="diagnostic-description-heading">问题描述</h3>
                                    <span className="rounded-full bg-foreground/[.045] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/42">可选</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">用一句话说明现象，帮助开发人员更快定位。</p>
                            </div>
                        </div>
                        <label className="mt-4 block" htmlFor="diagnostic-description">
                            <span className="sr-only">遇到了什么问题？</span>
                            <Input.TextArea id="diagnostic-description" rows={4} maxLength={1000} showCount value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：点击生成后一直显示处理中，刷新页面也没有结果。" />
                        </label>
                    </section>
                </div>

                <footer className="mt-5 flex flex-col-reverse gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-md text-xs leading-5 text-foreground/48">下载后请把 ZIP 文件和诊断编号一起提交。诊断包不会自动上传到服务器。</p>
                    <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                        {bundleId ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[.06] px-2.5 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300" role="status">
                                <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
                                诊断编号：{bundleId}
                            </span>
                        ) : null}
                        <Button size="large" type="primary" icon={<Download className="size-4" strokeWidth={2} />} loading={exporting} onClick={() => void handleExport()}>
                            导出诊断包
                        </Button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 px-3 first:pl-0 last:pr-0">
            <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground/78">{value}</div>
        </div>
    );
}

function buildInput(range: DiagnosticRange, description: string | undefined, taskId?: string, projectId?: string): DiagnosticExportInput {
    const to = new Date();
    const from = new Date(to.getTime() - rangeMilliseconds(range));
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        taskId: taskId || undefined,
        projectId: projectId || undefined,
        description: description || undefined,
        runtime: getDiagnosticRuntime(),
        clientEvents: getClientDiagnosticEvents({ from, to }),
    };
}

function rangeMilliseconds(range: DiagnosticRange) {
    switch (range) {
        case "15m":
            return 15 * 60 * 1000;
        case "1h":
            return 60 * 60 * 1000;
        case "24h":
            return 24 * 60 * 60 * 1000;
        default:
            return 30 * 60 * 1000;
    }
}
