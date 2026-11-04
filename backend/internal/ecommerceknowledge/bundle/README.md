# 电商知识离线数据包

`knowledge.json.gz` 包含 23 个知识源与 14740 条知识：14739 条已审核通过、1 条已拒绝。KB01 为 11 条，KB02–KB10 各 10 条；其余为固定版本的商品分类及社区知识。完整分来源数量、仓库、commit、许可及 SHA-256 见 `manifest.json`。

数据与 Go 程序一起嵌入，首次启动在单个数据库事务中初始化，不要求连接 GitHub。版本安装记录写入 `system_settings.ecommerce_knowledge_bundle_receipt`，后续启动直接跳过。新版本只合并缺失的源与条目，不覆盖已有内容、审核状态或来源启停设置；任一步失败会回滚数据与安装记录。

文件是 UTF-8 JSON 经 gzip 压缩，结构为 `formatVersion`、`sources`、`entries`，字段与 `model.EcommerceKnowledgeSource`、`model.EcommerceKnowledgeEntry` 的 JSON 合同一致。可以用 `gzip -dc knowledge.json.gz` 解压审查。`internal/ecommerceknowledge.Read` 会核验压缩文件 SHA-256、来源许可、固定版本、引用完整性、ID 与去重哈希唯一性，以及分来源、审核状态和知识域数量。

## 来源与许可

每个第三方源的完整许可证、版权声明、仓库地址和固定 commit 均保留在 `sources[].licenseText` 等字段中。每条知识保留来源 URL、commit、许可、版本、审核与有效期信息。MIT 与 CC0-1.0 内容须按各自原始许可使用；KB01–KB10 的原始作者与许可标识保留在记录中，前台来源名称使用中性名称。

数据包仅含公共电商知识表，不含用户、会话、商品图片、渠道凭据、登录支付配置或具体部署的模型渠道绑定。四阶段模型配置的页面与协议随功能代码提供，部署后由管理员从自己的模型目录中选择。

## 维护入口

已有数据库可以在显式指定数据库位置后运行：

```bash
go run ./cmd/ecommerce-knowledge -bootstrap-bundled -admin <已有管理员ID>
```

`-bootstrap-builtin` 用于按代码版本升级 KB01–KB10，`-sync` 用于管理员主动同步固定的第三方源。所有维护写操作都要求已有管理员。来源更新与人工审核不通过后台自动重新启用或批准。
