import { apiBaseURL } from "@/services/api/request";

/**
 * 头像 URL 统一解析。
 *
 * 本地开发未设置 VITE_CANVAS_BACKEND_URL 时，资源端点是相对路径（/api/...），
 * 若直接存库，img 加载会因调用方校验 http(s) 前缀而静默失败。这里把站内相对
 * 路径按 API 基址补全成绝对地址；已是绝对地址（含 data:、协议相对 //）原样返回。
 */
export function resolveAvatarUrl(raw?: string | null) {
    const url = (raw || "").trim();
    if (!url) return "";
    if (/^(?:https?:)?\/\//i.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
    const base = String(apiBaseURL).trim();
    if (/^https?:\/\//i.test(base)) return new URL(url, `${base.replace(/\/+$/, "")}/`).toString();
    return new URL(url, window.location.origin).toString();
}
