import { Tag } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatLocale } from "@/lib/format-locale";
import { t } from "@/i18n";
import type { ProjectDetail, ProjectUnit } from "@/services/api/projects";

export type ProjectDetailViewProps = {
    detail: ProjectDetail;
    refreshProject: () => void;
    onCreateCanvas: () => void;
};

// 领域标签表：在函数内惰性求值（模块求值时 i18n 未就绪；调用方组件订阅 useTranslation 后语言切换会重渲染）
type LabelTable = Record<string, string>;

function categoryLabels(): LabelTable {
    return {
        character: t("project:characters-2"),
        environment: t("project:scenes"),
        wardrobe: t("project:costumes"),
        prop: t("project:props"),
        weapon: t("project:weapons"),
        style: t("project:styles"),
        other: t("project:other"),
    };
}

function mediaLabels(): LabelTable {
    return {
        image: t("project:images"),
        video: t("project:videos"),
        audio: t("project:audio"),
        text: t("project:texts"),
        model: t("project:3d-models"),
        entity: t("project:character-card"),
    };
}

function statusLabels(): LabelTable {
    return {
        active: t("project:in-progress"),
        archived: t("project:archived-2"),
        draft: t("project:draft"),
        ready: t("project:to-produce"),
        completed: t("project:done"),
        review: t("project:in-review"),
        confirmed: t("project:confirmed"),
        pending: t("project:pending"),
        pending_confirmation: t("project:to-confirm"),
        running: t("project:in-progress"),
        failed: t("project:failed"),
        ignored: t("project:ignored"),
        skipped: t("project:skipped"),
        cancelled: t("project:cancelled"),
        succeeded: t("project:done"),
        disabled: t("project:disabled"),
        idle: t("project:not-started"),
        loading: t("project:processing"),
        queued: t("project:queued"),
        success: t("project:done"),
        error: t("project:error"),
        deleted: t("project:deleted"),
        reserved: t("project:frozen"),
        settled: t("project:settled"),
        refunded: t("project:refunded"),
        uncertain: t("project:to-verify"),
    };
}

function sourceTypeLabels(): LabelTable {
    return {
        blank: t("project:start-blank-2"),
        novel: t("project:import-novel-4"),
        text: t("project:paste-text-2"),
    };
}

export function categoryLabel(value: string) {
    return categoryLabels()[value] || t("project:other");
}

export function statusLabel(value: string) {
    return statusLabels()[value] || t("project:unknown-status");
}

export function mediaLabel(value: string) {
    return mediaLabels()[value] || t("project:other-types");
}

export function sourceTypeLabel(value: string) {
    return sourceTypeLabels()[value] || t("project:other-sources");
}

export function StatusPill({ status }: { status: string }) {
    const color =
        status === "completed" || status === "confirmed" || status === "succeeded"
            ? "success"
            : status === "failed"
              ? "error"
              : status === "running" || status === "active"
                ? "processing"
                : status === "review" || status === "pending_confirmation"
                  ? "warning"
                  : "default";
    return (
        <Tag color={color} className="m-0 !rounded-full !px-2 !text-[var(--fs-label)]">
            {statusLabel(status)}
        </Tag>
    );
}

export function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                {eyebrow ? <div className="mb-1 text-[var(--fs-tiny)] font-semibold text-foreground/40">{eyebrow}</div> : null}
                <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
                {description ? <p className="mt-1 text-sm leading-5 text-foreground/55">{description}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

export function MetricTile({ label, value, detail, accent = false }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
    return (
        <div className={`overflow-hidden rounded-lg border px-3 py-3 ${accent ? "border-[color-mix(in_srgb,var(--workspace-accent)_30%,transparent)] bg-[var(--workspace-accent-soft)]" : "border-border/80 bg-background/70"}`}>
            <div className="text-xs text-foreground/50">{label}</div>
            <div className="mt-2 flex items-end gap-2">
                <strong className="text-2xl font-semibold tracking-normal">{value}</strong>
                {detail ? <span className="pb-0.5 text-xs text-foreground/45">{detail}</span> : null}
            </div>
        </div>
    );
}

export function UnitProgress({ unit }: { unit: ProjectUnit }) {
    const progress = unit.status === "completed" ? 100 : unit.status === "ready" ? 66 : 24;
    return (
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
    );
}

export function formatTime(value?: string) {
    if (!value) return "-";
    return new Date(value).toLocaleString(formatLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatCount(value: number) {
    return new Intl.NumberFormat(formatLocale()).format(value);
}

export function textValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
