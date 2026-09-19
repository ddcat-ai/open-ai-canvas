# 支付FM 接口协议说明

遵循 `yingce.payment/v1` 标准，自动转换影策系统订单至支付FM `/startOrder` 接口，并在收到通知时按 MD5 规则完成异步验签。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-zhifufm",
  "name": "支付FM",
  "version": "1.0.0",
  "author": "支付FM",
  "description": "支付FM个人免签/签约聚合支付适配器，支持微信/支付宝扫码或收银台跳转。",
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
        "description": "用于生成异步通知 notifyUrl 地址，必须可被支付FM外网服务器访问回调。"
      },
      {
        "name": "merchantNum",
        "type": "string",
        "label": "商户号 (merchantNum)",
        "required": true,
        "description": "支付FM商户后台【用户中心】查看的商户号（8-18位数字）。"
      },
      {
        "name": "secretKey",
        "type": "password",
        "label": "接入密钥 (secretKey)",
        "required": true,
        "secret": true,
        "description": "支付FM商户后台【用户中心】查看的接口接入密钥。"
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "接口根地址",
        "required": true,
        "default": "https://api-5a0zvlcbi80.zhifu.fm.it88168.com/api",
        "description": "支付FM分配的接口根地址，如 https://api-5a0zvlcbi80.zhifu.fm.it88168.com/api。"
      },
      {
        "name": "payType",
        "type": "string",
        "label": "默认支付通道 (payType)",
        "required": false,
        "default": "alipay",
        "description": "支付产品通道：alipay(支付宝)、wechat(微信)、aloop(支付宝轮询池)、tloop(微信轮询池)等。"
      },
      {
        "name": "checkoutMode",
        "type": "string",
        "label": "收银方式",
        "required": false,
        "default": "redirect",
        "values": [
          "redirect",
          "qr_code"
        ],
        "description": "redirect 跳转支付FM收银页；qr_code 在钱包中直接将 payUrl 渲染为二维码扫码。"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "zhifufm-pay",
        "label": "支付FM",
        "icon": "assets/icon.svg",
        "checkoutMode": "redirect",
        "identityFields": [
          "merchantNum"
        ],
        "expiryPolicy": {
          "defaultMinutes": 10,
          "minMinutes": 3,
          "maxMinutes": 15
        },
        "notificationSuccess": {
          "status": 200,
          "contentType": "text/plain; charset=utf-8",
          "body": "success"
        },
        "notificationFailure": {
          "status": 400,
          "contentType": "text/plain; charset=utf-8",
          "body": "fail"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
