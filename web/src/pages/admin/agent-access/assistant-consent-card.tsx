import { Button, Skeleton } from "antd";
import { ArrowRight, Bot, Check, Info } from "lucide-react";
import type { AssistantConsent } from "@/services/api/admin-assistant";
import "./assistant-consent-card.css";

const moduleLabels: Record<string, string> = {
    "agent-lessons": "Agent 记忆",
    "agent-memory-documents": "Agent 记忆文档",
    analytics: "访问统计",
    "announcement-images": "公告图片",
    announcements: "系统公告",
    "api-logs": "请求明细",
    "api-logs-export.csv": "请求日志导出",
    "ark-portraits": "方舟人物素材",
    "banner-announcements": "常驻通知",
    "billing-orders": "账单订单",
    "channel-models": "渠道模型",
    "channel-websites": "渠道站点",
    channels: "渠道管理",
    ecommerce: "电商 Agent",
    "email-logs": "邮件记录",
    feedbacks: "用户反馈",
    integrations: "外部集成",
    "logical-models": "前台模型",
    "login-logs": "登录日志",
    mcp: "MCP 管理",
    "model-pricings": "模型定价",
    "official-asset-recommendations": "素材推荐审核",
    "official-assets": "官方素材库",
    payments: "支付运营",
    plugins: "插件管理",
    "pose-library": "姿势库",
    "prompt-templates": "提示词模板",
    "provider-catalog": "供应商目录",
    "redeem-batches": "兑换码",
    references: "资源引用",
    referral: "推广中心",
    resources: "存储资源",
    settings: "系统设置",
    "skill-curation": "技能分类",
    skills: "技能管理",
    sms: "短信服务",
    storage: "存储服务",
    "storage-grants": "存储授权",
    "system-performance": "系统性能",
    "system-update": "系统更新",
    "text-replay-stats": "文本回放统计",
    traffic: "流量运营",
    "user-groups": "用户分组",
    users: "用户管理",
    workbench: "工作台",
};

export function AssistantConsentCard({ consent, loading, busy, onAuthorize }: { consent?: AssistantConsent; loading: boolean; busy: boolean; onAuthorize: (approve: boolean) => void }) {
    const modules = new Map<string, string[]>();
    for (const scope of consent?.scopes ?? []) {
        const module = scope.slice(0, scope.lastIndexOf(":"));
        modules.set(module, [...(modules.get(module) ?? []), scope]);
    }
    const hasWrite = consent?.scopes.some((scope) => scope.endsWith(":write"));

    return (
        <section className="assistant-consent" aria-labelledby="assistant-consent-title" aria-busy={loading}>
            <header className="assistant-consent-heading">
                <div className="assistant-consent-identity" aria-hidden="true">
                    <span className="assistant-consent-avatar">
                        <Bot size={24} />
                    </span>
                    <ArrowRight size={18} />
                    <span className="assistant-consent-destination">管理后台</span>
                </div>
                <p className="assistant-consent-eyebrow">Agent 客户端授权</p>
                <h2 id="assistant-consent-title">{consent ? consent.clientName : "连接管理后台"}</h2>
                <p className="assistant-consent-subtitle">请求访问你的管理后台，请核对以下权限后继续。</p>
            </header>

            {loading && (
                <div className="assistant-consent-body" role="status" aria-label="正在读取授权请求">
                    <Skeleton active paragraph={{ rows: 4 }} />
                </div>
            )}
            {consent && (
                <>
                    <div className="assistant-consent-body">
                        <div className="assistant-consent-section-title">
                            <h3>请求的访问权限</h3>
                            <span>
                                {modules.size} 个模块 · {consent.scopes.length} 项权限
                            </span>
                        </div>
                        <ul className="assistant-consent-scopes">
                            {Array.from(modules, ([module, scopes]) => (
                                <li key={module}>
                                    <Check className="assistant-consent-check" size={16} aria-hidden="true" />
                                    <div className="assistant-consent-module">
                                        <strong>{moduleLabels[module] ?? module}</strong>
                                        <span className="assistant-consent-scope-codes">{scopes.join(" · ")}</span>
                                    </div>
                                    <div className="assistant-consent-access">
                                        {scopes.map((scope) => (
                                            <span key={scope} className={scope.endsWith(":write") ? "is-write" : undefined}>
                                                {scope.endsWith(":write") ? "写入" : scope.endsWith(":read") ? "读取" : scope}
                                            </span>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <div className="assistant-consent-notice">
                            <Info size={17} aria-hidden="true" />
                            <p>{hasWrite ? "此请求包含写入权限，客户端可修改对应模块的数据。危险操作仍需你在网页单独确认。" : "此请求仅包含读取权限，客户端无法通过此授权修改后台数据。"} 你可随时在「Agent 接入」撤销授权。</p>
                        </div>
                        <details className="assistant-consent-details">
                            <summary>查看连接详情</summary>
                            <dl>
                                <div>
                                    <dt>客户端 ID</dt>
                                    <dd>{consent.clientId}</dd>
                                </div>
                                <div>
                                    <dt>回调地址</dt>
                                    <dd>{consent.redirectUri}</dd>
                                </div>
                                <div>
                                    <dt>访问服务</dt>
                                    <dd>{consent.resource}</dd>
                                </div>
                            </dl>
                        </details>
                    </div>
                    <footer className="assistant-consent-footer">
                        <p>仅在你主动发起此连接时授权。</p>
                        <div className="assistant-consent-actions">
                            <Button disabled={busy} onClick={() => onAuthorize(false)}>
                                拒绝
                            </Button>
                            <Button type="primary" loading={busy} onClick={() => onAuthorize(true)}>
                                同意并授权
                            </Button>
                        </div>
                    </footer>
                </>
            )}
        </section>
    );
}
