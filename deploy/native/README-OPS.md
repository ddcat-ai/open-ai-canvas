# Open AI Canvas 独立线上运维目录

代码目录是 `/root/open-ai-canvas`，运维目录是 `/root/open-ai-canvas-ops`。运维目录只保存发布脚本和服务器路径配置，不保存数据库密码、模型密钥或上传文件。

常用命令：

```bash
cd /root/open-ai-canvas-ops
./release.sh
./status.sh
./rollback.sh
```

发布脚本会锁定发布、快进拉取私有仓库 `main`、构建 React 静态文件和两个 Go 二进制、备份 PostgreSQL、切换版本目录、重启两个 systemd 服务并检查本机健康接口。失败时会恢复上一份程序。
