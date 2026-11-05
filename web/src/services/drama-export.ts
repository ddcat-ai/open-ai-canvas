import { createClientUUID } from "@/lib/client-id";
import { scopedLocalStorage } from "@/lib/user-scope";
import { apiBaseURL } from "@/services/api/request";

// 短剧导出由后端校验后流式返回 ZIP。用隐藏表单提交到 iframe：大文件交给浏览器下载管理器，
// 不在页面内存里拼包；校验失败时 iframe 收到 JSON 信封，读出 msg 交给调用方提示。

const JIANYING_ROOT_KEY = "yingce.drama.jianyingDraftRoot";

function submitArchiveForm(path: string, fields: Array<[string, string]>, onError: (message: string) => void) {
    const frame = document.createElement("iframe");
    frame.name = `drama-export-${createClientUUID()}`;
    frame.hidden = true;
    frame.title = "短剧导出下载";
    frame.onload = () => {
        try {
            const raw = frame.contentDocument?.body?.textContent;
            if (!raw) return;
            const failure = JSON.parse(raw) as { code?: number; msg?: string };
            if (failure.code) onError(failure.msg || "导出失败，请重试");
            frame.remove();
        } catch {
            /* 附件响应交给浏览器下载管理器；移除 iframe 可能中断仍在传输的大文件，所以保留。 */
        }
    };
    document.body.append(frame);
    const form = document.createElement("form");
    form.method = "post";
    form.action = `${String(apiBaseURL).replace(/\/+$/, "")}${path}`;
    form.hidden = true;
    form.target = frame.name;
    for (const [name, value] of fields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
    }
    document.body.append(form);
    form.submit();
    form.remove();
}

export function exportDramaJianyingDraft(projectId: string, episodeId: string, options: { draftRoot: string; captions: boolean }, onError: (message: string) => void) {
    submitArchiveForm(
        `/dramas/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/jianying-draft`,
        [
            ["draftRoot", options.draftRoot.trim()],
            ["captions", options.captions ? "1" : "0"],
        ],
        onError,
    );
}

export function exportDramaAssetPackage(projectId: string, options: { episodeIds: string[]; media: boolean; prompts: boolean }, onError: (message: string) => void) {
    submitArchiveForm(`/dramas/${encodeURIComponent(projectId)}/asset-package`, [...options.episodeIds.map((id): [string, string] => ["episodeId", id]), ["media", options.media ? "1" : "0"], ["prompts", options.prompts ? "1" : "0"]], onError);
}

/** 剪映草稿目录是本机路径，只作为当前账号的界面偏好保存在本地。 */
export function savedJianyingDraftRoot() {
    try {
        return scopedLocalStorage.getItem(JIANYING_ROOT_KEY) || "";
    } catch {
        return "";
    }
}

export function saveJianyingDraftRoot(value: string) {
    try {
        scopedLocalStorage.setItem(JIANYING_ROOT_KEY, value.trim());
    } catch {
        /* 偏好写入失败不影响本次导出。 */
    }
}

/** 剪映专业版默认草稿目录模板；用户名无法从浏览器读取，需要用户替换。 */
export function defaultJianyingDraftRoot() {
    const windows = /windows/i.test(navigator.userAgent);
    return windows ? "C:\\Users\\你的用户名\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft" : "/Users/你的用户名/Movies/JianyingPro/User Data/Projects/com.lveditor.draft";
}

/** 与后端 jianying.NormalizeRoot 同口径的前置校验，只用于即时提示。 */
export function jianyingDraftRootProblem(value: string) {
    const root = value.trim();
    if (!root) return "请填写剪映草稿目录";
    if (root.includes("你的用户名")) return "请把路径里的「你的用户名」换成电脑上的实际用户名";
    if (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root)) return "需要绝对路径，例如 /Users/name/Movies/… 或 C:\\Users\\name\\…";
    return "";
}
