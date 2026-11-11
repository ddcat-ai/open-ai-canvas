package mcpintegration

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const maxTools = 128
const maxResultBytes = 48 << 10

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	ReadOnly    bool           `json:"readOnly"`
}

type remoteConfig struct {
	URL       string
	Transport string
	Headers   map[string]string
}

// The same origin check also applies to legacy SSE's server-selected POST
// endpoint. Credentials are never forwarded to a different host or protocol.
type guardedTransport struct {
	base    http.RoundTripper
	origin  *url.URL
	headers map[string]string
}

func (t guardedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != t.origin.Scheme || !strings.EqualFold(req.URL.Host, t.origin.Host) {
		return nil, errors.New("MCP 跨域请求已拒绝")
	}
	if _, err := outbound.ValidateCustomRelayURL(req.URL.String()); err != nil {
		return nil, err
	}
	copy := req.Clone(req.Context())
	copy.Header = req.Header.Clone()
	for name, value := range t.headers {
		copy.Header.Set(name, value)
	}
	response, err := t.base.RoundTrip(copy)
	if err == nil {
		response.Body = &boundedBody{Reader: io.LimitReader(response.Body, 4<<20), Closer: response.Body}
	}
	return response, err
}

type boundedBody struct {
	io.Reader
	io.Closer
}

func connect(ctx context.Context, cfg remoteConfig) (*mcp.ClientSession, error) {
	origin, err := outbound.ValidateCustomRelayURL(cfg.URL)
	if err != nil {
		return nil, err
	}
	httpClient := outbound.CustomRelayHTTPClient(45 * time.Second)
	httpClient.Transport = guardedTransport{base: httpClient.Transport, origin: origin, headers: cfg.Headers}
	var transport mcp.Transport
	switch cfg.Transport {
	case "streamable_http":
		transport = &mcp.StreamableClientTransport{Endpoint: cfg.URL, HTTPClient: httpClient, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: 1 << 20}
	case "sse":
		transport = &mcp.SSEClientTransport{Endpoint: cfg.URL, HTTPClient: httpClient, MaxEventSize: 1 << 20}
	default:
		return nil, kernel.BadAuthRequest("MCP 仅支持 Streamable HTTP 或 SSE")
	}
	// No sampling, roots, elicitation, OAuth browser flow or local process access.
	client := mcp.NewClient(&mcp.Implementation{Name: "yingce", Version: "1"}, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, kernel.WrapAppError(502, "MCP 连接失败，请检查服务地址、授权参数和服务状态", err)
	}
	return session, nil
}

func discover(ctx context.Context, cfg remoteConfig) ([]Tool, error) {
	session, err := connect(ctx, cfg)
	if err != nil {
		return nil, err
	}
	defer session.Close()
	tools := []Tool{}
	seen, cursors := map[string]bool{}, map[string]bool{}
	cursor := ""
	for page := 0; page < 10; page++ {
		result, err := session.ListTools(ctx, &mcp.ListToolsParams{Cursor: cursor})
		if err != nil {
			return nil, kernel.WrapAppError(502, "MCP 工具发现失败，请检查应用权限", err)
		}
		for _, item := range result.Tools {
			if item == nil || item.Name == "" || len(item.Name) > 128 || seen[item.Name] {
				return nil, kernel.BadAuthRequest("MCP 返回了重复或无效的工具名称")
			}
			seen[item.Name] = true
			schema, ok := item.InputSchema.(map[string]any)
			if !ok || schema["type"] != "object" {
				return nil, kernel.BadAuthRequest("MCP 工具参数必须是对象 JSON Schema")
			}
			raw, err := json.Marshal(schema)
			if err != nil || len(raw) > 32<<10 {
				return nil, kernel.BadAuthRequest("MCP 工具参数定义过大或无效")
			}
			if _, err := resolveSchema(raw); err != nil {
				return nil, kernel.BadAuthRequest("MCP 工具参数 Schema 无效或包含外部引用")
			}
			tools = append(tools, Tool{Name: item.Name, Description: truncate(item.Description, 1200), InputSchema: schema, ReadOnly: item.Annotations != nil && item.Annotations.ReadOnlyHint})
			if len(tools) > maxTools {
				return nil, kernel.BadAuthRequest("MCP 工具超过 128 个，请在服务端限制开放的工具")
			}
		}
		cursor = result.NextCursor
		if cursor == "" {
			sort.Slice(tools, func(i, j int) bool { return tools[i].Name < tools[j].Name })
			return tools, nil
		}
		if cursors[cursor] {
			break
		}
		cursors[cursor] = true
	}
	return nil, kernel.BadAuthRequest("MCP 工具分页异常或超过上限")
}

func resolveSchema(raw []byte) (*jsonschema.Resolved, error) {
	var schema jsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, err
	}
	// A nil loader rejects remote references without performing network IO.
	return schema.Resolve(nil)
}

func validateArguments(tool Tool, arguments map[string]any) error {
	raw, err := json.Marshal(tool.InputSchema)
	if err != nil {
		return kernel.BadAuthRequest("MCP 工具参数定义无效，请重新检测")
	}
	schema, err := resolveSchema(raw)
	if err != nil {
		return kernel.BadAuthRequest("MCP 工具参数定义无效，请重新检测")
	}
	if err := schema.Validate(arguments); err != nil {
		return kernel.BadAuthRequest("MCP 调用参数不符合工具 Schema，请按已发现的定义填写")
	}
	return nil
}

func invoke(ctx context.Context, cfg remoteConfig, name string, arguments map[string]any) (map[string]any, error) {
	session, err := connect(ctx, cfg)
	if err != nil {
		return nil, err
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		return nil, kernel.WrapAppError(502, "MCP 调用未取得确定结果，请在外部服务核对后再决定是否重试", err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, kernel.WrapAppError(502, "MCP 返回结果无法解析", err)
	}
	if len(raw) > maxResultBytes {
		return map[string]any{"isError": result.IsError, "truncated": true, "message": "MCP 已返回结果，但内容超过展示上限；请缩小查询范围或在外部服务查看完整结果"}, nil
	}
	var output map[string]any
	if err := json.Unmarshal(raw, &output); err != nil {
		return nil, err
	}
	return output, nil
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return value
}
