import { describe, expect, test } from "bun:test";
import { loginLogDevice } from "../src/pages/admin/login-logs/login-log-display";

describe("登录日志设备识别", () => {
    test("Edge 不误判为 Chrome，Android 不误判为 Linux", () => {
        expect(loginLogDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toEqual({ browser: "Edge 130", os: "Windows" });
        expect(loginLogDevice("Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36")).toEqual({ browser: "Chrome 130", os: "Android 14" });
    });
    test("iPhone 和未知 UA 明确展示识别边界", () => {
        expect(loginLogDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1")).toEqual({ browser: "Safari 18", os: "iOS 18.0" });
        expect(loginLogDevice("custom-client")).toEqual({ browser: "未识别浏览器", os: "未识别系统" });
        expect(loginLogDevice("")).toEqual({ browser: "未记录", os: "未记录" });
    });
});
