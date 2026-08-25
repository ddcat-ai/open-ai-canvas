import axios from "axios";

import { apiClient, ApiError, request } from "@/services/api/request";
import type { ClientDiagnosticEvent } from "./client-diagnostics";

export type DiagnosticExportInput = {
    from: string;
    to: string;
    taskId?: string;
    projectId?: string;
    description?: string;
    runtime: {
        appVersion?: string;
        buildCommit?: string;
        browser?: string;
        os?: string;
        timezone?: string;
    };
    clientEvents: ClientDiagnosticEvent[];
};

export type DiagnosticPreview = {
    clientEventLimit: number;
    taskCount: number;
    taskLogCount: number;
    apiCallCount: number;
    estimatedBytes: number;
    willTruncate: boolean;
};

export type DiagnosticDownload = {
    blob: Blob;
    bundleId: string;
    fileName: string;
};

export function previewDiagnosticBundle(input: DiagnosticExportInput) {
    return request<DiagnosticPreview>(apiClient.post("/diagnostics/preview", input));
}

export async function exportDiagnosticBundle(input: DiagnosticExportInput): Promise<DiagnosticDownload> {
    try {
        const response = await apiClient.post<Blob>("/diagnostics/export", input, { responseType: "blob" });
        return {
            blob: response.data,
            bundleId: readHeader(response.headers, "x-diagnostic-bundle-id") || "",
            fileName: parseFileName(readHeader(response.headers, "content-disposition")) || "yingce-diagnostics.zip",
        };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            const status = error.response.status;
            const raw = await readErrorBody(error.response.data);
            try {
                const payload = raw ? (JSON.parse(raw) as { code?: number; msg?: string }) : null;
                if (payload) {
                    const message = status === 404 ? "诊断接口未部署，请重启或重新构建后端" : payload.msg || "导出诊断包失败";
                    throw new ApiError(message, { status, code: payload.code, cause: error });
                }
            } catch (parseError) {
                if (parseError instanceof ApiError) throw parseError;
            }
            if (status === 404) {
                throw new ApiError("诊断接口未部署，请重启或重新构建后端", { status, cause: error });
            }
            if (status === 502 || status === 503 || status === 504) {
                throw new ApiError("后端服务暂时不可用，请重启后端后重试", { status, cause: error });
            }
        }
        throw error;
    }
}

async function readErrorBody(data: unknown) {
    if (data instanceof Blob) return data.text();
    return typeof data === "string" ? data : "";
}

export function downloadDiagnosticBundle(download: DiagnosticDownload) {
    const url = URL.createObjectURL(download.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = download.fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readHeader(headers: unknown, name: string) {
    if (!headers || typeof headers !== "object") return "";
    const value = headers as { get?: (key: string) => string | null; [key: string]: unknown };
    if (typeof value.get === "function") return value.get(name) || "";
    const direct = value[name] ?? value[name.toLowerCase()];
    return typeof direct === "string" ? direct : "";
}

function parseFileName(contentDisposition: string) {
    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
        try {
            return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
        } catch {
            return encoded;
        }
    }
    return contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || "";
}
