package mcpintegration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type ToolCall struct {
	ConnectionID string         `json:"connectionId"`
	Revision     int64          `json:"revision"`
	ToolName     string         `json:"toolName"`
	Arguments    map[string]any `json:"arguments"`
}

// AuthorizeCall is shared by approval preview and execution. Server hints such
// as readOnly never grant permission or bypass the host's approval gate.
func AuthorizeCall(repo *repository.Repository, userID string, call ToolCall) (*model.MCPConnection, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	row, err := repo.MCPConnection(call.ConnectionID)
	if err != nil {
		return nil, notFound(err)
	}
	if row.Scope != "platform" && (row.Scope != "user" || row.UserID != userID) {
		return nil, kernel.NotFound("MCP 配置不存在或无权访问")
	}
	if !row.Enabled || row.LastTestAt == nil {
		return nil, kernel.Forbidden("MCP 连接尚未检测或已停用")
	}
	if row.Revision != call.Revision {
		return nil, kernel.NewAppError(409, "MCP 配置或授权已变化，请重新读取工具并确认操作")
	}
	if row.TemplateID != "" && row.Scope == "user" {
		template, err := repo.MCPTemplate(row.TemplateID)
		if err != nil {
			return nil, notFound(err)
		}
		if !template.Published {
			return nil, kernel.Forbidden("此 MCP 市场条目已下架")
		}
	}
	tools, allowed, err := decodeTools(row)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(allowed, call.ToolName) {
		return nil, kernel.Forbidden("此 MCP 工具未获授权")
	}
	if call.Arguments == nil {
		return nil, kernel.BadAuthRequest("MCP arguments 必须是 JSON 对象")
	}
	raw, err := json.Marshal(call.Arguments)
	if err != nil || len(raw) > 48<<10 {
		return nil, kernel.BadAuthRequest("MCP 调用参数无效或过大")
	}
	for _, tool := range tools {
		if tool.Name == call.ToolName {
			return row, validateArguments(tool, call.Arguments)
		}
	}
	return nil, kernel.Forbidden("MCP 工具不在已发现清单中，请重新检测连接")
}

type AvailableTools struct {
	ConnectionID string `json:"connectionId"`
	Name         string `json:"name"`
	Scope        string `json:"scope"`
	Revision     int64  `json:"revision"`
	ToolCount    int    `json:"toolCount"`
	Tools        []Tool `json:"tools"`
}

func (s *Service) AvailableTools(userID, connectionID, toolName string) ([]AvailableTools, error) {
	rows, err := s.repo.MCPConnections(userID, false)
	if err != nil {
		return nil, err
	}
	result := []AvailableTools{}
	for i := range rows {
		row := &rows[i]
		if !row.Enabled || row.LastTestAt == nil || (connectionID != "" && row.ID != connectionID) {
			continue
		}
		if row.TemplateID != "" && row.Scope == "user" {
			template, err := s.repo.MCPTemplate(row.TemplateID)
			if err != nil {
				return nil, notFound(err)
			}
			if !template.Published {
				continue
			}
		}
		tools, allowed, err := decodeTools(row)
		if err != nil {
			return nil, err
		}
		tools = slices.DeleteFunc(tools, func(t Tool) bool { return !slices.Contains(allowed, t.Name) })
		count := len(tools)
		// Discover connections, then names, then one schema. Large installations
		// never inject every remote tool schema into the model's context.
		if connectionID == "" {
			tools = []Tool{}
		} else if toolName == "" {
			for j := range tools {
				tools[j].InputSchema = nil
				tools[j].Description = truncate(tools[j].Description, 40)
			}
		} else {
			tools = slices.DeleteFunc(tools, func(t Tool) bool { return t.Name != toolName })
		}
		result = append(result, AvailableTools{ConnectionID: row.ID, Name: row.Name, Scope: row.Scope, Revision: row.Revision, ToolCount: count, Tools: tools})
	}
	return result, nil
}

// UncertainExecutionError requires external reconciliation, even if its cause
// is a timeout that ordinary read tools would consider retryable.
type UncertainExecutionError struct{ Cause error }

func (e *UncertainExecutionError) Error() string { return e.Cause.Error() }
func (e *UncertainExecutionError) Unwrap() error { return e.Cause }

func uncertainExecution(status int, message string, cause error) error {
	return &UncertainExecutionError{Cause: kernel.WrapAppError(status, message, cause)}
}

func replayReceipt(existing, expected *model.MCPToolExecution) (map[string]any, error) {
	if existing.Fingerprint != expected.Fingerprint {
		return nil, kernel.NewAppError(409, "MCP 调用标识已被不同参数使用")
	}
	if existing.Status != "completed" {
		return nil, uncertainExecution(409, "MCP 调用正在执行或结果未确认，已阻止重复执行；请先在外部服务核对", nil)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(existing.ResultJSON), &result); err != nil || result == nil {
		return nil, uncertainExecution(500, "MCP 已执行，但保存的回执无法读取；请核对外部结果，不要重复执行", err)
	}
	return result, nil
}

