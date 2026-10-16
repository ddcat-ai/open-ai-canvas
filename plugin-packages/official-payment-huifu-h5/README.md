# 斗拱 H5 支付

官方 `yingce.payment/v1` 支付插件。对接汇付斗拱「H5、PC预下单」接口（`pre_order_type=1`，H5 页面版 `request_type=M`），返回 `jump_url` 由宿主跳转收银台。构建脚本交叉编译 macOS、Linux、Windows 的 amd64/arm64，入口仍声明为 `backend/provider`。
