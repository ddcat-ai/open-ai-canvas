import axios from "axios";

export type ApiParams = Record<string, string | string[] | number | number[] | undefined>;

export type BackendEnvelope<T> = {
    code: number;
    data: T;
    msg: string;
};

export class ApiError extends Error {
    readonly status?: number;
    readonly code?: number;
    readonly retryable: boolean;
    readonly cause?: unknown;

    constructor(message: string, options: { status?: number; code?: number; retryable?: boolean; cause?: unknown } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = options.status;
        this.code = options.code;
        this.retryable = options.retryable ?? isRetryableStatus(options.status ?? options.code);
        this.cause = options.cause;
    }
}

// 所有后端 JSON 请求共用同一实例，避免认证、Base URL 和错误语义在模块间漂移。
export const apiBaseURL = import.meta.env.VITE_CANVAS_BACKEND_URL || "/api";
export const apiClient = axios.create({ baseURL: apiBaseURL, withCredentials: true });

export async function request<T>(promise: Promise<{ data: BackendEnvelope<T>; status?: number }>) {
    try {
        const response = await promise;
        if (response.data.code !== 0) {
            throw new ApiError(response.data.msg || "请求失败", {
                status: response.status,
                code: response.data.code,
                retryable: isRetryableStatus(response.status) || isRetryableStatus(response.data.code),
            });
        }
        return response.data.data;
    } catch (error) {
        if (axios.isCancel(error) || (axios.isAxiosError(error) && error.code === axios.AxiosError.ERR_CANCELED)) {
            throw new DOMException("请求已取消", "AbortError");
        }
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) {
            const status = error.response?.status;
            const code = error.response?.data?.code;
            throw new ApiError(error.response?.data?.msg || error.message || "请求失败", {
                status,
                code,
                retryable: isRetryableStatus(status) || isRetryableStatus(code),
                cause: error,
            });
        }
        throw error;
    }
}

function isRetryableStatus(status?: number) {
    return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

export function compactApiParams(params: ApiParams) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && (!Array.isArray(value) || value.length > 0))) as ApiParams;
}

export function serializeApiParams(params?: ApiParams) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => queryParams.append(key, String(item)));
        else queryParams.set(key, String(value));
    }
    return queryParams;
}
