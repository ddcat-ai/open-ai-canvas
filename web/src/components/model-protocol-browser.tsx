import { ChoiceBrowser } from "./choice-browser";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";

export function ModelProtocolBrowser({
    capability,
    protocols,
    ...props
}: {
    capability?: ProtocolCapability;
    protocols: ModelProtocolDefinition[];
    value?: string;
    onChange?: (value: string) => void;
    loading?: boolean;
    error?: string;
    disabled?: boolean;
    id?: string;
}) {
    const options = protocols
        .filter((protocol) => (!capability || protocol.capability === capability) && protocol.enabled !== false)
        .map((protocol) => ({
            value: protocol.value,
            label: protocol.label,
            subtitle: protocol.create,
            vendor: protocol.vendor,
            searchText: protocol.value,
            details: [
                { label: "请求", value: <code>{protocol.create}</code> },
                { label: "请求体", value: protocol.contentType },
                { label: "响应", value: protocol.poll ? "异步轮询" : "同步响应" },
                { label: "来源", value: protocol.media },
            ],
        }));

    return <ChoiceBrowser key={capability || "all"} {...props} label="调用协议" placeholder="搜索协议名称、厂商或请求路径" options={options} />;
}
