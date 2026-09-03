## yingce.payment/v1

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-alipay-page",
  "name": "支付宝电脑网站支付",
  "version": "1.0.0",
  "author": "支付宝",
  "description": "支付宝电脑网站支付充值适配器。",
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
        "required": true
      },
      {
        "name": "appId",
        "type": "string",
        "label": "应用 AppID",
        "required": true
      },
      {
        "name": "sellerId",
        "type": "string",
        "label": "支付宝商户 PID",
        "required": true
      },
      {
        "name": "merchantPrivateKey",
        "type": "textarea",
        "label": "应用私钥",
        "required": true,
        "secret": true
      },
      {
        "name": "alipayPublicKey",
        "type": "textarea",
        "label": "支付宝公钥",
        "required": true,
        "secret": true
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "支付宝网关",
        "required": true,
        "default": "https://openapi.alipay.com/gateway.do"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "alipay-page-pay",
        "label": "支付宝电脑网站支付",
        "icon": "brand:alipay",
        "checkoutMode": "redirect",
        "identityFields": [
          "appId",
          "sellerId"
        ],
        "expiryPolicy": {
          "defaultMinutes": 30,
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
