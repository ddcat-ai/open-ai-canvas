import { Button, Skeleton } from "antd";
import { Check, CircleAlert, Coins, FolderOpen, HardDrive } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { PaymentBrandIcon } from "@/components/payment-brand-icons";
import { formatCredits } from "@/constant/credits";
import { accountStorageMeter, accountStorageStateMessage, formatStorageCapacity, formatStorageDate, formatStorageDuration } from "@/lib/account-storage-usage";
import { estimatePaymentCharge, type PaymentOption } from "@/lib/payment-options";
import { cn } from "@/lib/utils";
import { formatPaymentAmount, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import type { AccountFileStorageUsage } from "@/services/api/resources";
import { storageGrantActive, type UserStorageGrant } from "@/services/api/storage-grants";

import "./workspace-wallet-topup.css";

export type TopupCategory = "all" | TopupProductKind;

const KIND_META: Record<TopupProductKind, { label: string; description: string; icon: typeof Coins }> = {
    credits: { label: "积分", description: "用于模型生成、Agent 与工具调用，按实际用量扣减。", icon: Coins },
    storage: { label: "存储空间", description: "扩充素材文件与 Agent 会话附件的总容量，支付后立即生效。", icon: HardDrive },
};

function productAvailability(product: TopupProduct) {
    if (product.saleStatus === "upcoming") return `${product.saleStartAt ? new Date(product.saleStartAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "待定"} 开售`;
    if (product.saleStatus === "ended") return "已结束";
    if (product.saleStatus === "sold_out") return "已售罄";
    if (product.saleStrategy === "inventory") return `剩余 ${product.stockRemaining ?? 0} 份`;
    if (product.saleStrategy === "periodic") return `每 ${product.periodDays} 天限购 ${product.periodPurchaseLimit} 次`;
    if (product.saleStrategy === "timed" && product.saleEndAt) return `${new Date(product.saleEndAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 截止`;
    return "";
}

/** 选中商品的权益摘要，结算栏与卡片共用。 */
export function topupProductValue(product: TopupProduct) {
    return product.kind === "storage" ? `+${formatStorageCapacity(product.storageBytes)}` : `${formatCredits(product.creditsMicrocredits, 6)} 积分`;
}

function ProductCard({ product, selected, onSelect }: { product: TopupProduct; selected: boolean; onSelect: () => void }) {
    const Icon = KIND_META[product.kind].icon;
    const availability = productAvailability(product);
    return (
        <button
            type="button"
            className={cn("wallet-topup-card", `is-${product.kind}`, selected && "is-selected")}
            aria-pressed={selected}
            disabled={!product.canPurchase}
            title={product.description ? `${product.name}：${product.description}` : product.name}
            onClick={onSelect}
        >
            <span className="wallet-topup-card-head">
                <span className="wallet-topup-kind-icon is-small" aria-hidden="true">
                    <Icon />
                </span>
                <span className="wallet-topup-card-name">{product.name}</span>
                {selected ? <Check className="wallet-topup-card-check" aria-hidden="true" /> : null}
            </span>
            <span className="wallet-topup-card-value">{topupProductValue(product)}</span>
            <span className="wallet-topup-card-foot">
                <span className="wallet-topup-card-meta">
                    {product.kind === "storage" ? <span className="wallet-topup-chip">{formatStorageDuration(product.storageDurationDays)}</span> : null}
                    {availability ? <span className={cn("wallet-topup-chip", !product.canPurchase && "is-muted")}>{availability}</span> : null}
                </span>
                <span className="wallet-topup-card-price">
                    <small>{product.currency === "USD" ? "$" : "¥"}</small>
                    {(product.amountFen / 100).toFixed(2)}
                </span>
            </span>
        </button>
    );
}

function TopupGroup({ kind, products, selectedProductId, onSelectProduct, aside, children }: { kind: TopupProductKind; products: TopupProduct[]; selectedProductId: string; onSelectProduct: (id: string) => void; aside?: ReactNode; children?: ReactNode }) {
    const meta = KIND_META[kind];
    const Icon = meta.icon;
    return (
        <section className={cn("wallet-topup-group", `is-${kind}`)} data-topup-kind={kind} aria-labelledby={`wallet-topup-group-${kind}`}>
            <header className="wallet-topup-group-head">
                <span className="wallet-topup-kind-icon is-small" aria-hidden="true">
                    <Icon />
                </span>
                <div>
                    <h3 id={`wallet-topup-group-${kind}`}>{meta.label}套餐</h3>
                    <p title={meta.description}>{meta.description}</p>
                </div>
                {aside}
            </header>
            {children}
            {products.length ? (
                <div className="wallet-topup-grid">
                    {products.map((product) => (
                        <ProductCard key={product.id} product={product} selected={selectedProductId === product.id} onSelect={() => onSelectProduct(product.id)} />
                    ))}
                </div>
            ) : (
                <div className="wallet-topup-group-empty">暂未上架{meta.label}套餐</div>
            )}
        </section>
    );
}

function StorageSummary({ usage, grants, onCleanAssets }: { usage?: AccountFileStorageUsage; grants: UserStorageGrant[]; onCleanAssets: () => void }) {
    const meter = accountStorageMeter(usage);
    const stateMessage = accountStorageStateMessage(meter);
    const activeGrants = grants.filter((grant) => storageGrantActive(grant));
    return (
        <div className="wallet-topup-storage">
            <div className="wallet-topup-storage-usage">
                <span>
                    已用 <b>{usage ? meter.usedLabel : "--"}</b> / {usage ? meter.totalLabel : "--"}
                </span>
                <span className={cn("wallet-topup-storage-track", meter.tone !== "ok" && `is-${meter.tone}`)} role="progressbar" aria-label="账号文件容量使用进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.percent)}>
                    <span style={{ width: `${meter.percent}%` }} />
                </span>
                <span className="wallet-topup-storage-split">
                    基础 {meter.baseLabel}
                    {meter.purchasedLabel ? ` + 已购 ${meter.purchasedLabel}` : ""}
                </span>
            </div>
            {stateMessage ? (
                <div className={cn("wallet-topup-storage-alert", meter.state === "read_only" && "is-read-only")} role="status">
                    <CircleAlert aria-hidden="true" />
                    <span>{stateMessage}</span>
                    <Button size="small" icon={<FolderOpen />} onClick={onCleanAssets}>
                        清理素材
                    </Button>
                </div>
            ) : null}
            {activeGrants.length ? (
                <ul className="wallet-topup-grants" aria-label="生效中的扩容">
                    {activeGrants.slice(0, 4).map((grant) => (
                        <li key={grant.id} title={grant.productName || (grant.source === "admin" ? "管理员赠送" : "存储扩容")}>
                            +{formatStorageCapacity(grant.bytes)} · {grant.expiresAt ? `${formatStorageDate(grant.expiresAt)} 到期` : "永久"}
                        </li>
                    ))}
                    {activeGrants.length > 4 ? <li>另有 {activeGrants.length - 4} 份</li> : null}
                </ul>
            ) : null}
        </div>
    );
}

export function WalletTopupPanel({
    loading,
    products,
    paymentOptions,
    usdCnyRate,
    focusKind,
    focusToken,
    selectedProduct,
    onSelectProduct,
    selectedOptionKey,
    onSelectOption,
    creating,
    onPay,
    storageUsage,
    storageGrants,
    onCleanAssets,
}: {
    loading: boolean;
    products: TopupProduct[];
    /** 渠道展开后的支付入口，易支付等聚合渠道的每种支付方式各一个。 */
    paymentOptions: PaymentOption[];
    /** 1 USD 兑换的 CNY，用于预估跨币种渠道的实付金额。 */
    usdCnyRate?: string;
    /** 从容量入口进入时滚动到对应分组；focusToken 变化时重新定位。 */
    focusKind?: TopupProductKind;
    focusToken?: number;
    selectedProduct?: TopupProduct;
    onSelectProduct: (id: string) => void;
    selectedOptionKey: string;
    onSelectOption: (key: string) => void;
    creating: boolean;
    onPay: () => void;
    storageUsage?: AccountFileStorageUsage;
    storageGrants: UserStorageGrant[];
    onCleanAssets: () => void;
}) {
    const groupsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (loading || !focusKind) return;
        const container = groupsRef.current;
        const target = container?.querySelector<HTMLElement>(`[data-topup-kind="${focusKind}"]`);
        if (!container || !target) return;
        // 只滚动分组列表本身。scrollIntoView 会连带滚动 overflow: hidden 的祖先（弹窗外壳、内容区），
        // 把页头和页签推出可视区且无法滚回。
        const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, [loading, focusKind, focusToken]);

    if (loading) {
        return (
            <div className="workspace-wallet-content wallet-topup">
                <Skeleton active paragraph={{ rows: 6 }} />
            </div>
        );
    }

    const byKind: Record<TopupProductKind, TopupProduct[]> = {
        credits: products.filter((item) => item.kind !== "storage"),
        storage: products.filter((item) => item.kind === "storage"),
    };
    // 只展示有商品的分类；存储分类即使没有商品也展示容量信息，便于用户先清理。
    const kinds = (["credits", "storage"] as const).filter((kind) => byKind[kind].length || kind === "storage");
    const selectedKind = selectedProduct ? KIND_META[selectedProduct.kind] : null;
    const SelectedIcon = selectedKind?.icon;
    const selectedOption = paymentOptions.find((option) => option.key === selectedOptionKey);
    const chargeFor = (option: PaymentOption) => (selectedProduct ? estimatePaymentCharge(selectedProduct.amountFen, selectedProduct.currency, option.settlementCurrency, usdCnyRate) : null);
    const selectedCharge = selectedOption ? chargeFor(selectedOption) : null;
    const showConvertedCharge = Boolean(selectedProduct && selectedCharge && selectedCharge.currency !== selectedProduct.currency);
    const selectedOptionPayable = Boolean(selectedOption && (!selectedProduct || selectedCharge));

    return (
        <div className="workspace-wallet-content wallet-topup">
            <div ref={groupsRef} className="wallet-topup-groups">
                {kinds.map((kind) => (
                    <TopupGroup key={kind} kind={kind} products={byKind[kind]} selectedProductId={selectedProduct?.id || ""} onSelectProduct={onSelectProduct}>
                        {kind === "storage" ? <StorageSummary usage={storageUsage} grants={storageGrants} onCleanAssets={onCleanAssets} /> : null}
                    </TopupGroup>
                ))}
            </div>

            {products.length ? (
                <footer className="wallet-topup-checkout">
                    <div className={cn("wallet-topup-checkout-summary", selectedProduct && `is-${selectedProduct.kind}`)}>
                        {selectedProduct && SelectedIcon ? (
                            <>
                                <span className="wallet-topup-kind-icon" aria-hidden="true">
                                    <SelectedIcon />
                                </span>
                                <span>
                                    <strong>{selectedProduct.name}</strong>
                                    <small>
                                        {topupProductValue(selectedProduct)}
                                        {selectedProduct.kind === "storage" ? ` · ${formatStorageDuration(selectedProduct.storageDurationDays)}` : ""}
                                    </small>
                                </span>
                                <b className="wallet-topup-checkout-price">
                                    {formatPaymentAmount(selectedProduct.amountFen, selectedProduct.currency)}
                                    {showConvertedCharge && selectedCharge ? <small title={`按 1 USD = ${usdCnyRate} CNY 换算，以支付页金额为准`}>约付 {formatPaymentAmount(selectedCharge.amountFen, selectedCharge.currency)}</small> : null}
                                </b>
                            </>
                        ) : (
                            <span className="wallet-topup-checkout-hint">选择一个套餐</span>
                        )}
                    </div>
                    {paymentOptions.length ? (
                        <div className="workspace-wallet-providers" role="radiogroup" aria-label="支付方式">
                            {paymentOptions.map((option) => {
                                // 渠道结算货币与商品不同且未配置汇率时无法换算，入口禁用并说明原因。
                                const unavailable = Boolean(selectedProduct && !chargeFor(option));
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="radio"
                                        aria-checked={selectedOptionKey === option.key}
                                        className={selectedOptionKey === option.key ? "is-selected" : ""}
                                        disabled={unavailable}
                                        title={unavailable ? `该支付方式以 ${option.settlementCurrency} 收款，暂不支持购买 ${selectedProduct?.currency} 套餐` : option.name}
                                        onClick={() => onSelectOption(option.key)}
                                    >
                                        <PaymentBrandIcon providerId={option.providerId} icon={option.icon} compact />
                                        {option.name}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <span className="wallet-topup-checkout-hint">暂无可用支付渠道，请联系管理员</span>
                    )}
                    <Button type="primary" size="large" loading={creating} disabled={!selectedProduct || !selectedProduct.canPurchase || !selectedOptionPayable} onClick={onPay}>
                        立即支付
                    </Button>
                </footer>
            ) : (
                <div className="workspace-wallet-inline-state">
                    <CircleAlert />
                    <div>
                        <strong>在线充值暂不可用</strong>
                        <span>当前没有已上架的套餐，请使用兑换码或联系管理员。</span>
                    </div>
                </div>
            )}
        </div>
    );
}
