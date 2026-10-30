import { useCallback, useEffect, useRef, useState } from "react";

import { AdminTooltip } from "@/pages/admin/ui/controls";
import { getAdminChannelModelHealth, type AdminChannelModelHealth } from "@/services/api/wallet";
import { cn } from "@/lib/utils";

export function channelModelHealthKey(channelId: string, modelKey: string) {
    return `${channelId}\u0000${modelKey}`;
}

/** 读取模型稳定性；channelId 为空时读取全部系统渠道。读取失败不阻塞列表，只在单元格里显示“暂无数据”。 */
export function useChannelModelHealth(channelId?: string) {
    const [health, setHealth] = useState<Map<string, AdminChannelModelHealth>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const sequence = useRef(0);

    const reload = useCallback(async () => {
        const current = ++sequence.current;
        setLoading(true);
        setError("");
        try {
            const result = await getAdminChannelModelHealth(channelId);
            if (current !== sequence.current) return;
            setHealth(new Map(result.items.map((item) => [channelModelHealthKey(item.channelId, item.modelKey), item])));
        } catch (cause) {
            if (current !== sequence.current) return;
            setHealth(new Map());
            setError(cause instanceof Error ? cause.message : "读取模型稳定性失败");
        } finally {
            if (current === sequence.current) setLoading(false);
        }
    }, [channelId]);

    useEffect(() => {
        void reload();
        return () => {
            sequence.current += 1;
        };
    }, [reload]);

    return { health, loading, error, reload };
}

export function healthTone(rate: number | null | undefined, samples: number) {
    if (rate === null || rate === undefined || samples === 0) return "neutral" as const;
    if (rate >= 0.95) return "success" as const;
    if (rate >= 0.8) return "warning" as const;
    return "error" as const;
}

/** 24 小时成功率 + 最近 10 次结果（左旧右新）+ 调用次数；悬停显示 7 天成功率、P95 和最近一次失败。 */
export function ChannelModelHealthCell({ health, loading }: { health?: AdminChannelModelHealth; loading?: boolean }) {
    if (loading && !health) return <span className="text-xs text-foreground/35">读取中…</span>;
    if (!health || health.requests7d === 0) return <span className="text-xs text-foreground/35">近 7 天无调用</span>;
    const rate = health.successRate24h;
    const tone = healthTone(rate, health.requests24h);
    const slots = Array.from({ length: 10 }, (_, index) => {
        const offset = 10 - health.recentResults.length;
        return index < offset ? null : health.recentResults[index - offset];
    });
    const detail = (
        <div className="space-y-1 text-xs">
            <div>
                近 24 小时：{health.requests24h} 次，成功 {health.succeeded24h}，失败 {health.failed24h}
            </div>
            <div>
                近 7 天成功率：{formatRate(health.successRate7d)}（{health.requests7d} 次）
            </div>
            <div>近 24 小时 P95 耗时：{health.requests24h ? formatDuration(health.p95DurationMs24h) : "--"}</div>
            {health.lastFailedAt ? (
                <div>
                    最近失败：{new Date(health.lastFailedAt).toLocaleString("zh-CN", { hour12: false })}
                    {health.lastErrorCode ? ` · ${health.lastErrorCode}` : ""}
                </div>
            ) : null}
            <div className="opacity-70">只统计模型生成请求；方块从左到右为最近 10 次，最右为最新。</div>
        </div>
    );
    return (
        <AdminTooltip title={detail}>
            <div className="admin-model-health" data-tone={tone} tabIndex={0} aria-label={`近 24 小时成功率 ${formatRate(rate)}，共 ${health.requests24h} 次调用`}>
                <div className="admin-model-health-head">
                    <strong>{health.requests24h ? formatRate(rate) : "24h 无调用"}</strong>
                    <span>{health.requests24h ? `${health.requests24h} 次` : `7 天 ${formatRate(health.successRate7d)}`}</span>
                </div>
                <div className="admin-model-health-track" aria-hidden="true">
                    {slots.map((value, index) => (
                        <span key={index} className={cn("admin-model-health-pill", value === true && "is-success", value === false && "is-failed")} />
                    ))}
                </div>
            </div>
        </AdminTooltip>
    );
}

export function formatRate(rate: number | null | undefined) {
    return rate === null || rate === undefined ? "--" : `${(rate * 100).toFixed(rate >= 0.995 || rate === 0 ? 0 : 1)}%`;
}

function formatDuration(value: number) {
    if (!value) return "--";
    return value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${value} ms`;
}
