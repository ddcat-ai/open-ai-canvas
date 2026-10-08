// Agent 连接器：输入框底部的第三方协作工具入口条。
//
// 流光溢彩渐变背景 + 紧凑排列的品牌图标，无独立按钮背景。
// 品牌图标为内联 SVG 占位，避免外链 favicon 依赖。

import { App } from "antd";
import { Cable, X } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/base/tooltip";
import "./canvas-cloud-agent-connectors.css";

type AgentConnector = {
    id: string;
    name: string;
    icon: ReactNode;
};

function NotionIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 100 100" fill="none">
            <path
                d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
                fill="#fff"
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
                fill="#000"
            />
        </svg>
    );
}

function FeishuIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#3370FF" />
            <path d="M7 7h10v3H7V7z" fill="#fff" />
            <path d="M7 11h4v6H7v-6z" fill="#fff" opacity="0.9" />
            <path d="M12 11h5v2.5h-5V11z" fill="#fff" opacity="0.75" />
            <path d="M12 14.5h5V17h-5v-2.5z" fill="#fff" opacity="0.75" />
        </svg>
    );
}

function BasecampIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" fill="#1DB954" />
            <path d="M12 6c-3.5 0-6 2.5-6 6s2.5 6 6 6 6-2.5 6-6-2.5-6-6-6zm0 10c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z" fill="#fff" />
            <circle cx="12" cy="12" r="2" fill="#fff" />
        </svg>
    );
}

function ObsidianIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#7C3AED" />
            <path d="M12 4l7 4v8l-7 4-7-4V8l7-4z" stroke="#fff" strokeWidth="1.5" fill="none" />
            <path d="M12 4v8m0 8V12m-7-4l7 4m7-4l-7 4" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
        </svg>
    );
}

function GitHubIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" fill="#24292e" />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 3C7.03 3 3 7.03 3 12c0 3.98 2.58 7.35 6.15 8.54.45.08.62-.19.62-.43v-1.7c-2.52.55-3.05-1.08-3.05-1.08-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.91.06 1.39.93 1.39.93.81 1.38 2.12.98 2.63.75.08-.58.31-.98.57-1.2-2.01-.23-4.13-1-4.13-4.47 0-.99.35-1.8.93-2.43-.09-.23-.4-1.14.09-2.38 0 0 .76-.24 2.48.92a8.6 8.6 0 012.26-.3c.77 0 1.54.1 2.26.3 1.72-1.16 2.48-.92 2.48-.92.49 1.24.18 2.15.09 2.38.58.63.93 1.44.93 2.43 0 3.48-2.13 4.24-4.15 4.46.33.28.62.83.62 1.67v2.47c0 .24.17.52.63.43A9.003 9.003 0 0021 12c0-4.97-4.03-9-9-9z"
                fill="#fff"
            />
        </svg>
    );
}

function TencentDocsIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#1E6FFF" />
            <path d="M8 6h5.5l3 3v8.5a1 1 0 01-1 1H8a1 1 0 01-1-1V7a1 1 0 011-1z" fill="#fff" />
            <path d="M13.5 6v2.2c0 .4.3.8.8.8H17" fill="#BFD4FF" />
            <rect x="9.5" y="12" width="5.5" height="1.2" rx=".6" fill="#1E6FFF" />
            <rect x="9.5" y="14.5" width="5.5" height="1.2" rx=".6" fill="#1E6FFF" opacity=".7" />
            <rect x="9.5" y="17" width="3.5" height="1.2" rx=".6" fill="#1E6FFF" opacity=".5" />
        </svg>
    );
}

function SlackIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M8.5 3.5a2 2 0 11-4 0 2 2 0 014 0zm0 7a2 2 0 01-2 2h-2a2 2 0 010-4h2a2 2 0 012 2z" fill="#E01E5A" />
            <path d="M15.5 10.5a2 2 0 100-4 2 2 0 000 4zm7 0a2 2 0 01-2 2h-2a2 2 0 110-4h2a2 2 0 012 2z" fill="#36C5F0" />
            <path d="M15.5 20.5a2 2 0 100-4 2 2 0 000 4zm0-7a2 2 0 012-2v-2a2 2 0 10-4 0v2a2 2 0 012 2z" fill="#2EB67D" />
            <path d="M8.5 13.5a2 2 0 10-4 0 2 2 0 004 0zm7 0a2 2 0 01-2 2v2a2 2 0 104 0v-2a2 2 0 01-2-2z" fill="#ECB22E" />
        </svg>
    );
}

const AGENT_CONNECTORS: AgentConnector[] = [
    { id: "notion", name: "Notion", icon: <NotionIcon /> },
    { id: "feishu", name: "飞书", icon: <FeishuIcon /> },
    { id: "basecamp", name: "Basecamp", icon: <BasecampIcon /> },
    { id: "obsidian", name: "Obsidian", icon: <ObsidianIcon /> },
    { id: "github", name: "GitHub", icon: <GitHubIcon /> },
    { id: "tencent-docs", name: "腾讯文档", icon: <TencentDocsIcon /> },
    { id: "slack", name: "Slack", icon: <SlackIcon /> },
];

/** 输入框底部的连接器条，流光溢彩背景，紧凑图标阵列。 */
export function AgentConnectorsBar({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    return (
        <div className="agent-connectors" role="group" aria-label="连接器">
            <div className="agent-connectors-label">
                <Cable />
                <span>连接器</span>
            </div>
            <div className="agent-connectors-list">
                {AGENT_CONNECTORS.map((connector) => (
                    <Tooltip key={connector.id} title={`${connector.name} · 研发中`} placement="top">
                        <button type="button" className="agent-connector-item" aria-label={`${connector.name}（研发中）`} onClick={() => message.info({ content: `${connector.name}连接器研发中，敬请期待`, key: `agent-connector-${connector.id}` })}>
                            {connector.icon}
                        </button>
                    </Tooltip>
                ))}
            </div>
            <button type="button" className="agent-connectors-close" aria-label="收起连接器" onClick={onClose}>
                <X />
            </button>
        </div>
    );
}
