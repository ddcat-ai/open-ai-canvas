# 接口与配置

`contributes.walletLinks` 声明购买入口。配置字段 `links` 是 JSON 数组，设置后整体替换清单默认入口；`[]` 隐藏全部入口。

每项字段：唯一 `id`、显示名称 `label`、HTTP(S) `url`，可选 `price` 和 `description`。最多 100 项，地址不可携带账号密码。价格只是外部商品的展示文本，不参与本地扣款。

- `GET /api/payments/wallet-links`：登录且积分功能可用时，响应 `{code:0,data:{links:[...]},msg:"..."}`，仅返回当前用户可用的已启用插件入口。
- `GET /api/admin/plugins/:id/config`：管理员读取配置，响应 data.configuration。
- `PUT /api/admin/plugins/:id/config`：管理员提交 `{"values":{"links":"[...]"}}`，响应保存后的 configuration，并记录审计日志。

浏览器打开链接不会创建支付订单。外部支付结果不作为到账依据；兑换码只能通过本站原有兑换流程校验并入账。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "redeem-purchase-links",
  "name": "购买兑换码",
  "version": "1.2.0",
  "author": "Community",
  "description": "在积分中心提供可配置的兑换码购买入口，无需支付回调。",
  "enabled": false,
  "installable": true,
  "surfaces": [
    "wallet"
  ],
  "permissions": [
    "external.open"
  ],
  "configuration": {
    "fields": [
      {
        "name": "links",
        "type": "json",
        "label": "购买入口",
        "required": true,
        "description": "购买套餐数组，每项包含 id、label、url，可选 price、description。"
      }
    ]
  },
  "contributes": {
    "walletLinks": [
      {
        "id": "redeem-code",
        "label": "兑换码套餐",
        "description": "示例入口，请管理员先配置实际购买链接。",
        "url": "https://example.com/redeem-codes"
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
