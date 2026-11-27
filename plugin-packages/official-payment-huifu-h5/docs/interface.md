## yingce.payment/v1

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

斗拱 H5 渠道协议封装在本插件内，字段与官方接口页一致：

- 预下单 `POST https://api.huifu.com/v2/trade/hosting/payment/preorder`（[H5、PC预下单](https://paas.huifu.com/partners/api/doc/cpjs/api_cpjs_hosting.md)）
- 查询 `POST https://api.huifu.com/v2/trade/hosting/payment/queryorderinfo`（[统一收银台交易查询](https://paas.huifu.com/partners/api/doc/cpjs/api_cpjs_hostingcx.md)）
- 关单 `POST https://api.huifu.com/v2/trade/hosting/payment/close`（[统一收银台交易关单](https://paas.huifu.com/partners/api/doc/cpjs/api_cpjs_hostinggd.md)）
- 异步通知按 [异步消息规范](https://paas.huifu.com/partners/start/ybxx/jiekouguifan_ybxx.md)：POST 表单、`resp_data` + `sign`、汇付公钥验签、HTTP 200，正文前缀 `RECV_ORD_ID_`

`create_order` 固定 `pre_order_type=1`、`hosting_data.request_type=M`。收银 `mode=redirect`，`value` 为官方返回的 `jump_url`。金额按官方「单位元、两位小数」与宿主分互转。`req_seq_id` 使用宿主商户订单号。查询需要官方 `org_req_date`，宿主只给订单号，故按请求日与前一日各查一次。已支付订单不再关单。H5 预下单页未定义账单下载，`download_trade_bill` 返回 not found。

配置字段：`publicBaseUrl`、`sysId`、`productId`、`huifuId`、`projectId`、`projectTitle`、`merchantPrivateKey`、`huifuPublicKey`、`gateway`。`gateway` 必须为 https，生产示例为 `https://api.huifu.com`。加签算法见官方接入指引 https://paas.huifu.com/open/doc/guide/#/api_v2jqyq ；本插件对 `data` 第一层字段按 ASCII 排序后以 `key=value&...` 做 SHA256WithRSA。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-huifu-h5",
  "name": "斗拱 H5 支付",
  "version": "1.0.0",
  "author": "汇付斗拱",
  "description": "斗拱统一收银台 H5 预下单适配器。跳转官方 jump_url 完成支付。",
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
        "description": "用于确认异步通知可达。实际 notify_url 由宿主生成，须为 http/https 且不能带查询参数。"
      },
      {
        "name": "sysId",
        "type": "string",
        "label": "系统号 (sys_id)",
        "required": true,
        "description": "渠道商填渠道商 huifu_id；直连商户填商户 huifu_id。"
      },
      {
        "name": "productId",
        "type": "string",
        "label": "产品号 (product_id)",
        "required": true,
        "description": "汇付分配的产品号，例如 YYZY。"
      },
      {
        "name": "huifuId",
        "type": "string",
        "label": "商户号 (huifu_id)",
        "required": true
      },
      {
        "name": "projectId",
        "type": "string",
        "label": "托管项目号 (project_id)",
        "required": true,
        "description": "合作伙伴控台创建的统一收银台项目号。"
      },
      {
        "name": "projectTitle",
        "type": "string",
        "label": "项目标题 (project_title)",
        "required": true,
        "description": "账单页面展示标题，最长 64 字。"
      },
      {
        "name": "merchantPrivateKey",
        "type": "textarea",
        "label": "商户 RSA 私钥",
        "required": true,
        "secret": true,
        "description": "请求加签。PEM 或裸 Base64。"
      },
      {
        "name": "huifuPublicKey",
        "type": "textarea",
        "label": "汇付 RSA 公钥",
        "required": true,
        "description": "同步响应与异步通知验签。PEM 或裸 Base64。"
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "支付网关",
        "required": true,
        "default": "https://api.huifu.com",
        "description": "官方生产地址 https://api.huifu.com。联调环境填写汇付提供的测试网关，必须是 https。"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "huifu-h5-cashier",
        "label": "斗拱 H5 支付",
        "icon": "assets/icon.svg",
        "checkoutMode": "redirect",
        "identityFields": [
          "sysId",
          "huifuId"
        ],
        "expiryPolicy": {
          "defaultMinutes": 10,
          "minMinutes": 5,
          "maxMinutes": 1440
        },
        "notificationSuccess": {
          "status": 200,
          "contentType": "text/plain; charset=utf-8",
          "body": "RECV_ORD_ID_"
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
