export type BillingTimezoneOption = {
    value: string;
    label: string;
};

/**
 * 计费时间段使用 IANA 时区。列表保持为常用业务时区，避免管理员手动输入
 * 拼写错误；后端仍会用 time.LoadLocation 做最终校验。
 */
export const BILLING_TIMEZONE_OPTIONS: BillingTimezoneOption[] = [
    { value: "UTC", label: "协调世界时（UTC）" },
    { value: "Pacific/Honolulu", label: "夏威夷时间（Pacific/Honolulu）" },
    { value: "America/Los_Angeles", label: "美国太平洋时间（America/Los_Angeles）" },
    { value: "America/Denver", label: "美国山地时间（America/Denver）" },
    { value: "America/Chicago", label: "美国中部时间（America/Chicago）" },
    { value: "America/New_York", label: "美国东部时间（America/New_York）" },
    { value: "America/Toronto", label: "加拿大东部时间（America/Toronto）" },
    { value: "America/Sao_Paulo", label: "巴西时间（America/Sao_Paulo）" },
    { value: "America/Mexico_City", label: "墨西哥中部时间（America/Mexico_City）" },
    { value: "Atlantic/Reykjavik", label: "冰岛时间（Atlantic/Reykjavik）" },
    { value: "Europe/London", label: "英国时间（Europe/London）" },
    { value: "Europe/Paris", label: "法国时间（Europe/Paris）" },
    { value: "Europe/Berlin", label: "德国时间（Europe/Berlin）" },
    { value: "Europe/Moscow", label: "莫斯科时间（Europe/Moscow）" },
    { value: "Africa/Cairo", label: "埃及时间（Africa/Cairo）" },
    { value: "Africa/Johannesburg", label: "南非时间（Africa/Johannesburg）" },
    { value: "Asia/Dubai", label: "迪拜时间（Asia/Dubai）" },
    { value: "Asia/Riyadh", label: "利雅得时间（Asia/Riyadh）" },
    { value: "Asia/Kolkata", label: "印度标准时间（Asia/Kolkata）" },
    { value: "Asia/Bangkok", label: "曼谷时间（Asia/Bangkok）" },
    { value: "Asia/Jakarta", label: "雅加达时间（Asia/Jakarta）" },
    { value: "Asia/Ho_Chi_Minh", label: "胡志明市时间（Asia/Ho_Chi_Minh）" },
    { value: "Asia/Manila", label: "马尼拉时间（Asia/Manila）" },
    { value: "Asia/Singapore", label: "新加坡时间（Asia/Singapore）" },
    { value: "Asia/Hong_Kong", label: "香港时间（Asia/Hong_Kong）" },
    { value: "Asia/Taipei", label: "台北时间（Asia/Taipei）" },
    { value: "Asia/Shanghai", label: "中国标准时间（Asia/Shanghai）" },
    { value: "Asia/Almaty", label: "阿拉木图时间（Asia/Almaty）" },
    { value: "Asia/Tokyo", label: "日本标准时间（Asia/Tokyo）" },
    { value: "Asia/Seoul", label: "韩国标准时间（Asia/Seoul）" },
    { value: "Australia/Perth", label: "澳大利亚西部时间（Australia/Perth）" },
    { value: "Australia/Sydney", label: "澳大利亚东部时间（Australia/Sydney）" },
    { value: "Pacific/Guam", label: "关岛时间（Pacific/Guam）" },
    { value: "Pacific/Auckland", label: "新西兰时间（Pacific/Auckland）" },
];

/** 保留历史上已保存、但不在常用列表中的合法 IANA 时区，避免编辑时丢失配置。 */
export function billingTimezoneOptions(currentTimezone?: string): BillingTimezoneOption[] {
    const value = currentTimezone?.trim();
    if (!value || BILLING_TIMEZONE_OPTIONS.some((option) => option.value === value)) return BILLING_TIMEZONE_OPTIONS;
    return [{ value, label: `历史配置（${value}）` }, ...BILLING_TIMEZONE_OPTIONS];
}
