package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type jsonMap map[string]any

type bridgeOptions struct {
	Server      string `json:"server"`
	Token       string `json:"token"`
	Comfy       string `json:"comfy"`
	WorkflowDir string `json:"workflowDir"`
	PollSeconds int    `json:"pollSeconds"`
}

type bridgeRequest struct {
	ID       string  `json:"id"`
	TaskID   string  `json:"taskId"`
	BridgeID string  `json:"bridgeId"`
	Payload  jsonMap `json:"payload"`
}

var bridgeHTTP = &http.Client{Timeout: 70 * time.Second}
var comfyHTTP = &http.Client{Timeout: 10 * time.Minute}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fatal(err)
	}
	fmt.Printf("ComfyUI Bridge connecting to %s\n", options.Server)
	go heartbeatLoop(options)
	for {
		request, err := pollRequest(options)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge: %v\n", err)
			time.Sleep(2500 * time.Millisecond)
			continue
		}
		if request != nil {
			executeRequest(options, *request)
		}
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func parseOptions(args []string) (bridgeOptions, error) {
	value := func(name string) string {
		for index, item := range args {
			if item == name && index+1 < len(args) {
				return strings.TrimSpace(args[index+1])
			}
		}
		return ""
	}
	options := bridgeOptions{PollSeconds: 20}
	if persisted, err := loadBridgeOptions(); err != nil {
		return options, err
	} else if persisted != nil {
		options = *persisted
	}
	if raw := value("--server"); raw != "" {
		options.Server = strings.TrimRight(raw, "/")
	}
	if raw := value("--token"); raw != "" {
		options.Token = raw
	}
	if raw := value("--comfy"); raw != "" {
		options.Comfy = strings.TrimRight(raw, "/")
	}
	if raw := value("--workflow-dir"); raw != "" {
		options.WorkflowDir = raw
	}
	if raw := value("--poll-seconds"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			options.PollSeconds = parsed
		}
	}
	if options.Comfy == "" {
		options.Comfy = "http://127.0.0.1:8188"
	}
	if options.Server == "" || options.Token == "" {
		return options, errors.New("需要 --server 和 --token；首次启动请使用网页生成的启动命令")
	}
	if options.PollSeconds < 0 {
		options.PollSeconds = 0
	}
	if options.PollSeconds > 60 {
		options.PollSeconds = 60
	}
	if err := validateHTTPURL(options.Comfy, "--comfy"); err != nil {
		return options, err
	}
	if err := validateHTTPURL(options.Server, "--server"); err != nil {
		return options, err
	}
	if err := saveBridgeOptions(options); err != nil {
		return options, fmt.Errorf("保存 Bridge 本机配置失败：%w", err)
	}
	return options, nil
}

func bridgeOptionsPath() (string, error) {
	if runtime.GOOS == "windows" {
		base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
		if base == "" {
			return "", errors.New("LOCALAPPDATA 未设置，无法保存 Bridge 本机配置")
		}
		return filepath.Join(base, "OpenAICanvas", "comfy-bridge.json"), nil
	}
	base := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME"))
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("无法确定用户配置目录：%w", err)
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "open-ai-canvas", "comfy-bridge.json"), nil
}

func loadBridgeOptions() (*bridgeOptions, error) {
	path, err := bridgeOptionsPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取 Bridge 本机配置失败：%w", err)
	}
	var options bridgeOptions
	if err := json.Unmarshal(data, &options); err != nil {
		return nil, fmt.Errorf("Bridge 本机配置格式无效：%w", err)
	}
	return &options, nil
}

func saveBridgeOptions(options bridgeOptions) error {
	path, err := bridgeOptionsPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(options, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func validateHTTPURL(value, label string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return fmt.Errorf("%s 只支持不含账号密码的完整 HTTP/HTTPS 地址", label)
	}
	return nil
}

func pollRequest(options bridgeOptions) (*bridgeRequest, error) {
	var data struct {
		Request *bridgeRequest `json:"request"`
	}
	endpoint := fmt.Sprintf("%s/api/comfy-bridge/poll?wait=%d", options.Server, options.PollSeconds)
	if err := requestBridgeJSON(options, http.MethodGet, endpoint, nil, &data); err != nil {
		return nil, err
	}
	return data.Request, nil
}

func executeRequest(options bridgeOptions, request bridgeRequest) {
	completion := jsonMap{"requestId": request.ID, "status": "succeeded"}
	result, err := runComfyRequest(options, request.Payload)
	if err != nil {
		completion["status"] = "failed"
		completion["error"] = err.Error()
	} else {
		completion["result"] = result
	}
	if err := submitResultWithRetry(options, completion); err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 结果回传失败（请求 %s）：%v\n", request.ID, err)
	}
}

