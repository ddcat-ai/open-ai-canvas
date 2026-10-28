import type { Locale } from "antd/es/locale";
import enUS from "antd/locale/en_US";
import esES from "antd/locale/es_ES";
import jaJP from "antd/locale/ja_JP";
import koKR from "antd/locale/ko_KR";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";

import type { SupDanceLocaleCode } from "../types";

const ANTD_LOCALE_MAP: Record<SupDanceLocaleCode, Locale> = {
    "zh-CN": zhCN,
    "en-US": enUS,
    "zh-TW": zhTW,
    "ja-JP": jaJP,
    "ko-KR": koKR,
    "es-ES": esES,
};

export function getAntdLocaleForCode(code: SupDanceLocaleCode, pluginEnabled = true): Locale {
    if (!pluginEnabled) return zhCN;
    return ANTD_LOCALE_MAP[code] || zhCN;
}
