import { translate } from "@/i18n";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/**
 * 全站时间显示的唯一组件：7 天内相对时间（3 分钟前），更早显示具体日期；
 * 悬停 title 显示完整的年月日时分。数字用等宽，刷新时宽度不跳。
 */
export function RelativeTime({ value, suffix, className }: { value: string | number | Date | undefined | null; suffix?: string; className?: string }) {
    const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : value ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(timestamp)) return <span className={cn("tabular-nums", className)}>{translate("time.unknown")}</span>;
    return (
        <time className={cn("tabular-nums", className)} dateTime={new Date(timestamp).toISOString()} title={formatAbsoluteDateTime(timestamp)}>
            {formatRelativeTime(timestamp)}
            {suffix}
        </time>
    );
}
