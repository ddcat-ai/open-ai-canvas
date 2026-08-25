package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	diagnosticSchemaVersion    = 1
	diagnosticRedactionVersion = 1
	diagnosticMaxWindow        = 24 * time.Hour
	diagnosticMaxClientEvents  = 500
	diagnosticMaxBundleBytes   = 10 << 20
	diagnosticMaxDescription   = 1000
	diagnosticMaxEventText     = 4000
)

type DiagnosticClientEvent struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Level      string `json:"level"`
	Category   string `json:"category"`
	Code       string `json:"code,omitempty"`
	Message    string `json:"message"`
	Route      string `json:"route,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
	RequestID  string `json:"requestId,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
	TaskID     string `json:"taskId,omitempty"`
	ProjectID  string `json:"projectId,omitempty"`
	CanvasID   string `json:"canvasId,omitempty"`
	Stack      string `json:"stack,omitempty"`
}

type DiagnosticRuntime struct {
	AppVersion  string `json:"appVersion,omitempty"`
	BuildCommit string `json:"buildCommit,omitempty"`
	Browser     string `json:"browser,omitempty"`
	OS          string `json:"os,omitempty"`
	Timezone    string `json:"timezone,omitempty"`
}

type DiagnosticExportRequest struct {
	From         string                  `json:"from"`
	To           string                  `json:"to"`
	TaskID       string                  `json:"taskId,omitempty"`
	ProjectID    string                  `json:"projectId,omitempty"`
	Description  string                  `json:"description,omitempty"`
	Runtime      DiagnosticRuntime       `json:"runtime"`
	ClientEvents []DiagnosticClientEvent `json:"clientEvents"`
}

type DiagnosticPreview struct {
	ClientEventLimit int   `json:"clientEventLimit"`
	TaskCount        int   `json:"taskCount"`
	TaskLogCount     int   `json:"taskLogCount"`
	APICallCount     int   `json:"apiCallCount"`
	EstimatedBytes   int64 `json:"estimatedBytes"`
	WillTruncate     bool  `json:"willTruncate"`
}

type DiagnosticBundle struct {
	BundleID string
	FileName string
	Data     []byte
}

type diagnosticWindow struct {
	From time.Time
	To   time.Time
}

type diagnosticCollection struct {
	Window       diagnosticWindow
	Description  string
	TaskID       string
	ProjectID    string
	Runtime      diagnosticRuntimeRecord
	ClientEvents []diagnosticClientEventRecord
	Tasks        []diagnosticTaskRecord
	TaskLogs     []diagnosticTaskLogRecord
	APICalls     []diagnosticAPICallRecord
	Truncated    bool
}

type diagnosticRuntimeRecord struct {
	AppVersion  string `json:"appVersion,omitempty"`
	BuildCommit string `json:"buildCommit,omitempty"`
	Browser     string `json:"browser,omitempty"`
	OS          string `json:"os,omitempty"`
	Timezone    string `json:"timezone,omitempty"`
}

type diagnosticClientEventRecord struct {
	ID         string `json:"id,omitempty"`
	Timestamp  string `json:"timestamp,omitempty"`
	Level      string `json:"level,omitempty"`
	Category   string `json:"category,omitempty"`
	Code       string `json:"code,omitempty"`
	Message    string `json:"message,omitempty"`
	Route      string `json:"route,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
	RequestID  string `json:"requestId,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
	TaskID     string `json:"taskId,omitempty"`
	ProjectID  string `json:"projectId,omitempty"`
	CanvasID   string `json:"canvasId,omitempty"`
	Stack      string `json:"stack,omitempty"`
}

