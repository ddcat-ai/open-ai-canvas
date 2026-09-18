import { QRCode } from "antd";

import { isPaymentQrImageURL } from "@/lib/payment-checkout-code";

import "./payment-checkout-code.css";

const QR_SIZE = 208;
const QR_DARK = "#111111";
const QR_LIGHT = "#ffffff";

export function PaymentCheckoutCode({ value }: { value: string }) {
    if (isPaymentQrImageURL(value)) {
        return (
            <div className="payment-checkout-code">
                <img src={value} alt="支付二维码" width={QR_SIZE} height={QR_SIZE} referrerPolicy="no-referrer" />
            </div>
        );
    }
    return (
        <div className="payment-checkout-code">
            <QRCode value={value} size={QR_SIZE} bordered={false} color={QR_DARK} bgColor={QR_LIGHT} />
        </div>
    );
}
