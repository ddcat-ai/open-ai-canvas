import { ApiError } from "@/services/api/request";

const maximumProjectNameRetries = 5;

/** 只重试后端明确识别的项目重名，不依赖可能被统一错误处理改写的数据库文案。 */
export function shouldRetryProjectNameConflict(error: unknown, attempt: number) {
    return error instanceof ApiError &&
        error.status === 409 &&
        error.reason === "project_name_conflict" &&
        attempt < maximumProjectNameRetries;
}
