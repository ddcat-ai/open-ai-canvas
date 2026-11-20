import { App, Button, Input } from "antd";
import { Select } from "@/components/ui/base/select";
import { Activity, CheckCircle2, Clock3, Download, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { exportDiagnosticBundle, downloadDiagnosticBundle, previewDiagnosticBundle, type DiagnosticExportInput, type DiagnosticPreview } from "@/services/diagnostics/diagnostics-api";
import { getClientDiagnosticEvents, getDiagnosticRuntime } from "@/services/diagnostics/client-diagnostics";

type DiagnosticsPanelProps = {
    taskId?: string;
    projectId?: string;
};

type DiagnosticRange = "15m" | "30m" | "1h" | "24h";

const RANGES: DiagnosticRange[] = ["15m", "30m", "1h", "24h"];

export default function DiagnosticsPanel({ taskId, projectId }: DiagnosticsPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const rangeOptions = useMemo(() => RANGES.map((value) => ({ value, label: t(`account.settings.diagnostics.ranges.${value}`) })), [t]);
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
            message.success(t("account.settings.diagnostics.downloaded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.settings.diagnostics.exportFailed"));
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
                        <span>{t("account.settings.diagnostics.kicker")}</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)] md:items-end md:gap-10">
                        <div className="min-w-0">
                            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">{t("settings.sections.diagnostics.label")}</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/55">{t("account.settings.diagnostics.description")}</p>
                        </div>
                        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-4 py-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/[.12] text-emerald-600 dark:text-emerald-400">
                                <ShieldCheck className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground/85">{t("account.settings.diagnostics.redactedTitle")}</div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{t("account.settings.diagnostics.redactedDescription")}</p>
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
                                    <h3 id="diagnostic-window-heading">{t("account.settings.diagnostics.scopeTitle")}</h3>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">{t("account.settings.diagnostics.scopeDescription")}</p>
                            </div>
                            <span className="rounded-full bg-foreground/[.045] px-2 py-1 text-[var(--fs-tiny)] font-medium text-foreground/48">{t("account.settings.diagnostics.maxRange")}</span>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,230px)_minmax(0,1fr)] md:items-end">
                            <label className="block">
                                <span className="mb-2 block text-xs font-semibold text-foreground/65">{t("account.settings.diagnostics.range")}</span>
                                <Select
                                    ariaLabel={t("account.settings.diagnostics.range")}
                                    className="w-full"
                                    value={range}
                                    options={rangeOptions}
                                    onChange={(value) => {
                                        const next = rangeOptions.find((option) => option.value === value)?.value;
                                        if (next) setRange(next);
                                    }}
                                />
                            </label>
                            <div className="rounded-lg border border-border/55 bg-foreground/[.025] px-4 py-3" aria-live="polite">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground/78">
                                    <Activity className="size-4 text-emerald-500" strokeWidth={1.8} aria-hidden="true" />
                                    <span>{t("account.settings.diagnostics.records")}</span>
                                </div>
                                <div className="mt-3 grid grid-cols-3 divide-x divide-border/55">
                                    <DiagnosticMetric label={t("account.settings.diagnostics.clientEvents")} value={loadingPreview ? t("account.settings.diagnostics.loading") : t("account.settings.diagnostics.max500")} />
                                    <DiagnosticMetric label={t("account.settings.diagnostics.tasks")} value={loadingPreview ? t("account.settings.diagnostics.loading") : preview ? String(preview.taskCount) : t("account.settings.diagnostics.pending")} />
                                    <DiagnosticMetric
                                        label={t("account.settings.diagnostics.apiCalls")}
                                        value={loadingPreview ? t("account.settings.diagnostics.loading") : preview ? String(preview.apiCallCount) : t("account.settings.diagnostics.pending")}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5" aria-labelledby="diagnostic-description-heading">
                        <div className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-4 text-foreground/55" strokeWidth={1.8} aria-hidden="true" />
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
                                    <h3 id="diagnostic-description-heading">{t("account.settings.diagnostics.problemTitle")}</h3>
                                    <span className="rounded-full bg-foreground/[.045] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/42">{t("account.settings.diagnostics.optional")}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">{t("account.settings.diagnostics.problemDescription")}</p>
                            </div>
                        </div>
                        <label className="mt-4 block" htmlFor="diagnostic-description">
                            <span className="sr-only">{t("account.settings.diagnostics.problemLabel")}</span>
                            <Input.TextArea id="diagnostic-description" rows={4} maxLength={1000} showCount value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("account.settings.diagnostics.problemPlaceholder")} />
                        </label>
                    </section>
                </div>

                <footer className="mt-5 flex flex-col-reverse gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-md text-xs leading-5 text-foreground/48">{t("account.settings.diagnostics.footer")}</p>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {bundleId ? (
                            <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[.06] px-2 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300" role="status">
                                <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
                                {t("account.settings.diagnostics.bundleId", { id: bundleId })}
                            </span>
                        ) : null}
                        <Button size="large" type="primary" icon={<Download className="size-4" strokeWidth={2} />} loading={exporting} onClick={() => void handleExport()}>
                            {t("account.settings.diagnostics.export")}
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
