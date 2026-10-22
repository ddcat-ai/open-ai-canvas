# Agent 架构守卫

`TestWorkspaceArchitecture` 用 Go AST 扫描 `backend/internal/agent` 下所有生产 Go 源码，不加载 app、不启动模型或数据库。检查：

- 域包禁止导入 `internal/app` / `internal/service`（含子包、匿名或重命名 import）。
- 导出函数签名、类型别名、公开 DTO 字段不得暴露非类型化 map；可追踪同包跨文件、其他 Agent 包的别名。`json.RawMessage` 和 `map[string]json.RawMessage` 可以作为协议边界。检查由 AST 实现，不依赖无法解析类型的正则。
- 单文件至多 600 行、函数至多 120 行、圈复杂度至多 20。复杂度计 if/for/range、非 default case/select 分支及 &&/||；嵌套函数字面量不计入外层函数。

`baseline.json` 是精确标识、带原因的存量例外，初始只登记 runtime.ProcessRequest 的七个旧 JSON 字段及两个引用该类型的入口。没有通配豁免，也没有依赖方向或规模豁免。`Check` 从不写基线、没有自动“接受新增问题”的开关：新问题或值增长失败；问题解决或数值下降时，旧例外也会失败并要求删掉/调低，防止回升到旧债务。

```bash
cd backend
GOCACHE="$PWD/../.local/cache/go-build" go test -count=1 ./internal/agent/architecture
```

专项负例测试证明越层导入、别名隐藏的 map、文件/函数规模增长和基线回退都会失败；它们不编译违规样例，因此无需安装业务依赖。

CI 的 Agent job 使用固定 golangci-lint v2.5.0、明确的 `.golangci.yml` 和 `./internal/agent/...` 范围。golangci 负责 govet/ineffassign/staticcheck；本包负责上述架构约束，不对整个旧 app 仓库一刀切开启复杂度 lint。
