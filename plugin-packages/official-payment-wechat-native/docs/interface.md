## yingce.payment/v1

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-wechat-native",
  "name": "微信支付 Native",
  "version": "1.0.0",
  "author": "微信支付",
  "description": "微信支付 Native 扫码充值适配器。",
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
        "label": "AppID",
        "required": true
      },
      {
        "name": "mchId",
        "type": "string",
        "label": "商户号",
        "required": true
      },
      {
        "name": "merchantSerialNo",
        "type": "string",
        "label": "商户证书序列号",
        "required": true
      },
      {
        "name": "merchantPrivateKey",
        "type": "textarea",
        "label": "商户 API 私钥",
        "required": true,
        "secret": true
      },
      {
        "name": "apiV3Key",
        "type": "password",
        "label": "APIv3 密钥",
        "required": true,
        "secret": true
      },
      {
        "name": "wechatPayPublicKeyId",
        "type": "string",
        "label": "微信支付公钥 ID",
        "required": true
      },
      {
        "name": "wechatPayPublicKey",
        "type": "textarea",
        "label": "微信支付公钥",
        "required": true,
        "secret": true
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "wechat-native",
        "label": "微信支付 Native",
        "icon": "brand:wechat-pay",
        "checkoutMode": "qr_code",
        "identityFields": [
          "appId",
          "mchId"
        ],
        "expiryPolicy": {
          "defaultMinutes": 30,
          "minMinutes": 5,
          "maxMinutes": 1440
        },
        "notificationSuccess": {
          "status": 204
        },
        "notificationFailure": {
          "status": 400
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
