# yingce-agent

独立的 Agent Node 运行时。它不连接数据库，也不执行计费、审批或画布写入。

后端在 `YINGCE_AGENT_URL` 非空时把一轮会话交给本服务，并在自己的网络地址上提供一次性 bridge token。Node 只通过该 bridge 把模型、工具和事件交回 Go。远程调用失败时不会回退到后端内嵌进程，避免同一步执行两次。

本地开发不设置 `YINGCE_AGENT_URL`，后端仍在本进程启动 Node。生产 Compose 必须同时提供镜像、`YINGCE_AGENT_TOKEN` 和 `YINGCE_AGENT_BRIDGE_HOST`。
