import { createClientUUID } from "@/lib/client-id";
import { scopedLocalStorage } from "@/lib/user-scope";
import { apiBaseURL } from "@/services/api/request";
import type { JianyingDraftOptions } from "@/services/api/drama-export";

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
            let failure: { code?: number; msg?: string };
            try {
                failure = JSON.parse(raw);
            } catch {
                onError("下载收到无法识别的响应，请检查浏览器下载列表后重试");
                frame.remove();
                return;
            }
            onError(failure.code ? failure.msg || "导出失败，请重试" : "没有收到 ZIP 附件，请重新检查后重试");
            frame.remove();
        } catch {
            // 跨域附件响应无法从 iframe 读取；页面不能因此断言下载完成或失败。
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
    try {
        form.submit();
    } catch (error) {
        frame.remove();
        throw error;
    } finally {
        form.remove();
    }
    // 关闭弹窗只停止回调，不能移除仍在传输附件的 iframe。
    return {
        stopObserving: () => {
            frame.onload = null;
            frame.onerror = null;
        },
    };
}

export function exportDramaJianyingDraft(projectId: string, episodeId: string, options: JianyingDraftOptions & { revision: string; allowIncomplete: boolean; allowStale: boolean }, onError: (message: string) => void) {
    return submitArchiveForm(
        `/dramas/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/jianying-draft`,
        [
            ["draftRoot", options.draftRoot.trim()],
            ["captions", options.captions ? "1" : "0"],
            ["revision", options.revision],
            ["allowIncomplete", options.allowIncomplete ? "1" : "0"],
            ["allowStale", options.allowStale ? "1" : "0"],
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
export function defaultJianyingDraftRoot(platform: "windows" | "macos" = /windows/i.test(navigator.userAgent) ? "windows" : "macos") {
    return platform === "windows" ? "C:\\Users\\你的用户名\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft" : "/Users/你的用户名/Movies/JianyingPro/User Data/Projects/com.lveditor.draft";
}

/** 即时提示与后端规则同步；服务端仍会重做权威校验。 */
export function jianyingDraftRootProblem(value: string) {
    const root = value.trim();
    if (!root) return "请填写剪映草稿目录";
    if (root.includes("你的用户名")) return "请把路径里的「你的用户名」换成电脑上的实际用户名";
    if ([...root].length > 400 || /[\p{Cc}"]/u.test(root)) return "剪映草稿目录包含无效字符";
    const windows = /^[A-Za-z]:[\\/]/.test(root);
    const unc = root.startsWith("\\\\") || root.startsWith("//");
    if (!windows && !unc && !root.startsWith("/")) return "需要绝对路径，例如 /Users/name/Movies/… 或 C:\\Users\\name\\…";
    const canonical = windows || unc ? root.replaceAll("\\", "/") : root;
    if (windows || unc) {
        const body = windows ? canonical.slice(3) : canonical.slice(2);
        if (/[:*?<>|]/.test(body)) return "Windows 草稿目录包含无效字符";
        const parts = body.replace(/\/+$/, "").split("/");
        if (unc && parts.length < 3) return "请填写共享目录下的草稿文件夹，不能使用共享根目录";
        if (parts.some((part) => !part || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) return "Windows 草稿目录包含无效的文件夹名称";
    }
    if (canonical.split("/").some((part) => part === "." || part === "..")) return "剪映草稿目录不能包含 . 或 .. 路径段";
    const trimmed = canonical.replace(/\/+$/, "");
    if (!trimmed || (windows && trimmed.length <= 2)) return "剪映草稿目录不能是磁盘根目录";
    return "";
}
