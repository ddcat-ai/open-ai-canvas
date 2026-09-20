const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;
const QRCODE_PATH = /(?:^|\/)qrcode(?:[-_./]|$)/i;

/** 渠道已生成的二维码图片地址，应直接展示，不能再编码成新的二维码。 */
export function isPaymentQrImageURL(value: string): boolean {
    const raw = value.trim();
    if (!raw) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return false;
    }
    return IMAGE_PATH.test(parsed.pathname) || QRCODE_PATH.test(parsed.pathname);
}
