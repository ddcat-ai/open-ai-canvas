import MCPManager from "@/components/mcp/mcp-manager";
import { AdminPageFrame } from "../components/admin-shell";

export default function AdminMCPPage() {
    return (
        <AdminPageFrame title="MCP 管理" description="管理平台提供的连接，以及用户可安装的 MCP 市场。">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background p-4 sm:p-5">
                <MCPManager scope="platform" />
            </section>
        </AdminPageFrame>
    );
}