type diagnosticTaskRecord struct {
	ID                string     `json:"id"`
	TraceID           string     `json:"traceId,omitempty"`
	RequestID         string     `json:"requestId,omitempty"`
	ProjectID         string     `json:"projectId,omitempty"`
	Type              string     `json:"type,omitempty"`
	Status            string     `json:"status,omitempty"`
	Stage             string     `json:"stage,omitempty"`
	Progress          int        `json:"progress,omitempty"`
	Operation         string     `json:"operation,omitempty"`
	Provider          string     `json:"provider,omitempty"`
	Model             string     `json:"model,omitempty"`
	LogicalModelID    string     `json:"logicalModelId,omitempty"`
	ProviderRequestID string     `json:"providerRequestId,omitempty"`
	Error             string     `json:"error,omitempty"`
	Attempts          int        `json:"attempts,omitempty"`
	StartedAt         *time.Time `json:"startedAt,omitempty"`
	CompletedAt       *time.Time `json:"completedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type diagnosticTaskLogRecord struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"taskId,omitempty"`
	TraceID   string    `json:"traceId,omitempty"`
	RequestID string    `json:"requestId,omitempty"`
	Level     string    `json:"level,omitempty"`
	Message   string    `json:"message,omitempty"`
	Payload   string    `json:"payload,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type diagnosticAPICallRecord struct {
	ID                string    `json:"id"`
	TraceID           string    `json:"traceId,omitempty"`
	RequestID         string    `json:"requestId,omitempty"`
	ChannelID         string    `json:"channelId,omitempty"`
	TaskID            string    `json:"taskId,omitempty"`
	Source            string    `json:"source,omitempty"`
	Capability        string    `json:"capability,omitempty"`
	Operation         string    `json:"operation,omitempty"`
	RequestKind       string    `json:"requestKind,omitempty"`
	APIFormat         string    `json:"apiFormat,omitempty"`
	Method            string    `json:"method,omitempty"`
	Path              string    `json:"path,omitempty"`
	Model             string    `json:"model,omitempty"`
	Status            string    `json:"status,omitempty"`
	StatusCode        int       `json:"statusCode,omitempty"`
	DurationMs        int64     `json:"durationMs,omitempty"`
	PollCount         int       `json:"pollCount,omitempty"`
	ProviderStatus    string    `json:"providerStatus,omitempty"`
	ProviderRequestID string    `json:"providerRequestId,omitempty"`
	ErrorCode         string    `json:"errorCode,omitempty"`
	Error             string    `json:"error,omitempty"`
	StartedAt         time.Time `json:"startedAt"`
	CreatedAt         time.Time `json:"createdAt"`
}

type diagnosticManifest struct {
	SchemaVersion    int                 `json:"schemaVersion"`
	BundleID         string              `json:"bundleId"`
	GeneratedAt      time.Time           `json:"generatedAt"`
	AppVersion       string              `json:"appVersion,omitempty"`
	BuildCommit      string              `json:"buildCommit,omitempty"`
	TimeRange        diagnosticTimeRange `json:"timeRange"`
	TaskID           string              `json:"taskId,omitempty"`
	ProjectID        string              `json:"projectId,omitempty"`
	Description      string              `json:"description,omitempty"`
	RedactionVersion int                 `json:"redactionVersion"`
	Truncated        bool                `json:"truncated,omitempty"`
	Counts           diagnosticCounts    `json:"counts"`
}

type diagnosticTimeRange struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type diagnosticCounts struct {
	ClientEvents int `json:"clientEvents"`
	Tasks        int `json:"tasks"`
	TaskLogs     int `json:"taskLogs"`
	APICalls     int `json:"upstreamCalls"`
}

func (s *Service) PreviewDiagnosticBundle(userID string, req DiagnosticExportRequest) (*DiagnosticPreview, error) {
	collection, err := s.collectDiagnosticData(userID, req)
	if err != nil {
		return nil, err
	}
	return &DiagnosticPreview{
		ClientEventLimit: diagnosticMaxClientEvents,
		TaskCount:        len(collection.Tasks), TaskLogCount: len(collection.TaskLogs), APICallCount: len(collection.APICalls),
		EstimatedBytes: int64(2048 + len(collection.ClientEvents)*420 + len(collection.Tasks)*620 + len(collection.TaskLogs)*700 + len(collection.APICalls)*520),
		WillTruncate:   collection.Truncated,
	}, nil
}

func (s *Service) ExportDiagnosticBundle(userID string, req DiagnosticExportRequest) (*DiagnosticBundle, error) {
	collection, err := s.collectDiagnosticData(userID, req)
	if err != nil {
		return nil, err
	}
	bundleID := "DIAG_" + strings.ToUpper(newID()[:8])
	manifest := diagnosticManifest{
		SchemaVersion: diagnosticSchemaVersion, BundleID: bundleID, GeneratedAt: time.Now().UTC(),
		AppVersion: collection.Runtime.AppVersion, BuildCommit: collection.Runtime.BuildCommit,
		TimeRange: diagnosticTimeRange{From: collection.Window.From, To: collection.Window.To},
		TaskID:    collection.TaskID, ProjectID: collection.ProjectID, Description: collection.Description,
		RedactionVersion: diagnosticRedactionVersion, Truncated: collection.Truncated,
		Counts: diagnosticCounts{ClientEvents: len(collection.ClientEvents), Tasks: len(collection.Tasks), TaskLogs: len(collection.TaskLogs), APICalls: len(collection.APICalls)},
	}
	data, err := buildDiagnosticZIP(bundleID, manifest, collection)
	if err != nil {
		return nil, err
	}
	if len(data) > diagnosticMaxBundleBytes {
		return nil, BadAuthRequest("诊断包超过 10 MB，请缩短时间范围后重试")
	}
	fileName := fmt.Sprintf("yingce-diagnostics-%s-%s.zip", time.Now().UTC().Format("20060102-150405"), bundleID)
	return &DiagnosticBundle{BundleID: bundleID, FileName: fileName, Data: data}, nil
}

func (s *Service) collectDiagnosticData(userID string, req DiagnosticExportRequest) (*diagnosticCollection, error) {
	window, err := normalizeDiagnosticWindow(req.From, req.To)
	if err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.TaskID)
	projectID := strings.TrimSpace(req.ProjectID)
	if len(taskID) > 96 || len(projectID) > 96 {
		return nil, BadAuthRequest("诊断上下文无效")
	}
	if taskID != "" {
		task, taskErr := s.repo.TaskForUser(userID, taskID)
		if errors.Is(taskErr, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("任务不存在或无权访问")
		}
		if taskErr != nil {
			return nil, taskErr
		}
		if projectID != "" && task.ProjectID != projectID {
			return nil, BadAuthRequest("任务不属于当前项目")
		}
		if projectID == "" {
			projectID = task.ProjectID
		}
	}
	tasks, err := s.repo.DiagnosticTasks(userID, window.From, window.To, taskID, projectID)
	if err != nil {
		return nil, err
	}
	taskLogs, err := s.repo.DiagnosticTaskLogs(userID, window.From, window.To, taskID, projectID)
	if err != nil {
		return nil, err
	}
	apiCalls, err := s.repo.DiagnosticAPICallLogs(userID, window.From, window.To, taskID, projectID)
	if err != nil {
		return nil, err
	}
	clientEvents := req.ClientEvents
	truncated := false
	if len(clientEvents) > diagnosticMaxClientEvents {
		clientEvents = clientEvents[len(clientEvents)-diagnosticMaxClientEvents:]
		truncated = true
	}
	collection := &diagnosticCollection{
		Window: window, Description: redactDiagnosticText(req.Description, diagnosticMaxDescription), TaskID: taskID, ProjectID: projectID, Truncated: truncated,
		Runtime: diagnosticRuntimeRecord{
			AppVersion: redactDiagnosticText(req.Runtime.AppVersion, 120), BuildCommit: redactDiagnosticText(req.Runtime.BuildCommit, 120),
			Browser: redactDiagnosticText(req.Runtime.Browser, 240), OS: redactDiagnosticText(req.Runtime.OS, 120), Timezone: redactDiagnosticText(req.Runtime.Timezone, 80),
		},
	}
	for _, event := range clientEvents {
		collection.ClientEvents = append(collection.ClientEvents, sanitizeDiagnosticClientEvent(event))
	}
	for _, task := range tasks {
		collection.Tasks = append(collection.Tasks, sanitizeDiagnosticTask(task))
	}
	for _, taskLog := range taskLogs {
		collection.TaskLogs = append(collection.TaskLogs, sanitizeDiagnosticTaskLog(taskLog))
	}
	for _, apiCall := range apiCalls {
		collection.APICalls = append(collection.APICalls, sanitizeDiagnosticAPICall(apiCall))
	}
	return collection, nil
}

func normalizeDiagnosticWindow(fromRaw string, toRaw string) (diagnosticWindow, error) {
	now := time.Now().UTC()
	from, to := now.Add(-30*time.Minute), now
	var err error
	if strings.TrimSpace(fromRaw) != "" {
		from, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(fromRaw))
		if err != nil {
			return diagnosticWindow{}, BadAuthRequest("诊断开始时间格式无效")
		}
	}
	if strings.TrimSpace(toRaw) != "" {
		to, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(toRaw))
		if err != nil {
			return diagnosticWindow{}, BadAuthRequest("诊断结束时间格式无效")
		}
	}
	from, to = from.UTC(), to.UTC()
	if to.After(now) {
		to = now
	}
	if !to.After(from) {
		return diagnosticWindow{}, BadAuthRequest("诊断时间范围无效")
	}
	if to.Sub(from) > diagnosticMaxWindow {
		return diagnosticWindow{}, BadAuthRequest("诊断时间范围不能超过 24 小时")
	}
	return diagnosticWindow{From: from, To: to}, nil
}

func sanitizeDiagnosticClientEvent(event DiagnosticClientEvent) diagnosticClientEventRecord {
	return diagnosticClientEventRecord{
		ID: sanitizeDiagnosticIdentifier(event.ID), Timestamp: redactDiagnosticText(event.Timestamp, 80), Level: redactDiagnosticText(event.Level, 24), Category: redactDiagnosticText(event.Category, 32),
		Code: redactDiagnosticText(event.Code, 120), Message: redactDiagnosticText(event.Message, diagnosticMaxEventText), Route: sanitizeDiagnosticPath(event.Route),
		DurationMs: boundedDiagnosticInt64(event.DurationMs, 0, 86_400_000), HTTPStatus: boundedDiagnosticInt(event.HTTPStatus, 0, 599),
		RequestID: sanitizeDiagnosticIdentifier(event.RequestID), TraceID: sanitizeDiagnosticIdentifier(event.TraceID), TaskID: sanitizeDiagnosticIdentifier(event.TaskID), ProjectID: sanitizeDiagnosticIdentifier(event.ProjectID), CanvasID: sanitizeDiagnosticIdentifier(event.CanvasID),
		Stack: redactDiagnosticText(event.Stack, diagnosticMaxEventText),
	}
}

func sanitizeDiagnosticTask(task model.Task) diagnosticTaskRecord {
	return diagnosticTaskRecord{
		ID: task.ID, TraceID: sanitizeDiagnosticIdentifier(task.TraceID), RequestID: sanitizeDiagnosticIdentifier(task.RequestID), ProjectID: sanitizeDiagnosticIdentifier(task.ProjectID),
		Type: redactDiagnosticText(task.Type, 80), Status: redactDiagnosticText(string(task.Status), 32), Stage: redactDiagnosticText(task.Stage, 160), Progress: boundedDiagnosticInt(task.Progress, 0, 100),
		Operation: redactDiagnosticText(task.Operation, 120), Provider: redactDiagnosticText(task.Provider, 120), Model: redactDiagnosticText(task.Model, 160), LogicalModelID: sanitizeDiagnosticIdentifier(task.LogicalModelID),
		ProviderRequestID: sanitizeDiagnosticIdentifier(task.ProviderRequestID), Error: redactDiagnosticText(task.Error, diagnosticMaxEventText), Attempts: boundedDiagnosticInt(task.Attempts, 0, 100),
		StartedAt: task.StartedAt, CompletedAt: task.CompletedAt, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
	}
}

func sanitizeDiagnosticTaskLog(taskLog model.TaskLog) diagnosticTaskLogRecord {
	return diagnosticTaskLogRecord{ID: taskLog.ID, TaskID: sanitizeDiagnosticIdentifier(taskLog.TaskID), TraceID: sanitizeDiagnosticIdentifier(taskLog.TraceID), RequestID: sanitizeDiagnosticIdentifier(taskLog.RequestID), Level: redactDiagnosticText(taskLog.Level, 24), Message: redactDiagnosticText(taskLog.Message, diagnosticMaxEventText), Payload: redactDiagnosticText(taskLog.Payload, diagnosticMaxEventText), CreatedAt: taskLog.CreatedAt}
}

func sanitizeDiagnosticAPICall(log model.ApiCallLog) diagnosticAPICallRecord {
	return diagnosticAPICallRecord{
		ID: log.ID, TraceID: sanitizeDiagnosticIdentifier(log.TraceID), RequestID: sanitizeDiagnosticIdentifier(log.RequestID), ChannelID: sanitizeDiagnosticIdentifier(log.ChannelID), TaskID: sanitizeDiagnosticIdentifier(log.TaskID),
		Source: redactDiagnosticText(log.Source, 80), Capability: redactDiagnosticText(log.Capability, 48), Operation: redactDiagnosticText(log.Operation, 120), RequestKind: redactDiagnosticText(log.RequestKind, 48), APIFormat: redactDiagnosticText(log.APIFormat, 48),
		Method: redactDiagnosticText(log.Method, 16), Path: sanitizeDiagnosticPath(log.Path), Model: redactDiagnosticText(log.Model, 160), Status: redactDiagnosticText(string(log.Status), 32), StatusCode: boundedDiagnosticInt(log.StatusCode, 0, 599),
		DurationMs: boundedDiagnosticInt64(log.DurationMs, 0, 86_400_000), PollCount: boundedDiagnosticInt(log.PollCount, 0, 10000), ProviderStatus: redactDiagnosticText(log.ProviderStatus, 80),
		ProviderRequestID: sanitizeDiagnosticIdentifier(log.ProviderRequestID), ErrorCode: redactDiagnosticText(log.ErrorCode, 120), Error: redactDiagnosticText(log.Error, diagnosticMaxEventText), StartedAt: log.StartedAt, CreatedAt: log.CreatedAt,
	}
}

func buildDiagnosticZIP(bundleID string, manifest diagnosticManifest, collection *diagnosticCollection) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeDiagnosticZipFile(archive, "manifest.json", append(manifestData, byte(10))); err != nil {
		return nil, err
	}
	newline := string(rune(10))
	readme := fmt.Sprintf("影策用户诊断包%s%s诊断编号：%s%s时间范围：%s 至 %s%s%s该文件由用户主动导出，仅包含有限时间范围内的脱敏诊断摘要。%s", newline, newline, bundleID, newline, collection.Window.From.Format(time.RFC3339), collection.Window.To.Format(time.RFC3339), newline, newline, newline)
	if err := writeDiagnosticZipFile(archive, "README.txt", []byte(readme)); err != nil {
		return nil, err
	}
	if err := writeDiagnosticJSONL(archive, "client/events.jsonl", collection.ClientEvents); err != nil {
		return nil, err
	}
	if err := writeDiagnosticJSONL(archive, "backend/tasks.jsonl", collection.Tasks); err != nil {
		return nil, err
	}
	if err := writeDiagnosticJSONL(archive, "backend/task-logs.jsonl", collection.TaskLogs); err != nil {
		return nil, err
	}
	if err := writeDiagnosticJSONL(archive, "backend/upstream-calls.jsonl", collection.APICalls); err != nil {
		return nil, err
	}
	runtimeData, err := json.MarshalIndent(collection.Runtime, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeDiagnosticZipFile(archive, "context/runtime.json", append(runtimeData, byte(10))); err != nil {
		return nil, err
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeDiagnosticJSONL[T any](archive *zip.Writer, name string, records []T) error {
	var data bytes.Buffer
	for _, record := range records {
		encoded, err := json.Marshal(record)
		if err != nil {
			return err
		}
		data.Write(encoded)
		data.WriteByte(10)
	}
	return writeDiagnosticZipFile(archive, name, data.Bytes())
}

func writeDiagnosticZipFile(archive *zip.Writer, name string, data []byte) error {
	file, err := archive.Create(name)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	return err
}

func sanitizeDiagnosticIdentifier(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 96 {
		return ""
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._:-", char) {
			continue
		}
		return ""
	}
	return value
}

func sanitizeDiagnosticPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if index := strings.IndexAny(value, "?#"); index >= 0 {
		value = value[:index]
	}
	return redactDiagnosticText(value, 300)
}

func redactDiagnosticText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	for _, marker := range []string{"authorization", "cookie", "set-cookie", "x-goog-api-key", "x-canvas-upstream-headers", "api_key", "api-key", "apikey", "access_key", "access-key", "secret_key", "secret-key", "password", "token="} {
		value = redactDiagnosticMarker(value, marker)
	}
	return truncateRunes(redactDiagnosticURLs(value), limit)
}

func redactDiagnosticMarker(value string, marker string) string {
	searchFrom := 0
	for searchFrom < len(value) {
		lower := strings.ToLower(value)
		index := strings.Index(lower[searchFrom:], strings.ToLower(marker))
		if index < 0 {
			break
		}
		index += searchFrom
		end := index + len(marker)
		for end < len(value) && isDiagnosticSeparator(value[end]) {
			end++
		}
		valueEnd := end
		for valueEnd < len(value) && !isDiagnosticValueDelimiter(value[valueEnd]) {
			valueEnd++
		}
		if valueEnd == end {
			searchFrom = end
			continue
		}
		value = value[:end] + "[REDACTED]" + value[valueEnd:]
		searchFrom = end + len("[REDACTED]")
	}
	return value
}

func redactDiagnosticURLs(value string) string {
	searchFrom := 0
	for searchFrom < len(value) {
		startHTTP := strings.Index(value[searchFrom:], "http://")
		startHTTPS := strings.Index(value[searchFrom:], "https://")
		start := -1
		if startHTTP >= 0 {
			start = startHTTP
		}
		if startHTTPS >= 0 && (start < 0 || startHTTPS < start) {
			start = startHTTPS
		}
		if start < 0 {
			break
		}
		start += searchFrom
		end := start
		for end < len(value) && !isDiagnosticURLDelimiter(value[end]) {
			end++
		}
		raw := value[start:end]
		parsed, err := url.Parse(raw)
		if err != nil {
			searchFrom = end
			continue
		}
		parsed.RawQuery = ""
		parsed.Fragment = ""
		safe := parsed.String()
		value = value[:start] + safe + value[end:]
		searchFrom = start + len(safe)
	}
	return value
}

func isDiagnosticSeparator(value byte) bool {
	return value == ' ' || value == 9 || value == ':' || value == '='
}

func isDiagnosticValueDelimiter(value byte) bool {
	switch value {
	case ' ', 9, 13, 10, ',', ';', '"', 39, '<', '>', '}', ']':
		return true
	default:
		return false
	}
}

func isDiagnosticURLDelimiter(value byte) bool {
	return value == ' ' || value == 9 || value == 13 || value == 10 || value == '"' || value == 39 || value == '<' || value == '>'
}

func boundedDiagnosticInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func boundedDiagnosticInt64(value int64, min int64, max int64) int64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
