package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// 工具调用失败的稳定归类（handoff 工作项 B 的第一步：只加分类，不改执行行为）。
//
// 目标是把"模型自己出的错"和"真实世界/上游的错"分开：
//   - 模型幻觉出不存在的工具、在只暴露画布工具的这一轮里调画布工具、参数不合法 → 模型输出问题；
//   - 只读轮里发起写入、目标不具备能力 → 权限边界问题；
//   - 画布在模型读取之后被改动 → 状态冲突（可重读后重试）；
//   - 上游拒绝/超时/网络 → 上游故障。
//
// 分类只进事件载荷，不参与任何放行或拒绝判定：拒绝逻辑仍然在各自的校验点。
const (
	cloudAgentToolErrorInvalidModelOutput = "invalid_model_output"
	cloudAgentToolErrorSchemaError        = "schema_error"
	cloudAgentToolErrorStateConflict      = "state_conflict"
	cloudAgentToolErrorPermission         = "permission_violation"
	cloudAgentToolErrorUpstream           = "upstream_failure"
	cloudAgentToolErrorUnknown            = "tool_error"
)

// cloudAgentToolErrorClass 返回 (errorClass, retryable, requiredAction)。
//
// requiredAction 是给模型/界面看的"下一步该做什么"，取稳定的短标识，不写自然语言：
// fix_arguments（按 schema 改参数后重试）、reread_canvas（重读画布再试）、
// use_advertised_tools（只使用本轮工具表里列出的工具）、ask_user（权限被拒，别自己绕）、
// report_to_user（上游故障，告诉用户）。
func cloudAgentToolErrorClass(req CloudAgentRequest, call cloudAgentCall, err error, allowed bool) (string, bool, string) {
	if err == nil {
		return "", true, ""
	}
	if !allowed {
		// 工具名不在平台工具集里 = 模型幻觉；只被 contextScope 挡掉 = 模型在本轮契约之外调用。
		// 两者都是模型输出问题，不是权限问题（它本来就不该发这个调用）。
		if !cloudAgentPlatformToolNames()[call.Function.Name] {
			return cloudAgentToolErrorInvalidModelOutput, true, "use_advertised_tools"
		}
		scopeRequest := req
		scopeRequest.ContextScope = []string{"canvas"}
		if cloudAgentToolAllowed(scopeRequest, call.Function.Name) {
			return cloudAgentToolErrorInvalidModelOutput, true, "use_advertised_tools"
		}
		return cloudAgentToolErrorPermission, false, "ask_user"
	}
	// 过期快照在上游是结构化字段错误（Field/Issue），先于通用参数错误判定。
	var fieldErr *cloudAgentFieldArgumentError
	if errors.As(err, &fieldErr) {
		if fieldErr.Issue == "stale_snapshot" {
			return cloudAgentToolErrorStateConflict, true, "reread_canvas"
		}
		return cloudAgentToolErrorSchemaError, true, "fix_arguments"
	}
	var argumentErr *cloudAgentArgumentError
	if errors.As(err, &argumentErr) {
		return cloudAgentToolErrorSchemaError, true, "fix_arguments"
	}
	var admissionErr *cloudAgentMediaAdmissionError
	if errors.As(err, &admissionErr) {
		// 媒体准入里"上游拒绝该规格"属于上游故障；其余是参数/状态问题。
		if strings.Contains(admissionErr.Error(), "上游") {
			return cloudAgentToolErrorUpstream, false, "report_to_user"
		}
		return cloudAgentToolErrorSchemaError, true, "fix_arguments"
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return cloudAgentToolErrorUpstream, httpErr.StatusCode >= 500 || httpErr.StatusCode == 429, "report_to_user"
	}
	var pendingErr providerStatePendingError
	if errors.As(err, &pendingErr) {
		return cloudAgentToolErrorUpstream, true, "report_to_user"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return cloudAgentToolErrorUpstream, true, "report_to_user"
	}
	return cloudAgentToolErrorUnknown, true, ""
}

// cloudAgentPlatformToolNames 是平台支持的工具全集（含只在特定条件下暴露的工具）。
func cloudAgentPlatformToolNames() map[string]bool {
	names := make(map[string]bool)
	for _, name := range CloudAgentSupportedToolNames() {
		names[name] = true
	}
	return names
}

// cloudAgentToolErrorLabel 把归类转成一句给人看的短标签（界面与诊断包共用）。
func cloudAgentToolErrorLabel(class string) string {
	switch class {
	case cloudAgentToolErrorInvalidModelOutput:
		return "模型输出问题"
	case cloudAgentToolErrorSchemaError:
		return "参数不符合契约"
	case cloudAgentToolErrorStateConflict:
		return "画布状态已变化"
	case cloudAgentToolErrorPermission:
		return "超出本轮权限"
	case cloudAgentToolErrorUpstream:
		return "上游故障"
	default:
		return "工具执行失败"
	}
}

// schemaStringList 读 schema 里的字符串列表：既可能是 JSON 解码出来的 []any，
// 也可能是 Go 里直接构造的 []string。
func schemaStringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		list := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && text != "" {
				list = append(list, text)
			}
		}
		return list
	default:
		return nil
	}
}

// cloudAgentMissingRequiredArguments 用"本轮实际暴露的 schema"检查必填字段。
//
// 为什么需要它：各工具的校验点是业务代码，抛的多是普通 AppError（例如分镜读取参数无效），
// 从错误类型上看不出"这是模型漏了必填字段"。而模型漏字段恰恰是最常见的工具失败
// （handoff 工作项 B 的证据里，缺 size / 缺 nodeId 类占大头）。这里按 schema 的 required
// 直接判定，把这些错误归到参数契约问题，并把 schema 回给模型让它改对。
//
// 参数不是 JSON 对象时返回空列表（那种情况由 decodeCloudAgentJSONObject 的既有路径覆盖）。
func cloudAgentMissingRequiredArguments(tools []map[string]any, call cloudAgentCall) []string {
	name := strings.TrimSpace(call.Function.Name)
	if name == "" {
		return nil
	}
	var schema map[string]any
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if stringValue(function["name"]) != name {
			continue
		}
		schema, _ = function["parameters"].(map[string]any)
		break
	}
	if schema == nil {
		return nil
	}
	required := schemaStringList(schema["required"])
	if len(required) == 0 {
		return nil
	}
	arguments := map[string]any{}
	raw := strings.TrimSpace(call.Function.Arguments)
	if raw != "" {
		if json.Unmarshal([]byte(raw), &arguments) != nil {
			return nil
		}
	}
	missing := make([]string, 0, len(required))
	for _, key := range required {
		if _, ok := arguments[key]; !ok {
			missing = append(missing, key)
		}
	}
	return missing
}
