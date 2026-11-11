package auth

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
)

const (
	libTVMCPProtocolVersion  = "2025-06-18"
	libTVMCPMaxResponseBytes = 8 << 20
)

type mcpRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type mcpRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *mcpRPCError    `json:"error"`
}

type mcpRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type libTVMCPSession struct {
	rt        libTVRuntime
	token     string
	sessionID string
	nextID    int
}

func (s *Service) fetchLibTVProjectDetail(projectUUID string) (*libTVDetail, error) {
	projectUUID = strings.TrimSpace(projectUUID)
	if !isLibTVProjectUUID(projectUUID) {
		return nil, kernel.BadAuthRequest("LibTV 画布 UUID 格式无效")
	}
	detail, err := s.fetchLibTVProjectDetailWithToken(projectUUID, false)
	if err != nil && isLibTVUnauthorized(err) {
		return s.fetchLibTVProjectDetailWithToken(projectUUID, true)
	}
	return detail, err
}

func (s *Service) fetchLibTVProjectDetailWithToken(projectUUID string, forceRefresh bool) (*libTVDetail, error) {
	token, err := s.libTVAccessToken(forceRefresh)
	if err != nil {
		return nil, err
	}
	session, err := s.openLibTVMCPSession(token)
	if err != nil {
		return nil, err
	}
	tools, err := session.listTools()
	if err != nil && !isLibTVUnauthorized(err) {
		// 工具清单失败时仍尝试直接读取，避免因 list 差异阻断导入。
		tools = nil
	} else if err != nil {
		return nil, err
	}
	if tool, ok := tools["target_project"]; ok {
		if _, callErr := session.callTool("target_project", libTVMCPToolArgs(tool, projectUUID)); callErr != nil && isLibTVUnauthorized(callErr) {
			return nil, callErr
		}
	}
	readTool, ok := tools["read_project"]
	args := libTVMCPToolArgs(readTool, projectUUID)
	if !ok {
		args = map[string]any{"projectId": projectUUID, "uuid": projectUUID}
	}
	result, err := session.callTool("read_project", args)
	if err != nil {
		return nil, err
	}
	detail, err := libTVDetailFromMCPResult(result, projectUUID)
	if err != nil {
		return nil, err
	}
	if detail.copyChecked && !detail.copyAllowed {
		return nil, errors.New("当前 LibTV 画布不允许复制")
	}
	if strings.TrimSpace(detail.ProjectMeta.UUID) == "" {
		detail.ProjectMeta.UUID = projectUUID
	}
	return detail, nil
}

func (s *Service) lookupLibTVAccount(accessToken string) (string, string) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return "", ""
	}
	session, err := s.openLibTVMCPSession(accessToken)
	if err != nil {
		return "", ""
	}
	result, err := session.callTool("account_user", map[string]any{})
	if err != nil {
		return "", ""
	}
	payload := extractMCPStructuredPayload(result)
	return accountNameFromPayload(payload), accountIDFromPayload(payload)
}

func (s *Service) openLibTVMCPSession(token string) (*libTVMCPSession, error) {
	session := &libTVMCPSession{rt: s.libTVRuntime(), token: token, nextID: 1}
	_, err := session.call("initialize", map[string]any{
		"protocolVersion": libTVMCPProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "yingce-libtv-import", "version": "1.0.0"},
	})
	if err != nil {
		return nil, err
	}
	if err := session.notify("notifications/initialized", map[string]any{}); err != nil {
		return nil, err
	}
	return session, nil
}

func (session *libTVMCPSession) listTools() (map[string]mcpTool, error) {
	raw, err := session.call("tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var payload struct {
		Tools []mcpTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("LibTV 工具清单格式无效")
	}
	tools := make(map[string]mcpTool, len(payload.Tools))
	for _, tool := range payload.Tools {
		name := strings.TrimSpace(tool.Name)
		if name != "" {
			tools[name] = tool
		}
	}
	return tools, nil
}

