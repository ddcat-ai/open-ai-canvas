import { formatCredits } from "@/constant/credits";
import { formatStorageCapacity, formatStorageDuration } from "@/lib/account-storage-usage";
import type { PaymentOrder } from "@/services/api/payments";
import { translate } from "@/i18n";

/** 订单发放的权益描述：积分数量或扩容容量与有效期。 */
export function paymentOrderGrantLabel(order: Pick<PaymentOrder, "productKind" | "creditsMicrocredits" | "storageBytes" | "storageDurationDays" | "membershipDays" | "membershipGroup">) {
    if (order.productKind === "membership") return translate("membership.offer", { days: order.membershipDays, group: order.membershipGroup, credits: formatCredits(order.creditsMicrocredits, 6) });
    if (order.productKind === "storage") return `${formatStorageCapacity(order.storageBytes || 0)} 存储空间 · ${formatStorageDuration(order.storageDurationDays || 0)}`;
    return `${formatCredits(order.creditsMicrocredits, 6)} 积分`;
}
