## yingce.payment/v1

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

易支付渠道协议全部封装在本插件内：V1 下单默认 `POST /mapi.php`（MD5），查单 `GET /api.php?act=order`；V2 下单 `POST /api/pay/create`（RSA，`method=jump`），异步通知为 form/JSON，成功应答 `success`。配置字段包括 `publicBaseUrl`、`pid`、`key`、`gateway`、`submitMode`、`settlementCurrency`、`payTypes`、`version`、`checkoutMode`、`privateKey`、`platformPublicKey`。

### submit.php 页面跳转

`submitMode=submit` 时插件不在服务端调用网关，而是按 `pid`、`type`、`out_trade_no`、`notify_url`、`return_url`、`name`、`money` 计算 MD5 签名，生成 `{gateway}/submit.php?...` 作为跳转地址；宿主经 `/api/payments/orders/:id/checkout` 302 到该地址，网关在买家浏览器内按设备选择支付页，因此不传 `device`。地址只含签名，不含商户密钥。该方式只支持 V1/MD5 和 `redirect` 收银方式；查单、关单和通知校验与 `mapi.php` 方式相同。

### 多支付方式

`payTypes` 为逗号分隔的已启用 `type`，可写成 `type:显示名称` 增加网关自定义通道。清单 `methodsField` 指向该字段，宿主据此在充值面板逐个展示支付方式，并在 `create_order` 请求的 `Method` 中传入用户选择；插件只接受已启用的方式，未传时使用第一个。旧配置只有 `payType` 时继续按该单一方式下单。

### 结算货币

`settlementCurrency`（CNY 或 USD，默认 CNY）是网关 `money` 参数的收款货币。插件只接受与之一致的订单货币，查单与通知结果也以该货币返回。商品货币不同时由宿主按管理员配置的 USD/CNY 汇率换算实收金额，并以实收金额校验回调、查单与对账。

### 安全边界

必须显式填写可信 `gateway`，不默认向任何第三方网关发送商户信息。V1 查单严格校验商户（响应包含时）、订单号、正数金额、支付状态和成功流水号；不以请求中的订单号或零金额掩盖不完整响应。通知校验拒绝重复参数、无效签名、非正金额及缺失的成功流水号。支付地址只接受 HTTP(S) 与明确允许的微信、支付宝、QQ 支付协议，不接受任意本机协议或含用户名密码的地址。

V1 关单先查单：已支付订单返回付款凭据，未付款订单只关闭宿主本地记录，不能据此声称上游支付链接已失效。V2 当前仅实现下单和通知验签，未实现查单、刷新收银台和安全关单；`query_order` 返回 `epay_query_unsupported`，`close_order` 返回 `epay_close_unsupported`，不会把未知订单标成已关闭。启用 V2 前需接受这一限制并准备在网关人工核对订单。交易账单下载返回 not found，不表示已完成对账。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-epay",
  "name": "易支付",
  "version": "1.1.0",
  "author": "Epay",
  "description": "易支付适配器，支持 V1/MD5（mapi.php 接口或 submit.php 页面跳转）与 V2/RSA，可同时启用支付宝/微信/QQ/USDT 等多种支付方式。",
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
        "description": "用于确认回调可达；实际 notify_url 由宿主订单生成。"
      },
      {
        "name": "pid",
        "type": "string",
        "label": "商户号 (pid)",
        "required": true
      },
      {
        "name": "key",
        "type": "password",
        "label": "商户密钥 (key)",
        "required": false,
        "secret": true,
        "description": "V1/MD5 密钥；version=1 可留空。"
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "支付网关",
        "required": true,
        "description": "显式填写可信易支付网关根地址，不要带 /mapi.php；不会默认向第三方网关发送商户信息。"
      },
      {
        "name": "submitMode",
        "type": "string",
        "label": "下单方式",
        "required": false,
        "default": "api",
        "values": [
          "api",
          "submit"
        ],
        "description": "api=服务端调用 mapi.php 取得支付地址；submit=生成签名后的 submit.php 地址，由浏览器直接跳转到网关收银台（仅 V1/MD5，收银方式需为 redirect）。"
      },
      {
        "name": "settlementCurrency",
        "type": "string",
        "label": "网关结算货币",
        "required": false,
        "default": "CNY",
        "values": [
          "CNY",
          "USD"
        ],
        "description": "网关 money 参数按此货币收款。商品货币不同时，宿主按「充值商品」页的 USD/CNY 汇率换算实收金额；未配置汇率时不能跨币种下单。"
      },
      {
        "name": "payTypes",
        "type": "multiselect",
        "label": "启用的支付方式",
        "required": false,
        "default": "alipay,wxpay",
        "values": [
          "alipay",
          "wxpay",
          "qqpay",
          "usdt"
        ],
        "description": "可多选，用户充值时逐个展示。网关支持的其他通道可直接输入 type 或 type:显示名称（如 bank:网银），只能使用小写字母、数字、- 和 _。"
      },
      {
        "name": "version",
        "type": "string",
        "label": "接口版本",
        "required": false,
        "default": "0",
        "values": [
          "0",
          "1"
        ],
        "description": "0=V1/MD5，1=V2/RSA。V2 仅支持下单和验签通知，暂不支持查单、刷新收银台及自动关单，启用前需确认此限制。"
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
        "description": "redirect 跳转；qr_code 展示二维码载荷。"
      },
      {
        "name": "privateKey",
        "type": "textarea",
        "label": "V2 商户私钥",
        "required": false,
        "secret": true,
        "description": "仅 version=1，PEM 或裸 Base64。"
      },
      {
        "name": "platformPublicKey",
        "type": "textarea",
        "label": "V2 平台公钥",
        "required": false,
        "description": "仅 version=1，PEM 或裸 Base64。"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "epay",
        "label": "易支付",
        "icon": "assets/icon.svg",
        "checkoutMode": "redirect",
        "identityFields": [
          "pid"
        ],
        "expiryPolicy": {
          "defaultMinutes": 10,
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
        },
        "methodsField": "payTypes",
        "methods": [
          {
            "id": "alipay",
            "label": "支付宝",
            "icon": "brand:alipay"
          },
          {
            "id": "wxpay",
            "label": "微信支付",
            "icon": "brand:wechat-pay"
          },
          {
            "id": "qqpay",
            "label": "QQ 钱包",
            "icon": "brand:qq-pay"
          },
          {
            "id": "usdt",
            "label": "USDT",
            "icon": "brand:usdt"
          }
        ]
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
