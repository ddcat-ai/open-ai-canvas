## yingce.payment/v1

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

虎皮椒渠道协议全部封装在本插件内：下单 `POST /payment/do.html`（JSON），查单 `POST /payment/query.html`，异步通知为 form，成功应答 `success`。配置字段包括 `publicBaseUrl`、`appId`、`appSecret`、`gateway`、`checkoutMode`。没有独立关单和交易账单下载接口：未支付关单按查单结果本地关闭，对账账单返回 not found。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-xunhupay",
  "name": "虎皮椒聚合支付",
  "version": "1.0.0",
  "author": "虎皮椒",
  "description": "虎皮椒聚合支付充值适配器，支持微信/支付宝扫码或跳转收银。",
  "enabled": true,
  "installable": true,
  "runtime": {
    "backend": "rpc",
    "backendEntry": "backend/provider"
  },
  "surfaces": [
    "wallet",
    "settings"
  ],
  "permissions": [
    "payment.create",
    "payment.query",
    "payment.close",
    "payment.reconcile"
  ],
  "configuration": {
    "fields": [
      {
        "name": "publicBaseUrl",
        "type": "url",
        "label": "服务器公网地址",
        "required": true,
        "description": "用于生成异步通知和同步返回地址，必须可被虎皮椒访问。"
      },
      {
        "name": "appId",
        "type": "string",
        "label": "虎皮椒 APPID",
        "required": true
      },
      {
        "name": "appSecret",
        "type": "password",
        "label": "虎皮椒 APPSECRET",
        "required": true,
        "secret": true
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "支付网关",
        "required": true,
        "default": "https://api.xunhupay.com",
        "description": "正式环境 https://api.xunhupay.com，备用 https://api.dpweixin.com。"
      },
      {
        "name": "checkoutMode",
        "type": "string",
        "label": "收银方式",
        "required": false,
        "default": "qr_code",
        "values": [
          "qr_code",
          "redirect"
        ],
        "description": "qr_code 展示渠道返回的二维码图片 url_qrcode（约 5 分钟有效），钱包直接显示该图片；redirect 跳转手机端支付页 url。"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "xunhupay-aggregate",
        "label": "虎皮椒聚合支付",
        "icon": "assets/icon.svg",
        "checkoutMode": "qr_code",
        "identityFields": [
          "appId"
        ],
        "expiryPolicy": {
          "defaultMinutes": 5,
          "minMinutes": 5,
          "maxMinutes": 1440
        },
        "notificationSuccess": {
          "status": 200,
          "contentType": "text/plain; charset=utf-8",
          "body": "success"
        },
        "notificationFailure": {
          "status": 400,
          "contentType": "text/plain; charset=utf-8",
          "body": "failure"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