func runComfyRequest(options bridgeOptions, payload jsonMap) (jsonMap, error) {
	mode := stringValue(payload["mode"])
	if mode == "" {
		mode = "image"
	}
	workflow, err := loadWorkflow(options, payload)
	if err != nil {
		return nil, err
	}
	fields := sliceValue(payload["workflowFields"])
	if len(fields) == 0 {
		fields = discoverWorkflowFields(workflow, mode)
		payload["workflowFields"] = fields
	}
	if err := validateWorkflowMediaInputs(fields, payload); err != nil {
		return nil, err
	}
	files, err := uploadReferences(options.Comfy, payload)
	if err != nil {
		return nil, err
	}
	if err := applyWorkflowFields(workflow, payload, files); err != nil {
		return nil, err
	}
	applyPromptFallback(workflow, stringValue(payload["prompt"]), fields)
	stripCanvasAnnotationNodes(workflow)
	promptID, err := submitPrompt(options.Comfy, workflow)
	if err != nil {
		return nil, err
	}
	history, err := waitForHistory(options.Comfy, promptID)
	if err != nil {
		return nil, err
	}
	return collectResult(options.Comfy, mode, history)
}

func heartbeatLoop(options bridgeOptions) {
	heartbeat := func() {
		capabilities, err := bridgeCapabilities(options)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 能力扫描失败：%v\n", err)
			return
		}
		if err := requestBridgeJSON(options, http.MethodPost, options.Server+"/api/comfy-bridge/heartbeat", jsonMap{"capabilities": capabilities}, nil); err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 心跳失败：%v\n", err)
		}
	}
	heartbeat()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		heartbeat()
	}
}

func bridgeCapabilities(options bridgeOptions) (jsonMap, error) {
	workflows, err := listWorkflowFiles(options)
	if err != nil {
		return nil, err
	}
	return jsonMap{
		"comfyUrl":    options.Comfy,
		"workflowDir": workflowRoot(options),
		"comfyOnline": checkComfyUI(options.Comfy),
		"workflows":   workflows,
	}, nil
}

func workflowRoot(options bridgeOptions) string {
	if options.WorkflowDir != "" {
		absolute, _ := filepath.Abs(options.WorkflowDir)
		return absolute
	}
	current, _ := os.Getwd()
	return filepath.Join(current, "workflows")
}

func listWorkflowFiles(options bridgeOptions) ([]jsonMap, error) {
	root := workflowRoot(options)
	output := make([]jsonMap, 0)
	err := filepath.WalkDir(root, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if len(output) >= 500 || entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") || strings.HasSuffix(strings.ToLower(entry.Name()), ".config.json") {
			return nil
		}
		relative, _ := filepath.Rel(root, filePath)
		workflowID := filepath.ToSlash(relative)
		item := jsonMap{"workflowId": workflowID, "title": strings.TrimSuffix(workflowID, filepath.Ext(workflowID)), "fields": []any{}, "format": "ui"}
		if workflow, err := readWorkflowFile(filePath); err == nil {
			item["fields"] = discoverWorkflowFields(workflow, "")
			if graph := discoverWorkflowGraph(workflow); len(graph) > 0 {
				item["workflowGraph"] = graph
			}
			if converted := convertComfyCanvasWorkflow(workflow); len(converted) > 0 {
				item["workflowJson"] = converted
				item["fields"] = discoverWorkflowFields(converted, "")
				item["format"] = "api"
			}
			// UI JSON 只有画布布局，不能当作 API prompt 提交；API JSON 才回传
			// 完整拓扑，网页才能绘制节点和连线。画布 JSON 会先转换为 API JSON，
			// 同时保留 workflowGraph 作为轻量预览，避免提交布局字段。
			if isComfyAPIWorkflow(workflow) {
				item["workflowJson"] = workflow
				item["format"] = "api"
			}
		}
		output = append(output, item)
		return nil
	})
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	sortWorkflowList(output)
	return output, nil
}

