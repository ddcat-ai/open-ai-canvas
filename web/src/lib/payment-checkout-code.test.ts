import assert from "node:assert/strict";
import test from "node:test";

import { isPaymentQrImageURL } from "./payment-checkout-code";

test("isPaymentQrImageURL 识别虎皮椒二维码图片地址", () => {
    assert.equal(isPaymentQrImageURL("https://api.xunhupay.com/qrcode.png"), true);
    assert.equal(isPaymentQrImageURL(" https://api.dpweixin.com/qrcode.png "), true);
    assert.equal(isPaymentQrImageURL("https://pay.example/qrcode"), true);
    assert.equal(isPaymentQrImageURL("http://pay.example/images/order-qr.jpg"), true);
});

test("isPaymentQrImageURL 不把待编码载荷或收银页当成图片", () => {
    assert.equal(isPaymentQrImageURL("weixin://wxpay/bizpayurl?pr=abc"), false);
    assert.equal(isPaymentQrImageURL("https://api.xunhupay.com/pay/jump"), false);
    assert.equal(isPaymentQrImageURL("https://pay.example/checkout?qrcode=1"), false);
    assert.equal(isPaymentQrImageURL(""), false);
    assert.equal(isPaymentQrImageURL("/qrcode.png"), false);
});
