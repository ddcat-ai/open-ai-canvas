import { Coins, CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCredits } from "@/constant/credits";
import { currentLocale } from "@/i18n";
import { generationErrorMessage } from "@/lib/generation-error";
import { cn } from "@/lib/utils";
import type { WalletCreditEntry, WalletHistoryEntry } from "@/services/api/wallet";

const ledgerTitleKeys = {
    consume: "account.wallet.ledger.consume",
    refund: "account.wallet.ledger.refund",
    payment_topup: "account.wallet.ledger.paymentTopup",
    redeem: "account.wallet.ledger.redeem",
    referral_commission: "account.wallet.ledger.referral",
    admin_grant: "account.wallet.ledger.adminAdjustment",
    admin_adjustment: "account.wallet.ledger.adminAdjustment",
    signup_bonus: "account.wallet.ledger.signupBonus",
    team_transfer: "account.wallet.ledger.teamTransfer",
    checkin_bonus: "account.wallet.ledger.checkinBonus",
} satisfies Record<WalletCreditEntry["type"], string>;

export function WalletHistoryRow({ entry }: { entry: WalletHistoryEntry }) {
    const { t } = useTranslation();
    const billing = entry.type === "billing" ? entry : null;
    const positive = entry.type !== "billing" && entry.amountMicrocredits > 0;
    const arkGroup = entry.scene === "ark_asset_group";
    const note = entry.note && entry.type !== "team_transfer" ? (arkGroup ? entry.note : generationErrorMessage(entry.note)) : "";
    const title = arkGroup ? t("account.wallet.ledger.arkAssetGroup") : entry.type === "billing" ? t("account.wallet.ledger.consume") : t(ledgerTitleKeys[entry.type]);
    let summary = "";
    let detail = "";
    if (billing) {
        const reserved = formatCredits(billing.reservedMicrocredits, 6);
        switch (billing.billingStatus) {
            case "settled":
                summary = t("account.wallet.ledger.actualCharge", { amount: formatCredits(billing.chargedMicrocredits, 6) });
                detail =
                    billing.refundedMicrocredits > 0
                        ? t("account.wallet.ledger.releasedDetail", { reserved, released: formatCredits(billing.refundedMicrocredits, 6) })
                        : billing.chargedMicrocredits > billing.reservedMicrocredits
                          ? t("account.wallet.ledger.supplementDetail", { reserved, supplement: formatCredits(billing.chargedMicrocredits - billing.reservedMicrocredits, 6) })
                          : t("account.wallet.ledger.reservedDetail", { reserved });
                break;
            case "refunded":
                summary = t("account.wallet.ledger.refundedNoCharge");
                detail = t("account.wallet.ledger.releasedDetail", { reserved, released: formatCredits(billing.refundedMicrocredits, 6) });
                break;
            case "uncertain":
                summary = t("account.wallet.ledger.uncertain");
                detail = t("account.wallet.ledger.uncertainDetail", { reserved });
                break;
            case "reserved":
            case "running":
                summary = t("account.wallet.ledger.pending");
                detail = t("account.wallet.ledger.pendingDetail", { reserved });
                break;
        }
    }
    const providerName = entry.type === "payment_topup" ? entry.paymentProviderName || entry.paymentProviderId : undefined;
    const source = providerName ? t("account.wallet.ledger.paymentSource", { channel: providerName }) : "";
    const description = (arkGroup ? [note] : [source, entry.scene, entry.model, note]).filter(Boolean).join(" · ");

    return (
        <article className={cn("workspace-wallet-ledger-row", billing && "is-billing")}>
            <span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")} aria-hidden="true">
                {positive ? <Coins /> : <CreditCard />}
            </span>
            <div>
                <strong>{summary ? `${title} · ${summary}` : title}</strong>
                {detail ? <span className="workspace-wallet-ledger-detail">{detail}</span> : null}
                {description ? <span title={description}>{description}</span> : null}
            </div>
            <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(currentLocale(), { hour12: false })}</time>
            {entry.type !== "billing" ? (
                <b className={positive ? "is-income" : "is-consume"}>
                    {positive ? "+" : ""}
                    {formatCredits(entry.amountMicrocredits, 6)}
                </b>
            ) : null}
        </article>
    );
}