func isComfyAPIWorkflow(workflow jsonMap) bool {
	if len(workflow) == 0 {
		return false
	}
	for _, rawNode := range workflow {
		node, ok := mapValue(rawNode)
		if !ok || strings.TrimSpace(stringValue(node["class_type"])) == "" {
			continue
		}
		if _, ok := mapValue(node["inputs"]); ok {
			return true
		}
	}
	return false
}

func loadWorkflow(options bridgeOptions, payload jsonMap) (jsonMap, error) {
	if raw, ok := mapValue(payload["workflowJson"]); ok && len(raw) > 0 {
		return cloneMap(unwrapWorkflow(raw))
	}
	workflowID := strings.TrimSpace(stringValue(payload["workflowId"]))
	if workflowID == "" {
		return nil, errors.New("任务没有 workflowJson 或 workflowId")
	}
	if !strings.HasSuffix(strings.ToLower(workflowID), ".json") {
		workflowID += ".json"
	}
	root := workflowRoot(options)
	filePath, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(workflowID)))
	if err != nil {
		return nil, err
	}
	rootAbs, _ := filepath.Abs(root)
	relative, err := filepath.Rel(rootAbs, filePath)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return nil, errors.New("workflowId 路径不合法")
	}
	realRoot, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return nil, err
	}
	realFile, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		return nil, err
	}
	realRelative, err := filepath.Rel(realRoot, realFile)
	if err != nil || realRelative == "." || realRelative == ".." || strings.HasPrefix(realRelative, ".."+string(filepath.Separator)) || filepath.IsAbs(realRelative) {
		return nil, errors.New("workflowId 不能指向 workflows 目录之外")
	}
	return readWorkflowFile(realFile)
}

func readWorkflowFile(filePath string) (jsonMap, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	var value jsonMap
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return unwrapWorkflow(value), nil
}

func unwrapWorkflow(value jsonMap) jsonMap {
	current := value
	for index := 0; index < 3; index++ {
		if nested, ok := mapValue(firstValue(current["prompt"], current["workflow"])); ok {
			current = nested
			continue
		}
		if text := stringValue(firstValue(current["prompt"], current["workflow"])); text != "" {
			var nested jsonMap
			if json.Unmarshal([]byte(text), &nested) == nil {
				current = nested
				continue
			}
		}
		if raw, ok := mapValue(current["raw"]); ok {
			current = raw
			continue
		}
		break
	}
	return current
}

func submitPrompt(comfy string, workflow jsonMap) (string, error) {
	body := jsonMap{"prompt": workflow, "client_id": randomID()}
	var response jsonMap
	if err := requestComfyJSON(http.MethodPost, comfy+"/prompt", body, &response); err != nil {
		return "", fmt.Errorf("ComfyUI 提交工作流失败：%w", err)
	}
	promptID := stringValue(response["prompt_id"])
	if promptID == "" {
		return "", errors.New("ComfyUI 未返回 prompt_id")
	}
	return promptID, nil
}

func waitForHistory(comfy, promptID string) (jsonMap, error) {
	deadline := time.Now().Add(30 * time.Minute)
	emptyOutputPolls := 0
	for time.Now().Before(deadline) {
		var payload jsonMap
		if err := requestComfyJSON(http.MethodGet, comfy+"/history/"+url.PathEscape(promptID), nil, &payload); err == nil {
			if history, ok := mapValue(payload[promptID]); ok {
				completed, err := completedHistory(history)
				if err != nil {
					return nil, err
				}
				if completed {
					return history, nil
				}
				if historyCompletedWithoutOutputs(history) {
					emptyOutputPolls++
					if emptyOutputPolls >= 10 {
						return nil, errors.New("ComfyUI 工作流已完成，但没有返回可下载产物；请检查启用的输出节点")
					}
				} else {
					emptyOutputPolls = 0
				}
			}
		}
		time.Sleep(1500 * time.Millisecond)
	}
	return nil, errors.New("ComfyUI 任务超时")
}

