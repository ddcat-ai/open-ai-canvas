# 无限画布文档索引

## 项目介绍

- [快速开始](/docs/overview/quick-start)
- [功能介绍](/docs/overview/features)
- [Render 部署](/docs/overview/render)
- [Docker 部署](/docs/overview/docker)

## 操作手册

- [画布节点操作手册](/docs/canvas/canvas-node-manual)
- [画布快捷键](/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/docs/backend/local-development)
- [代码功能地图](/docs/backend/code-map)
- [画布数据结构](/docs/backend/canvas-data-structure)

## 项目进度

- [更新日志](/docs/progress/changelog)
- [Aceternity UI 重构计划](/docs/progress/aceternity-ui-refactor)
- [运维后台交互规范](/docs/progress/admin-interaction-guidelines)
- [待测试](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## 说明

- 登录账号后，画布项目和“我的素材”会同步到后端；图片、视频和音频保存在私有 OSS 或后端资源目录，可随账号跨浏览器读取。
- AI API Key 保存在浏览器本地；画布生成任务会随任务提交到后端队列，由后端请求 OpenAI 兼容接口。
