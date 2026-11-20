import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Cable, Cloud, Hash, MessageSquareText, PlugZap, RefreshCw, Shapes } from "lucide-react";
import { Tooltip } from "@/components/ui/base/tooltip";
import GithubLogo from "@lobehub/icons/es/Github/components/Mono";
import NotionLogo from "@lobehub/icons/es/Notion/components/Mono";
import { listMCPConnections, type MCPConnection } from "@/services/api/agent-mcp";
import { useUserStore } from "@/stores/use-user-store";
import "./canvas-cloud-agent-connectors.css";

export type AgentMCPDestination = "connections" | "market";

type AgentConnectorsBarProps = {
    onOpenMCP?: (destination: AgentMCPDestination) => void;
};

function connectionState(connection: MCPConnection) {
    if (connection.enabled) return { label: `${connection.allowedTools.length} 个工具可用`, tone: "ready" as const };
    if (connection.lastTestAt) return { label: "待授权", tone: "pending" as const };
    return { label: "待检测", tone: "muted" as const };
}

function connectionLabel(connection: MCPConnection) {
    return connection.scope === "platform" ? `${connection.name} · 平台` : connection.name;
}

function connectorVisual(name: string) {
    const key = name.toLocaleLowerCase();
    if (key.includes("github")) return { Icon: GithubLogo, color: "#24292f", ink: "#ffffff" };
    if (key.includes("notion")) return { Icon: NotionLogo, color: "#f5f5f4", ink: "#111827" };
    if (key.includes("feishu") || key.includes("lark") || key.includes("飞书")) return { Icon: MessageSquareText, color: "#3370ff", ink: "#ffffff" };
    if (key.includes("slack")) return { Icon: Hash, color: "#611f69", ink: "#ffffff" };
    if (key.includes("figma")) return { Icon: Shapes, color: "#a259ff", ink: "#ffffff" };
    if (key.includes("google")) return { Icon: Cloud, color: "#4285f4", ink: "#ffffff" };
    return { Icon: PlugZap, color: "var(--status-loading)", ink: "#ffffff" };
}

function ConnectorItem({ connection, onOpen }: { connection: MCPConnection; onOpen?: () => void }) {
    const state = connectionState(connection);
    const visual = connectorVisual(connection.name);
    const Icon = visual.Icon;
    return (
        <Tooltip title={connectionLabel(connection)} placement="top">
            <button
                type="button"
                data-no-press
                className={`agent-connector-item is-${state.tone}`}
                onClick={onOpen}
                aria-label={`${connectionLabel(connection)}，${state.label}，打开 MCP 连接设置`}
                style={{ backgroundColor: visual.color, color: visual.ink }}
            >
                <Icon className="agent-connector-glyph" aria-hidden="true" />
                <span className={`agent-connector-status is-${state.tone}`} aria-hidden="true" />
            </button>
        </Tooltip>
    );
}

/** Agent 输入框底部的真实 MCP 连接器入口。连接数据与 MCP 设置页共享 Query 缓存。 */
export function AgentConnectorsBar({ onOpenMCP }: AgentConnectorsBarProps) {
    const userId = useUserStore((state) => state.user?.id);
    const connections = useQuery({
        queryKey: ["agent-mcp", userId, "user", "connections"],
        queryFn: ({ signal }) => listMCPConnections("user", signal),
        enabled: Boolean(userId),
        staleTime: 15_000,
        retry: false,
    });
    const items = connections.data?.items ?? [];
    const loading = Boolean(userId) && connections.isPending;
    return (
        <div className="agent-connectors" role="group" aria-label="MCP 连接器">
            <button type="button" className="agent-connectors-heading" onClick={() => onOpenMCP?.("connections")} aria-label="管理连接器">
                <Cable className="agent-connectors-brand size-4" aria-hidden="true" />
                <span>连接器</span>
            </button>
            <div className="agent-connectors-list thin-scrollbar" aria-label="已安装连接器">
                {loading ? <span className="agent-connectors-loading" role="status" aria-label="正在读取 MCP 连接器" /> : null}
                {items.map((connection) => (
                    <ConnectorItem key={connection.id} connection={connection} onOpen={() => onOpenMCP?.("connections")} />
                ))}
                {connections.isError ? (
                    <button type="button" className="agent-connector-action" aria-label="重新读取 MCP 连接器" title="重新读取" onClick={() => void connections.refetch()}>
                        <RefreshCw className="size-3.5" />
                    </button>
                ) : null}
            </div>
            <button type="button" className="agent-connectors-market" onClick={() => onOpenMCP?.("market")}>
                <span>浏览插件市场</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}
