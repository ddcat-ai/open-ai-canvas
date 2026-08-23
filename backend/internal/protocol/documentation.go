package protocol

import (
	"embed"
	"fmt"
	"strings"
)

//go:embed docs/*.md
var builtinDocumentationFS embed.FS

func attachDocumentation(info *Metadata) {
	if info == nil || strings.TrimSpace(info.Documentation) != "" {
		return
	}
	document, err := builtinDocumentationFS.ReadFile("docs/" + info.ID + ".md")
	if err != nil {
		return
	}
	info.Documentation = renderBuiltinDocumentation(*info, string(document))
}

// AttachDocumentation fills the reference document for a shipped protocol.
func AttachDocumentation(info *Metadata) {
	attachDocumentation(info)
}

func renderBuiltinDocumentation(info Metadata, document string) string {
	replacements := map[string]string{
		"{{NAME}}":       info.Name,
		"{{OPERATIONS}}": renderOperations(info),
		"{{PARAMETERS}}": renderParameters(info.Parameters),
		"{{CONTRACT}}":   renderRuntimeContract(info),
	}
	for marker, replacement := range replacements {
		document = strings.ReplaceAll(document, marker, replacement)
	}
	return strings.TrimSpace(document) + "\n"
}

func renderOperations(info Metadata) string {
	var b strings.Builder
	b.WriteString("| 阶段 | 方法与相对路径 | 请求类型 | 影策行为 |\n| --- | --- | --- | --- |\n")
	writeOperation(&b, "创建", info.Create, firstNonEmpty(info.ContentType, "application/json"), "提交请求；同步协议直接解析结果，异步协议读取任务 ID")
	if strings.TrimSpace(info.Poll) != "" {
		writeOperation(&b, "轮询", info.Poll, "application/json", "查询状态，成功后提取媒体地址")
	}
	if strings.TrimSpace(info.Cancel) != "" {
		writeOperation(&b, "取消", info.Cancel, "application/json", "取消仍在运行的任务")
	}
	return strings.TrimSpace(b.String())
}

func renderParameters(parameters []Parameter) string {
	if len(parameters) == 0 {
		return "> 当前适配器没有声明可配置参数；这不表示上游没有参数，只表示影策尚未建立稳定映射。"
	}
	var b strings.Builder
	b.WriteString("| 影策字段 | 类型 | 必填 | 实际上游映射 | 说明 |\n| --- | --- | --- | --- | --- |\n")
	for _, parameter := range parameters {
		description := strings.TrimSpace(parameter.Description)
		if len(parameter.Values) > 0 {
			description = strings.TrimSpace(description + " 可选值：" + strings.Join(parameter.Values, "、") + "。")
		}
		fmt.Fprintf(&b, "| `%s` | `%s` | %s | `%s` | %s |\n", markdownCell(parameter.Name), markdownCell(parameter.Type), yesNo(parameter.Required), markdownCell(firstNonEmpty(parameter.Mapping, "未映射")), markdownCell(firstNonEmpty(description, "由当前协议适配器按请求类型转换。")))
	}
	return strings.TrimSpace(b.String())
}

func renderRuntimeContract(info Metadata) string {
	var b strings.Builder
	b.WriteString("## 影策运行时合同\n\n")
	b.WriteString("- Base URL 只填写协议服务根地址，表中的相对路径由适配器拼接；不要把同一路径重复写进 Base URL。\n")
	b.WriteString("- 密钥由后端渠道中转读取，插件详情和浏览器请求不保存密钥。Bearer、供应商签名或专用版本头以本文鉴权章节为准。\n")
	b.WriteString("- 模型名来自渠道模型配置并原样发送。此插件不暗改模型名，也不根据名称猜测价格、额度或能力。\n")
	b.WriteString("- HTTP 非 2xx、非 JSON 响应、缺少任务 ID、成功状态却没有可识别结果都会作为真实错误向上返回。\n")
	if strings.TrimSpace(info.Poll) != "" {
		b.WriteString("- 异步状态统一为：`queued/pending/created/submitted` -> 等待，`running/processing/in_progress` -> 处理中，`succeeded/completed/done` -> 成功，`failed/error/expired/cancelled` -> 失败。\n")
		b.WriteString("- 轮询频率应遵守上游速率限制；媒体 URL 通常有有效期，成功后应立即进入影策资源保存流程。\n")
	}
	b.WriteString("- 参考素材只接受上游可访问的 HTTP(S) URL 或带 MIME 前缀的 data URL；裸 Base64、登录后才能访问的链接和 Cookie 保护地址不可用。\n")
	b.WriteString("- 插件只保证下方“当前实现”明确列出的字段。上游新增能力不会自动获得影策支持，必须补适配、解析和测试。\n")
	return strings.TrimSpace(b.String())
}

func writeOperation(b *strings.Builder, phase, value, contentType, purpose string) {
	parts := strings.SplitN(strings.TrimSpace(value), " ", 2)
	method, path := "", strings.TrimSpace(value)
	if len(parts) == 2 {
		method, path = parts[0], parts[1]
	}
	fmt.Fprintf(b, "| %s | `%s %s` | `%s` | %s |\n", phase, markdownCell(method), markdownCell(path), markdownCell(contentType), purpose)
}

func markdownCell(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "|", "\\|"), "\n", " ")
}

func yesNo(value bool) string {
	if value {
		return "是"
	}
	return "否"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
