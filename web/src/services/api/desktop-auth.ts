import { http } from "@/services/api/request";

export const DESKTOP_CLIENT_ID = "peekreel-lite";

export type DesktopAuthorizationRequest = {
    clientId: typeof DESKTOP_CLIENT_ID;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    state: string;
};

export type DesktopAuthorizationCode = { code: string; expiresIn: number };

export function parseDesktopAuthorizationRequest(search: string): DesktopAuthorizationRequest {
    const params = new URLSearchParams(search);
    const one = (key: string) => {
        const values = params.getAll(key);
        if (values.length !== 1) throw new Error("桌面登录请求参数无效");
        return values[0];
    };
    const clientId = one("client_id");
    const redirectUri = one("redirect_uri");
    const codeChallenge = one("code_challenge");
    const method = one("code_challenge_method");
    const state = one("state");
    let redirect: URL;
    try {
        redirect = new URL(redirectUri);
    } catch {
        throw new Error("桌面登录回调地址无效");
    }
    const port = Number(redirect.port);
    if (
        clientId !== DESKTOP_CLIENT_ID ||
        redirect.protocol !== "http:" ||
        redirect.hostname !== "127.0.0.1" ||
        redirect.username ||
        redirect.password ||
        redirect.pathname !== "/oauth/callback" ||
        redirect.search ||
        redirect.hash ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
    )
        throw new Error("桌面登录请求无效");
    if (method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new Error("桌面登录校验参数无效");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) throw new Error("桌面登录 state 无效");
    return { clientId: DESKTOP_CLIENT_ID, redirectUri, codeChallenge, codeChallengeMethod: "S256", state };
}

export async function issueDesktopAuthorizationCode(input: DesktopAuthorizationRequest) {
    return http.post<DesktopAuthorizationCode>("/auth/desktop/authorize", {
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
    });
}

export function desktopAuthorizationCallback(redirectUri: string, code: string, state: string) {
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    return target.toString();
}

export function desktopAuthorizationCancelCallback(redirectUri: string, state: string) {
    const target = new URL(redirectUri);
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("state", state);
    return target.toString();
}
