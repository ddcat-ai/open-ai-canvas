import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { getMCPClient, consentToMCP } from "@/services/api/external-access";

export default function MCPAuthorizePage() {
    const { message } = App.useApp();
    const [params] = useSearchParams();
    const [pending, setPending] = useState(false);
    const clientId = params.get("client_id") || "";
    const client = useQuery({ queryKey: ["mcp-oauth-client", clientId], queryFn: ({ signal }) => getMCPClient(clientId, signal), enabled: Boolean(clientId), retry: false });
    const valid = params.get("response_type") === "code" && params.get("code_challenge_method") === "S256" && Boolean(params.get("code_challenge")) && Boolean(params.get("redirect_uri")) && params.get("resource") === `${window.location.origin}/api/mcp`;

    const decide = async (decision: "allow" | "deny") => {
        if (!valid || !client.data || pending) return;
        setPending(true);
        try {
            const result = await consentToMCP({
                client_id: clientId,
                redirect_uri: params.get("redirect_uri") || "",
                code_challenge: params.get("code_challenge") || "",
                code_challenge_method: "S256",
                resource: params.get("resource") || "",
                response_type: "code",
                scope: params.get("scope") || "",
                state: params.get("state") || "",
                decision,
            });
            window.location.assign(result.redirectUrl);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "授权失败，请重试");
            setPending(false);
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
            <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
                <KeyRound className="mb-4 size-7 text-[var(--workspace-accent)]" />
                <h1 className="text-xl font-semibold">授权 Agent 访问影策</h1>
                {client.isLoading && <p className="mt-3 text-sm text-muted-foreground">正在检查客户端…</p>}
                {(!valid || client.isError || !clientId) && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                        授权链接无效或已失效，请在 Agent 中重新连接。
                    </p>
                )}
                {valid && client.data && (
                    <>
                        <p className="mt-3 text-sm">{client.data.name} 请求使用你的影策账号进行视频创作。</p>
                        <p className="mt-2 text-sm text-muted-foreground">授权后可读取你的模型和素材、创建并查询生成任务，以及管理短剧制作。生成任务会使用你的账号额度。授权记录会保留在 API Key 列表中；你可以随时撤销访问。</p>
                        <p className="mt-3 break-all rounded-md bg-muted p-2 text-xs text-muted-foreground">回调地址：{params.get("redirect_uri")}</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button disabled={pending} onClick={() => void decide("deny")}>
                                拒绝
                            </Button>
                            <Button type="primary" loading={pending} onClick={() => void decide("allow")}>
                                允许访问
                            </Button>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}
