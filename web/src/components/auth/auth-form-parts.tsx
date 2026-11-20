import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { FileText, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import type { AuthSettings } from "@/services/api/auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";

export function LinuxDOIcon() {
    return (
        <span
            aria-hidden
            className="size-5 shrink-0 rounded-full"
            style={{
                background: "linear-gradient(to bottom, #1d1d1f 0 33.333%, #efefef 33.333% 66.666%, #feb005 66.666% 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,.14)",
            }}
        />
    );
}

export function AuthNotice({ icon, tone = "amber", children }: { icon: ReactNode; tone?: "blue" | "amber"; children: ReactNode }) {
    return (
        <div data-tone={tone} className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

/** 方式切换（手机号 / 邮箱 / 密码）。下划线标签，左右方向键在标签间移动。 */
export function AuthTabs<T extends string>({ id, label, items, value, onChange, disabled = false }: { id: string; label: string; items: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; disabled?: boolean }) {
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!offset) return;
        event.preventDefault();
        const nextIndex = (index + offset + items.length) % items.length;
        onChange(items[nextIndex].value);
        tabRefs.current[nextIndex]?.focus();
    };
    return (
        <div role="tablist" aria-label={label} className="auth-tabs">
            {items.map((item, index) => {
                const selected = item.value === value;
                return (
                    <button
                        key={item.value}
                        ref={(element) => {
                            tabRefs.current[index] = element;
                        }}
                        id={authTabId(id, item.value)}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={authTabPanelId(id)}
                        tabIndex={selected ? 0 : -1}
                        className="auth-tab"
                        disabled={disabled}
                        onClick={() => onChange(item.value)}
                        onKeyDown={(event) => move(event, index)}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

export function authTabId(id: string, value: string) {
    return `${id}-tab-${value}`;
}

export function authTabPanelId(id: string) {
    return `${id}-panel`;
}

/** 底部的「还没有账号？立即注册」类切换入口。 */
export function AuthSwitchPrompt({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
    return (
        <p className="auth-form-switch">
            {prompt}
            <button type="button" className="auth-form-link is-strong" onClick={onClick}>
                {action}
            </button>
        </p>
    );
}

/**
 * 服务协议标题与条款来自后台「登录与注册」配置。标题未配置时才回退到当前品牌名，
 * 调用方只在拿到设置后展示协议入口；标题统一去掉书名号后由界面补《》。
 */
export function useAuthAgreement(settings: AuthSettings | null) {
    const { t } = useTranslation();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || t("auth.register.platform");
    const title = ((settings?.agreementTitle || "").trim() || t("auth.register.defaultAgreement", { brand: brandName })).replace(/^《|》$/g, "");
    const content = (settings?.agreementContent || "").trim();
    return { title, paragraphs: content ? content.split(/\n\s*\n/) : [] };
}

export function AuthAgreementDialog({ open, title, paragraphs, onClose }: { open: boolean; title: string; paragraphs: string[]; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <AppModal className="workspace-modal workspace-modal-compact auth-agreement-modal" title={title} open={open} onCancel={onClose} footer={null}>
            {paragraphs.length === 0 ? (
                <div className="auth-agreement-empty">
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    {t("auth.register.agreementEmpty")}
                </div>
            ) : (
                <div className="auth-agreement-body">
                    {paragraphs.map((paragraph, index) =>
                        // 后台用纯文本框维护条款，「一、二、三…」条目通常和正文写在同一个
                        // 段落里（只用一个换行分隔）。这里把条目标题切出来单独成行并加重，
                        // 否则标题和正文会挤在同一行，长条款失去可扫描的层级。
                        splitAgreementParagraph(paragraph).map((block, blockIndex) => (
                            <p key={`agreement-${index}-${blockIndex}`} data-role={block.heading ? "heading" : undefined}>
                                {block.text}
                            </p>
                        )),
                    )}
                </div>
            )}
            <p className="auth-agreement-meta">
                <LockKeyhole className="size-3 shrink-0" aria-hidden />
                {t("auth.register.agreementMeta")}
            </p>
        </AppModal>
    );
}

// 中文条款里「一、」「二、」这类条目标题常与正文写在同一个段落内（只隔一个换行）。
// 这里按「条目标题 + 紧随其后的正文」拆成独立段落，让标题能单独成行并加重；
// 没有条目标题的普通段落原样返回，不改变后台已经整理好的排版。
const AGREEMENT_HEADING = /^\s*([一二三四五六七八九十百]+、[^\n]{0,40})\n+([\s\S]+)$/;

export function splitAgreementParagraph(paragraph: string): { text: string; heading: boolean }[] {
    const match = paragraph.match(AGREEMENT_HEADING);
    if (!match) {
        const headingOnly = /^\s*[一二三四五六七八九十百]+、[^\n]{0,40}\s*$/.test(paragraph);
        return [{ text: paragraph.trim(), heading: headingOnly }];
    }
    return [
        { text: match[1].trim(), heading: true },
        { text: match[2].trim(), heading: false },
    ];
}