func (session *libTVMCPSession) callTool(name string, arguments map[string]any) (json.RawMessage, error) {
	raw, err := session.call("tools/call", map[string]any{"name": name, "arguments": arguments})
	if err != nil {
		return nil, err
	}
	var result struct {
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(raw, &result); err == nil && result.IsError {
		return nil, fmt.Errorf("%s", mcpToolErrorMessage(raw, name))
	}
	return raw, nil
}

func (session *libTVMCPSession) notify(method string, params any) error {
	req := mcpRPCRequest{JSONRPC: "2.0", Method: method, Params: params}
	_, _, err := session.post(req, false)
	return err
}

func (session *libTVMCPSession) call(method string, params any) (json.RawMessage, error) {
	session.nextID++
	req := mcpRPCRequest{JSONRPC: "2.0", ID: session.nextID, Method: method, Params: params}
	body, status, err := session.post(req, true)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized {
		return nil, libTVUnauthorizedError()
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("LibTV MCP 请求失败（HTTP %d）", status)
	}
	var rpc mcpRPCResponse
	if err := json.Unmarshal(body, &rpc); err != nil {
		return nil, errors.New("LibTV MCP 响应格式无效")
	}
	if rpc.Error != nil && strings.TrimSpace(rpc.Error.Message) != "" {
		return nil, errors.New(rpc.Error.Message)
	}
	if len(rpc.Result) == 0 || string(rpc.Result) == "null" {
		return nil, errors.New("LibTV MCP 响应缺少结果")
	}
	return rpc.Result, nil
}

func (session *libTVMCPSession) post(payload mcpRPCRequest, expectResult bool) ([]byte, int, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequest(http.MethodPost, session.rt.mcpURL, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+session.token)
	if session.sessionID != "" {
		req.Header.Set("Mcp-Session-Id", session.sessionID)
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	resp, err := session.rt.client.Do(req)
	if err != nil {
		return nil, 0, errors.New("LibTV MCP 请求失败，请检查网络或重新连接账号")
	}
	defer resp.Body.Close()
	if id := strings.TrimSpace(resp.Header.Get("Mcp-Session-Id")); id != "" {
		session.sessionID = id
	}
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusAccepted {
		return nil, resp.StatusCode, nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, libTVMCPMaxResponseBytes+1))
	if err != nil {
		return nil, resp.StatusCode, errors.New("读取 LibTV MCP 响应失败")
	}
	if int64(len(body)) > libTVMCPMaxResponseBytes {
		return nil, resp.StatusCode, errors.New("LibTV MCP 响应过大")
	}
	if !expectResult {
		return body, resp.StatusCode, nil
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		parsed, err := parseMCPSSE(body)
		if err != nil {
			return nil, resp.StatusCode, err
		}
		return parsed, resp.StatusCode, nil
	}
	return body, resp.StatusCode, nil
}

func parseMCPSSE(body []byte) ([]byte, error) {
	var last []byte
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(line, "\r"), "data:"))
		line = strings.TrimSpace(line)
		if line == "" || line == "[DONE]" {
			continue
		}
		if json.Valid([]byte(line)) {
			last = []byte(line)
		}
	}
	if len(last) == 0 {
		return nil, errors.New("LibTV MCP 事件流中没有有效结果")
	}
	return last, nil
}

func libTVMCPToolArgs(tool mcpTool, projectUUID string) map[string]any {
	keys := libTVProjectArgumentKeys(tool.InputSchema)
	if len(keys) == 0 {
		return map[string]any{"projectId": projectUUID, "uuid": projectUUID}
	}
	args := make(map[string]any, len(keys))
	for _, key := range keys {
		args[key] = projectUUID
	}
	return args
}

func libTVProjectArgumentKeys(schema map[string]any) []string {
	if schema == nil {
		return nil
	}
	preferred := []string{"projectId", "project_id", "uuid", "projectUuid", "projectUUID", "project_uuid", "id"}
	properties, _ := schema["properties"].(map[string]any)
	var required []string
	switch value := schema["required"].(type) {
	case []any:
		for _, item := range value {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				required = append(required, strings.TrimSpace(text))
			}
		}
	case []string:
		required = append(required, value...)
	}
	var keys []string
	seen := map[string]struct{}{}
	add := func(key string) {
		key = strings.TrimSpace(key)
		if key == "" {
			return
		}
		if properties != nil {
			if _, ok := properties[key]; !ok {
				return
			}
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	for _, key := range preferred {
		add(key)
	}
	for _, key := range required {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "project") || lower == "uuid" || lower == "id" {
			add(key)
		}
	}
	return keys
}

