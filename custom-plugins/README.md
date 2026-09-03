# 影策自定义协议插件包

本目录包含影策项目自定义的协议插件，用于接入红鸟、Grsai、Agnes等中转站。

## 插件列表

| 插件ID | 名称 | 能力 | 说明 |
|--------|------|------|------|
| hongniao-video | 红鸟视频 | video | 红鸟AI中转站视频生成协议 |
| hongniao-image | 红鸟图像 | image | 红鸟AI中转站图像生成协议（ph-gpt-image系列） |
| grsai-image | Grsai图像 | image | Grsai中转站图像生成协议 |
| agnes-image | Agnes图像 | image | Agnes AI官方图像生成协议 |
| agnes-video | Agnes视频 | video | Agnes AI官方视频生成协议（2.5系列） |

## 打包方法

每个插件目录包含 manifest.json，打包为ZIP格式并改后缀为 .yingce-plugin：

```bash
cd <plugin-dir>
zip -r ../<plugin-id>.yingce-plugin .
```

## 安装方法

1. 登录影策管理员后台
2. 进入「平台资源」→「插件管理」
3. 点击「上传插件」
4. 选择 .yingce-plugin 文件
5. 等待校验通过后启用插件
6. 在「渠道管理」中创建渠道，选择对应的协议

## 注意事项

- 插件包内不包含API Key，密钥在渠道配置中填写
- Agnes视频插件为简化版，主要支持text和reference模式
- 红鸟图像插件仅支持ph-gpt-image系列，不支持banana2系列
- 如遇协议变更，请更新manifest.json中的字段映射