func (s *Service) awaitReceipt(ctx context.Context, existing, expected *model.MCPToolExecution) (map[string]any, error) {
	if existing.Fingerprint != expected.Fingerprint || existing.Status != "running" {
		return replayReceipt(existing, expected)
	}
	// Another backend may own this approval's external action. Wait outside all
	// transactions so it can save the actual receipt; do not let a contender
	// advance the Agent checkpoint with a premature tool_failed. A crashed
	// owner remains non-retryable after a bounded reconciliation window.
	wait := min(time.Until(existing.CreatedAt.Add(2*time.Minute)), 2*time.Minute)
	if wait <= 0 {
		return replayReceipt(existing, expected)
	}
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, uncertainExecution(409, "等待 MCP 回执已中断，请核对外部状态；不会重复发送", ctx.Err())
		case <-deadline.C:
			return replayReceipt(existing, expected)
		case <-tick.C:
			current, err := s.repo.WithContext(ctx).MCPExecution(expected.ID, expected.UserID)
			if err != nil {
				return nil, uncertainExecution(500, "MCP 回执暂时无法读取，请核对外部状态；不会重复发送", err)
			}
			if current.Status != "running" {
				return replayReceipt(current, expected)
			}
		}
	}
}

// Call admits an external action in one short transaction. The host validates
// the persisted approval while the run is locked; configuration is frozen and
// the receipt is claimed before commit. Later revocation/cancellation cannot
// undo an admitted external action. Network IO never holds database locks.
func (s *Service) Call(ctx context.Context, userID, runID, callID string, call ToolCall, approve func(*model.CloudAgentExecution) error) (map[string]any, error) {
	if userID == "" || runID == "" || callID == "" {
		return nil, kernel.BadAuthRequest("MCP 调用缺少可追踪的用户、运行与调用标识")
	}
	if approve == nil {
		return nil, kernel.Forbidden("MCP 调用缺少持久化审批校验")
	}
	raw, err := json.Marshal(call)
	if err != nil {
		return nil, kernel.BadAuthRequest("MCP 调用参数无效")
	}
	fingerprint := sha256.Sum256(raw)
	key := sha256.Sum256([]byte(userID + "\x00" + runID + "\x00" + callID))
	receipt := &model.MCPToolExecution{ID: hex.EncodeToString(key[:]), UserID: userID, RunID: runID, ConnectionID: call.ConnectionID, Fingerprint: hex.EncodeToString(fingerprint[:]), Status: "running"}
	// A completed effect remains replayable even after revocation/deletion.
	if existing, err := s.repo.MCPExecution(receipt.ID, userID); err == nil {
		return s.awaitReceipt(ctx, existing, receipt)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	var cfg remoteConfig
	var secrets []string
	var existingReceipt *model.MCPToolExecution
	err = s.repo.WithContext(ctx).Transaction(func(repo *repository.Repository) error {
		run, err := repo.LockMCPAgentRun(userID, runID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.Forbidden("MCP 调用对应的 Agent 运行不存在或无权访问")
		}
		if err != nil {
			return err
		}
		// Serializing on the run also makes uncertain-check + claim atomic for
		// different call IDs that try to issue the same operation concurrently.
		if existing, err := repo.MCPExecution(receipt.ID, userID); err == nil {
			existingReceipt = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := approve(run); err != nil {
			return err
		}
		if err := repo.LockMCPConnection(call.ConnectionID); err != nil {
			return conflict(err)
		}
		row, err := AuthorizeCall(repo, userID, call)
		if err != nil {
			return err
		}
		cfg, secrets, err = New(repo, s.encrypt, s.decrypt).remoteConfig(row)
		if err != nil {
			return err
		}
		uncertain, err := repo.HasUncertainMCPExecution(userID, runID, receipt.Fingerprint, receipt.ID)
		if err != nil {
			return err
		}
		if uncertain {
			return uncertainExecution(409, "相同 MCP 操作已有未确认结果，不能通过新的调用标识自动重试；请先核对外部状态", nil)
		}
		claimed, existing, err := repo.ClaimMCPExecution(receipt)
		if err != nil {
			return err
		}
		if !claimed {
			existingReceipt = existing
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if existingReceipt != nil {
		return s.awaitReceipt(ctx, existingReceipt, receipt)
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	result, callErr := invoke(ctx, cfg, call.ToolName, call.Arguments)
	status := "completed"
	if callErr != nil {
		status = "uncertain"
		result = map[string]any{"isError": true, "message": "MCP 调用未取得确定结果，请先在外部服务核对；此调用不会自动重试"}
	}
	redacted, err := sanitizeToolResult(result, secrets)
	if err != nil {
		return nil, uncertainExecution(500, "MCP 已返回结果但无法安全保存回执，请先核对外部状态", err)
	}
	raw, err = json.Marshal(redacted)
	if err != nil {
		return nil, uncertainExecution(500, "MCP 回执无法编码，请先核对外部状态", err)
	}
	if err := s.repo.FinishMCPExecution(receipt.ID, userID, status, string(raw)); err != nil {
		return nil, uncertainExecution(500, "MCP 回执保存失败，请先核对外部结果，避免重复执行", err)
	}
	if callErr != nil {
		return nil, uncertainExecution(502, "MCP 调用未取得确定结果，请先核对外部状态；此操作不会自动重试", callErr)
	}
	return redacted, nil
}