func libTVDetailFromMCPResult(raw json.RawMessage, projectUUID string) (*libTVDetail, error) {
	payload := extractMCPStructuredPayload(raw)
	if len(payload) == 0 {
		return nil, errors.New("LibTV 画布数据为空")
	}
	if wrapped, ok := unwrapLibTVEnvelope(payload); ok {
		payload = wrapped
	}
	detail, err := normalizeLibTVDetail(payload, projectUUID)
	if err != nil {
		return nil, err
	}
	return detail, nil
}

func extractMCPStructuredPayload(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err == nil && asMap != nil {
		if structured := mapFromAny(asMap["structuredContent"]); structured != nil {
			return structured
		}
		if content, ok := asMap["content"].([]any); ok {
			if parsed := mapsFromMCPContent(content); parsed != nil {
				return parsed
			}
		}
		if _, hasNodes := firstPresent(asMap, "nodeList", "node_list", "nodes", "projectMeta", "project", "project_meta"); hasNodes {
			return asMap
		}
		if data := mapFromAny(asMap["data"]); data != nil {
			return data
		}
		if result := mapFromAny(asMap["result"]); result != nil {
			return result
		}
	}
	var asText string
	if err := json.Unmarshal(raw, &asText); err == nil {
		var parsed map[string]any
		if json.Unmarshal([]byte(asText), &parsed) == nil {
			return parsed
		}
	}
	return asMap
}

func mapsFromMCPContent(content []any) map[string]any {
	for _, item := range content {
		block, _ := item.(map[string]any)
		if block == nil {
			continue
		}
		if structured := mapFromAny(block["json"]); structured != nil {
			return structured
		}
		text, _ := block["text"].(string)
		if strings.TrimSpace(text) == "" {
			continue
		}
		var parsed map[string]any
		if json.Unmarshal([]byte(text), &parsed) == nil {
			return parsed
		}
	}
	return nil
}

func unwrapLibTVEnvelope(payload map[string]any) (map[string]any, bool) {
	code, hasCode := payload["code"]
	data := mapFromAny(payload["data"])
	if !hasCode || data == nil {
		return nil, false
	}
	switch typed := code.(type) {
	case float64:
		if typed != 0 {
			return nil, false
		}
	case json.Number:
		if n, err := typed.Int64(); err != nil || n != 0 {
			return nil, false
		}
	case string:
		if typed != "" && typed != "0" {
			return nil, false
		}
	}
	return data, true
}

func normalizeLibTVDetail(payload map[string]any, projectUUID string) (*libTVDetail, error) {
	if payload == nil {
		return nil, errors.New("LibTV 画布数据为空")
	}
	detail := &libTVDetail{}
	meta := firstMap(payload, "projectMeta", "project_meta", "project", "meta")
	if meta == nil {
		meta = payload
	}
	detail.ProjectMeta.UUID = kernel.FirstNonEmpty(stringFromAny(meta["uuid"]), stringFromAny(meta["id"]), stringFromAny(meta["projectId"]), stringFromAny(meta["project_id"]), projectUUID)
	detail.ProjectMeta.Name = kernel.FirstNonEmpty(stringFromAny(meta["name"]), stringFromAny(meta["title"]), stringFromAny(meta["projectName"]))
	if effective := firstMap(meta, "effective", "permission", "permissions"); effective != nil {
		canRead, hasRead := boolFromAny(effective["canRead"])
		if !hasRead {
			canRead, hasRead = boolFromAny(effective["can_read"])
		}
		canCopy, hasCopy := boolFromAny(effective["canCopy"])
		if !hasCopy {
			canCopy, hasCopy = boolFromAny(effective["can_copy"])
		}
		if hasRead || hasCopy {
			detail.copyChecked = true
			detail.ProjectMeta.Effective.CanRead = canRead || !hasRead
			detail.ProjectMeta.Effective.CanCopy = canCopy || !hasCopy
			detail.copyAllowed = detail.ProjectMeta.Effective.CanRead && detail.ProjectMeta.Effective.CanCopy
		}
	}
	nodes := firstSlice(payload, "nodeList", "node_list", "nodes")
	for _, item := range nodes {
		raw, ok := normalizeLibTVRawNode(item)
		if !ok {
			continue
		}
		detail.NodeList = append(detail.NodeList, raw)
	}
	connections := firstSlice(payload, "connectionList", "connection_list", "connections", "edges")
	for _, item := range connections {
		raw, ok := normalizeLibTVRawConnection(item)
		if !ok {
			continue
		}
		detail.ConnectionList = append(detail.ConnectionList, raw)
	}
	return detail, nil
}

