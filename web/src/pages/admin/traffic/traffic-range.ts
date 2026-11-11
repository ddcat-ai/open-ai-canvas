import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export type TrafficDateRange = { from: string; to: string };
const dateFormat = "YYYY-MM-DD";
const timeZone = "Asia/Shanghai";

export function trafficDateBounds(now = Date.now()) {
    const today = dayjs(now).tz(timeZone).format(dateFormat);
    return { today, earliest: dayjs.utc(today, dateFormat, true).subtract(364, "day").format(dateFormat) };
}

export function trafficPresetRange(days: 7 | 30 | 60, now = Date.now()): TrafficDateRange {
    const { today } = trafficDateBounds(now);
    return {
        from: dayjs
            .utc(today, dateFormat, true)
            .subtract(days - 1, "day")
            .format(dateFormat),
        to: today,
    };
}

export function trafficRangeError(range: TrafficDateRange, now = Date.now()): string {
    if (!range.from || !range.to) return "请选择开始与结束日期。";
    // 日期输入是上海日历标签，严格按 UTC 日历校验，不随机器时区跨日或自动修正非法日期。
    const from = dayjs.utc(range.from, dateFormat, true);
    const to = dayjs.utc(range.to, dateFormat, true);
    if (!from.isValid() || !to.isValid()) return "请输入有效日期（YYYY-MM-DD），不会自动修正或截断。";
    if (from.isAfter(to)) return "开始日期不能晚于结束日期。";
    const { today, earliest } = trafficDateBounds(now);
    if (range.from < earliest || range.to > today) return `仅可查询上海时间 ${earliest} 至 ${today}，含今日最多 365 个自然日。`;
    return "";
}

export function trafficEventTime(value: string | null): string {
    if (!value) return "暂无保留事件";
    const parsed = value.length === 10 ? dayjs.utc(value, dateFormat, true) : dayjs(value).tz(timeZone);
    return parsed.isValid() ? parsed.format(value.length === 10 ? dateFormat : "YYYY-MM-DD HH:mm") : "时间不可用";
}