func historyCompletedWithoutOutputs(history jsonMap) bool {
	status, _ := mapValue(history["status"])
	statusText := strings.ToLower(firstNonEmpty(stringValue(status["status_str"]), stringValue(status["status"])))
	completed := boolValue(status["completed"]) || statusText == "success"
	outputs, _ := mapValue(history["outputs"])
	return completed && statusText == "success" && len(outputs) == 0
}

func completedHistory(history jsonMap) (bool, error) {
	status, _ := mapValue(history["status"])
	statusText := strings.ToLower(firstNonEmpty(stringValue(status["status_str"]), stringValue(status["status"])))
	completed := boolValue(status["completed"]) || statusText == "success" || statusText == "error" || statusText == "failed"
	outputs, _ := mapValue(history["outputs"])
	if len(outputs) > 0 && statusText == "" {
		return true, nil
	}
	if !completed {
		return false, nil
	}
	if statusText == "error" || statusText == "failed" {
		return false, fmt.Errorf("ComfyUI 工作流执行失败：%.500s", stringValue(firstValue(status["messages"], statusText)))
	}
	// ComfyUI can publish status=success before persisting the output map.
	// Keep polling so a transient empty output is not reported as a failed task.
	if len(outputs) == 0 {
		return false, nil
	}
	return true, nil
}

func submitResultWithRetry(options bridgeOptions, body jsonMap) error {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		last = requestBridgeJSON(options, http.MethodPost, options.Server+"/api/comfy-bridge/result", body, nil)
		if last == nil {
			return nil
		}
		if attempt < 2 {
			time.Sleep(time.Duration(attempt+1) * time.Second)
		}
	}
	return last
}

func requestBridgeJSON(options bridgeOptions, method, endpoint string, body any, target any) error {
	return requestJSON(bridgeHTTP, method, endpoint, body, target, func(request *http.Request) {
		request.Header.Set("Authorization", "Bearer "+options.Token)
	})
}

func requestComfyJSON(method, endpoint string, body any, target any) error {
	return requestJSON(comfyHTTP, method, endpoint, body, target, nil)
}

func requestJSON(client *http.Client, method, endpoint string, body any, target any, headers func(*http.Request)) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(context.Background(), method, endpoint, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if headers != nil {
		headers(request)
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return err
	}
	if client == bridgeHTTP {
		var envelope struct {
			Code  any             `json:"code"`
			Data  json.RawMessage `json:"data"`
			Msg   string          `json:"msg"`
			Error string          `json:"error"`
		}
		if json.Unmarshal(data, &envelope) != nil {
			return fmt.Errorf("Bridge 服务返回非 JSON：HTTP %d", response.StatusCode)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 || numberValue(envelope.Code) != 0 {
			return errors.New(firstNonEmpty(envelope.Msg, envelope.Error, fmt.Sprintf("Bridge 服务 HTTP %d", response.StatusCode)))
		}
		if target != nil && len(envelope.Data) > 0 && string(envelope.Data) != "null" {
			return json.Unmarshal(envelope.Data, target)
		}
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %.500s", response.StatusCode, string(data))
	}
	if target != nil {
		return json.Unmarshal(data, target)
	}
	return nil
}

func checkComfyUI(comfy string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Get(comfy + "/system_stats")
	if err != nil {
		return false
	}
	response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}

func randomID() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(data)
}

func cloneMap(value jsonMap) (jsonMap, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var cloned jsonMap
	if err := json.Unmarshal(data, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func mapValue(value any) (jsonMap, bool) {
	if item, ok := value.(jsonMap); ok {
		return item, true
	}
	item, ok := value.(map[string]any)
	return jsonMap(item), ok
}

func sliceValue(value any) []any {
	items, _ := value.([]any)
	return items
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	data, _ := json.Marshal(value)
	return strings.TrimSpace(string(data))
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func numberValue(value any) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case json.Number:
		result, _ := item.Float64()
		return result
	case string:
		result, _ := strconv.ParseFloat(item, 64)
		return result
	default:
		return 0
	}
}

func firstValue(values ...any) any {
	for _, value := range values {
		if value != nil && stringValue(value) != "" {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