func normalizeLibTVRawNode(item any) (libTVRawNode, bool) {
	object := mapFromAny(item)
	if object == nil {
		return libTVRawNode{}, false
	}
	var raw libTVRawNode
	raw.NodeKey = kernel.FirstNonEmpty(stringFromAny(object["nodeKey"]), stringFromAny(object["node_key"]), stringFromAny(object["id"]), stringFromAny(object["key"]))
	raw.Name = kernel.FirstNonEmpty(stringFromAny(object["name"]), stringFromAny(object["title"]))
	raw.IsStale = boolValue(object["isStale"]) || boolValue(object["is_stale"])
	if task := firstMap(object, "taskInfo", "task_info"); task != nil {
		raw.TaskInfo.Status = intFromAny(task["status"])
		raw.TaskInfo.FailedReason = stringFromAny(task["failedReason"], task["failed_reason"])
	}
	position := firstMap(object, "position")
	raw.Position.X = firstNumericString(object, position, "positionX", "x")
	raw.Position.Y = firstNumericString(object, position, "positionY", "y")
	measured := firstMap(object, "measured", "size")
	raw.Measured.Width = firstNumericString(object, measured, "width")
	raw.Measured.Height = firstNumericString(object, measured, "height")
	switch data := object["data"].(type) {
	case string:
		raw.Data = data
	case map[string]any:
		encoded, err := json.Marshal(data)
		if err == nil {
			raw.Data = string(encoded)
		}
	default:
		synthesized := map[string]any{}
		for _, key := range []string{"type", "url", "coverUrl", "cover_url", "params", "styleAssetUuid", "styleVersionUuid", "styleName", "taskInfo", "isStale", "_resourceMeta", "resourceMeta"} {
			if value, ok := object[key]; ok {
				synthesized[canonicalLibTVNodeDataKey(key)] = value
			}
		}
		if len(synthesized) > 0 {
			encoded, err := json.Marshal(synthesized)
			if err == nil {
				raw.Data = string(encoded)
			}
		}
	}
	if strings.TrimSpace(raw.NodeKey) == "" {
		return libTVRawNode{}, false
	}
	return raw, true
}

func normalizeLibTVRawConnection(item any) (libTVRawConnection, bool) {
	object := mapFromAny(item)
	if object == nil {
		return libTVRawConnection{}, false
	}
	raw := libTVRawConnection{
		ConnectionID: kernel.FirstNonEmpty(stringFromAny(object["connectionId"]), stringFromAny(object["connection_id"]), stringFromAny(object["id"])),
		Source:       kernel.FirstNonEmpty(stringFromAny(object["source"]), stringFromAny(object["from"]), stringFromAny(object["fromNodeId"]), stringFromAny(object["from_node_id"]), stringFromAny(object["sourceNodeId"])),
		Target:       kernel.FirstNonEmpty(stringFromAny(object["target"]), stringFromAny(object["to"]), stringFromAny(object["toNodeId"]), stringFromAny(object["to_node_id"]), stringFromAny(object["targetNodeId"])),
	}
	if raw.ConnectionID == "" || raw.Source == "" || raw.Target == "" {
		return libTVRawConnection{}, false
	}
	return raw, true
}

func canonicalLibTVNodeDataKey(key string) string {
	switch key {
	case "cover_url":
		return "coverUrl"
	case "resourceMeta":
		return "_resourceMeta"
	default:
		return key
	}
}

func accountNameFromPayload(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	user := firstMap(payload, "user", "account", "profile", "data")
	candidates := []map[string]any{payload, user}
	for _, item := range candidates {
		if item == nil {
			continue
		}
		if name := kernel.FirstNonEmpty(stringFromAny(item["displayName"]), stringFromAny(item["display_name"]), stringFromAny(item["nickname"]), stringFromAny(item["name"]), stringFromAny(item["username"]), stringFromAny(item["userName"])); name != "" {
			return name
		}
	}
	return ""
}

func accountIDFromPayload(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	user := firstMap(payload, "user", "account", "profile", "data")
	candidates := []map[string]any{payload, user}
	for _, item := range candidates {
		if item == nil {
			continue
		}
		if id := kernel.FirstNonEmpty(stringFromAny(item["id"]), stringFromAny(item["userId"]), stringFromAny(item["user_id"]), stringFromAny(item["accountId"]), stringFromAny(item["uuid"])); id != "" {
			return id
		}
	}
	return ""
}

func mcpToolErrorMessage(raw json.RawMessage, name string) string {
	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(raw, &result) == nil {
		for _, item := range result.Content {
			if text := strings.TrimSpace(item.Text); text != "" {
				return text
			}
		}
	}
	return "LibTV 工具 " + name + " 返回错误"
}

func libTVUnauthorizedError() error {
	return kernel.Unauthorized("LibTV 授权已失效，请重新连接账号")
}

func isLibTVUnauthorized(err error) bool {
	if err == nil {
		return false
	}
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr.Status == http.StatusUnauthorized {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "invalid_token") || strings.Contains(msg, "unauthorized")
}

func mapFromAny(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case json.RawMessage:
		var parsed map[string]any
		if json.Unmarshal(typed, &parsed) == nil {
			return parsed
		}
	case string:
		var parsed map[string]any
		if json.Unmarshal([]byte(typed), &parsed) == nil {
			return parsed
		}
	}
	return nil
}

func firstMap(object map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if parsed := mapFromAny(object[key]); parsed != nil {
			return parsed
		}
	}
	return nil
}

func firstSlice(object map[string]any, keys ...string) []any {
	for _, key := range keys {
		switch typed := object[key].(type) {
		case []any:
			return typed
		case json.RawMessage:
			var parsed []any
			if json.Unmarshal(typed, &parsed) == nil {
				return parsed
			}
		}
	}
	return nil
}

func firstPresent(object map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		if value, ok := object[key]; ok && value != nil {
			return value, true
		}
	}
	return nil, false
}

func firstPresentValue(object map[string]any, keys ...string) any {
	value, _ := firstPresent(object, keys...)
	return value
}

func stringFromAny(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if text := strings.TrimSpace(typed); text != "" {
				return text
			}
		case json.Number:
			return typed.String()
		case float64:
			if typed == math.Trunc(typed) {
				return strconv.FormatInt(int64(typed), 10)
			}
			return strconv.FormatFloat(typed, 'f', -1, 64)
		case int:
			return strconv.Itoa(typed)
		case int64:
			return strconv.FormatInt(typed, 10)
		}
	}
	return ""
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(typed))
		return n
	}
	return 0
}

func boolFromAny(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes":
			return true, true
		case "false", "0", "no":
			return false, true
		}
	case float64:
		return typed != 0, true
	}
	return false, false
}

func boolValue(value any) bool {
	ok, _ := boolFromAny(value)
	return ok
}

func firstNumericString(objects ...any) string {
	var keys []string
	var maps []map[string]any
	for _, value := range objects {
		switch typed := value.(type) {
		case string:
			keys = append(keys, typed)
		case map[string]any:
			if typed != nil {
				maps = append(maps, typed)
			}
		default:
			if text := stringFromAny(value); text != "" {
				return text
			}
			if parsed := mapFromAny(value); parsed != nil {
				maps = append(maps, parsed)
			}
		}
	}
	for _, object := range maps {
		if text := stringFromAny(firstPresentValue(object, keys...)); text != "" {
			return text
		}
	}
	return ""
}
