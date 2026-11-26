package app

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

//go:embed admin_assistant_catalog.json
var assistantCatalogJSON []byte

type AssistantOperation struct {
	Method      string             `json:"method"`
	Module      string             `json:"module"`
	Write       bool               `json:"write"`
	HighRisk    bool               `json:"highRisk"`
	Parameters  []string           `json:"parameters"`
	Routes      []string           `json:"routes"`
	InputSchema *jsonschema.Schema `json:"inputSchema,omitempty"`
	Description string             `json:"description"`
}

var assistantCatalogOnce sync.Once
var assistantCatalogRows []AssistantOperation

func assistantCatalog() []AssistantOperation {
	assistantCatalogOnce.Do(func() {
		if err := json.Unmarshal(assistantCatalogJSON, &assistantCatalogRows); err != nil {
			panic(err)
		}
	})
	return assistantCatalogRows
}
func (p *AssistantPrincipal) bindingID() string {
	if p.Credential.GrantID != "" {
		return p.Credential.GrantID
	}
	return p.Credential.ID
}
func (p *AssistantPrincipal) allows(op AssistantOperation) bool {
	// 完全访问由登录管理员明确授予，覆盖当前及未来目录操作；管理员身份仍实时校验。
	if p.Credential != nil && p.Credential.ApprovalMode == AssistantFullAccess {
		return true
	}
	suffix := ":read"
	if op.Write {
		suffix = ":write"
	}
	for _, scope := range p.Scopes {
		if scope == op.Module+suffix {
			return true
		}
	}
	return false
}
func (s *Service) refreshAssistantPrincipal(p *AssistantPrincipal) (*AssistantPrincipal, error) {
	if p == nil || p.Credential == nil {
		return nil, Unauthorized("需要管理 Token")
	}
	row, err := s.repo.AssistantCredential(p.Credential.TokenHash)
	if err != nil || row.ID != p.Credential.ID || row.RevokedAt != nil || !row.ExpiresAt.After(time.Now()) {
		return nil, Unauthorized("管理 Token 已失效")
	}
	u, err := s.assistantAdmin(&model.User{ID: row.UserID})
	if err != nil {
		return nil, err
	}
	if row.GrantID != "" {
		g, e := s.repo.AssistantGrant(row.GrantID)
		if e != nil || g.RevokedAt != nil || !g.ExpiresAt.After(time.Now()) {
			return nil, Unauthorized("授权已撤销")
		}
		row.ApprovalMode, row.ScopesJSON = g.ApprovalMode, g.ScopesJSON
	}
	return &AssistantPrincipal{u, row, assistantScopes(row.ScopesJSON)}, nil
}
func (s *Service) ListAssistantOperations(p *AssistantPrincipal, module, keyword string, page int) (map[string]any, error) {
	p, err := s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		return nil, BadAuthRequest("页码过大")
	}
	items := []AssistantOperation{}
	keyword = strings.ToLower(keyword)
	for _, op := range assistantCatalog() {
		if !p.allows(op) || (module != "" && op.Module != module) || !strings.Contains(strings.ToLower(op.Method+" "+op.Module+" "+strings.Join(op.Routes, " ")), keyword) {
			continue
		}
		op.Description = strings.Join(op.Routes, "; ")
		if op.Description == "" {
			op.Description = op.Module + " / " + op.Method
		}
		items = append(items, op)
	}
	total := len(items)
	start := (page - 1) * 40
	if start > total {
		start = total
	}
	end := start + 40
	if end > total {
		end = total
	}
	return map[string]any{"items": items[start:end], "total": total, "page": page, "pageSize": 40}, nil
}
func assistantOperation(name string) (AssistantOperation, error) {
	for _, op := range assistantCatalog() {
		if op.Method == name {
			return op, nil
		}
	}
	return AssistantOperation{}, NotFound("未知管理操作")
}
func (s *Service) DescribeAssistantOperation(p *AssistantPrincipal, name string) (*AssistantOperation, error) {
	p, err := s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	op, err := assistantOperation(name)
	if err != nil {
		return nil, err
	}
	if !p.allows(op) {
		return nil, Forbidden("Token 未授予此操作权限")
	}
	op.InputSchema, err = assistantOperationSchema(op)
	op.Description = op.Module + " / " + op.Method + "; 输出为业务结果，多返回值按 result0、result1 返回；文件结果返回附件。"
	return &op, err
}

var assistantContextType = reflect.TypeFor[context.Context]()
var assistantUserType = reflect.TypeFor[*model.User]()
var assistantFileType = reflect.TypeFor[*multipart.FileHeader]()
var assistantBytesType = reflect.TypeFor[[]byte]()

func assistantMethod(op AssistantOperation) (reflect.Method, error) {
	m, ok := reflect.TypeFor[*Service]().MethodByName(op.Method)
	if !ok {
		return m, fmt.Errorf("unregistered service method %s", op.Method)
	}
	return m, nil
}
func assistantAdminParameter(name string, t reflect.Type) bool {
	return t.Kind() == reflect.Bool && (name == "admin" || name == "adminScope")
}
func assistantOperationSchema(op AssistantOperation) (*jsonschema.Schema, error) {
	m, err := assistantMethod(op)
	if err != nil {
		return nil, err
	}
	root := &jsonschema.Schema{Type: "object", Properties: map[string]*jsonschema.Schema{}, AdditionalProperties: &jsonschema.Schema{Not: &jsonschema.Schema{}}}
	index := 0
	for i := 1; i < m.Type.NumIn(); i++ {
		t := m.Type.In(i)
		if t == assistantContextType || t == assistantUserType {
			continue
		}
		if index >= len(op.Parameters) {
			return nil, fmt.Errorf("catalog signature mismatch: %s", op.Method)
		}
		name := op.Parameters[index]
		index++
		if assistantAdminParameter(name, t) {
			continue
		}
		var schema *jsonschema.Schema
		if t == assistantFileType || t == assistantBytesType {
			schema = &jsonschema.Schema{Type: "string", Description: "已上传附件的 ID（/api/admin-assistant/attachments），不可使用文件路径或 URL。"}
		} else {
			schema, err = jsonschema.ForType(t, nil)
			if err != nil {
				return nil, fmt.Errorf("%s.%s: %w", op.Method, name, err)
			}
			assistantOptionalFields(schema)
		}
		root.Properties[name] = schema
		if t.Kind() != reflect.Struct && t.Kind() != reflect.Pointer && t.Kind() != reflect.Slice && t.Kind() != reflect.Map {
			root.Required = append(root.Required, name)
		}
	}
	if index != len(op.Parameters) {
		return nil, fmt.Errorf("catalog parameter mismatch: %s", op.Method)
	}
	return root, nil
}

// Service request types often use zero values as defaults or partial updates.
// Preserve that contract; semantic required fields remain validated in service.
func assistantOptionalFields(s *jsonschema.Schema) {
	if s == nil {
		return
	}
	s.Required = nil
	for _, p := range s.Properties {
		assistantOptionalFields(p)
	}
	assistantOptionalFields(s.Items)
	assistantOptionalFields(s.AdditionalProperties)
	for _, p := range s.Defs {
		assistantOptionalFields(p)
	}
	for _, p := range s.AnyOf {
		assistantOptionalFields(p)
	}
}

type AssistantExecuteRequest struct {
	Operation      string          `json:"operation"`
	Arguments      json.RawMessage `json:"arguments"`
	IdempotencyKey string          `json:"idempotencyKey,omitempty"`
}
type AssistantExecution struct {
	ID              string `json:"id,omitempty"`
	Status          string `json:"status"`
	ConfirmationURL string `json:"confirmationUrl,omitempty"`
	Result          any    `json:"result,omitempty"`
	Error           any    `json:"error,omitempty"`
}

func (s *Service) ExecuteAssistantOperation(ctx context.Context, p *AssistantPrincipal, req AssistantExecuteRequest, source string) (*AssistantExecution, error) {
	p, err := s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	op, err := assistantOperation(req.Operation)
	if err != nil {
		return nil, err
	}
	if !p.allows(op) {
		return nil, Forbidden("Token 未授予此操作权限")
	}
	if len(req.Arguments) == 0 {
		req.Arguments = json.RawMessage(`{}`)
	}
	if len(req.Arguments) > 1<<20 {
		return nil, BadAuthRequest("参数超过 1 MiB")
	}
	var args map[string]any
	if json.Unmarshal(req.Arguments, &args) != nil || args == nil {
		return nil, BadAuthRequest("arguments 必须为 JSON 对象")
	}
	schema, err := assistantOperationSchema(op)
	if err != nil {
		return nil, err
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return nil, err
	}
	if err = resolved.Validate(args); err != nil {
		return nil, BadAuthRequest("参数不符合操作 Schema，请先调用 describe")
	}
	// Keep full integer precision in the confirmation fingerprint and preview.
	// The schema validator's float64 values must never bind different int64 inputs.
	var canonicalArgs map[string]any
	decoder := json.NewDecoder(bytes.NewReader(req.Arguments))
	decoder.UseNumber()
	if err = decoder.Decode(&canonicalArgs); err != nil {
		return nil, BadAuthRequest("arguments 必须为 JSON 对象")
	}
	argumentsHash := assistantHash(op.Method + "\n" + assistantJSON(canonicalArgs))
	if op.Write && (len(req.IdempotencyKey) < 8 || len(req.IdempotencyKey) > 160) {
		return nil, BadAuthRequest("写操作必须提供 8–160 字节 idempotencyKey")
	}
	key := req.IdempotencyKey
	if !op.Write {
		key = newID()
	}
	now := time.Now()
	status := "ready"
	if op.HighRisk && p.Credential.ApprovalMode != AssistantFullAccess {
		status = "pending"
	}
	preview := assistantRedact(canonicalArgs)
	// 支付插件可自行声明密钥字段名，配置字典整体隐藏，避免新增插件绕过脱敏。
	if op.Method == "UpdatePaymentProviderConfig" {
		if req, ok := preview.(map[string]any)["request"].(map[string]any); ok {
			if _, exists := req["values"]; exists {
				req["values"] = "[redacted]"
			}
		}
	}
	row := &model.AssistantInvocation{ID: newID(), UserID: p.User.ID, CredentialID: p.bindingID(), IdempotencyKey: key, Operation: op.Method, ArgumentsHash: argumentsHash, PreviewJSON: assistantJSON(preview), Status: status, Source: source, CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute)}
	if err = s.repo.ReserveAssistantInvocation(row); err != nil {
		return nil, err
	}
	row, err = s.repo.AssistantInvocation(p.bindingID(), key)
	if err != nil {
		return nil, err
	}
	if row.Operation != op.Method || row.ArgumentsHash != argumentsHash {
		return nil, NewAppError(409, "幂等键已绑定其他操作或参数")
	}
	if row.Status == "succeeded" || row.Status == "failed" || row.Status == "unknown" {
		var prior AssistantExecution
		decoder := json.NewDecoder(strings.NewReader(row.ResultJSON))
		decoder.UseNumber()
		if err = decoder.Decode(&prior); err != nil {
			return nil, NewAppError(409, "执行结果待核实")
		}
		return &prior, nil
	}
	if row.Status == "running" {
		return &AssistantExecution{ID: row.ID, Status: "unknown"}, nil
	}
	if !row.ExpiresAt.After(time.Now()) {
		return &AssistantExecution{ID: row.ID, Status: "expired"}, nil
	}
	// 历史 pending 可沿用原键；降级后的 ready 必须重新进入审批，不能靠旧状态绕过。
	if op.HighRisk && row.Status == "ready" && p.Credential.ApprovalMode != AssistantFullAccess {
		if err = s.repo.TransitionAssistantInvocation(row.ID, "ready", "pending", time.Now()); err != nil {
			return nil, err
		}
		row.Status = "pending"
	}
	if row.Status == "pending" && p.Credential.ApprovalMode == AssistantFullAccess {
		if err = s.repo.TransitionAssistantInvocation(row.ID, "pending", "ready", time.Now()); err != nil {
			return nil, err
		}
		row.Status = "ready"
	}
	if row.Status == "pending" {
		base, _ := AssistantBaseURL()
		return &AssistantExecution{ID: row.ID, Status: "pending_confirmation", ConfirmationURL: base + "/admin/agent-access?confirmation=" + row.ID}, nil
	}
	if row.Status == "rejected" {
		return &AssistantExecution{ID: row.ID, Status: "rejected"}, nil
	}
	if row.Status != "ready" && row.Status != "approved" {
		return nil, NewAppError(409, "执行状态待核实")
	}
	values, cleanup, err := s.assistantArguments(ctx, p, op, req.Arguments)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	// Recheck after preparing arguments, before claiming a side effect.
	p, err = s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	needsApproval := false
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		credential, e := tx.LockAssistantAuthorization(p.Credential.ID, p.Credential.GrantID)
		if e != nil {
			return Unauthorized("原授权已失效")
		}
		p.Credential, p.Scopes = credential, assistantScopes(credential.ScopesJSON)
		if !p.allows(op) {
			return Forbidden("Token 未授予此操作权限")
		}
		if op.HighRisk && row.Status == "ready" && credential.ApprovalMode != AssistantFullAccess {
			needsApproval = true
			return tx.TransitionAssistantInvocation(row.ID, "ready", "pending", time.Now())
		}
		return tx.TransitionAssistantInvocation(row.ID, row.Status, "running", time.Now())
	})
	if err != nil {
		if errors.Is(err, repository.ErrAssistantConflict) {
			return nil, NewAppError(409, "操作已由其他请求接管，请查询原调用")
		}
		return nil, err
	}
	if needsApproval {
		base, _ := AssistantBaseURL()
		return &AssistantExecution{ID: row.ID, Status: "pending_confirmation", ConfirmationURL: base + "/admin/agent-access?confirmation=" + row.ID}, nil
	}
	start := time.Now()
	result, callErr := s.assistantInvoke(p, op, values)
	out := &AssistantExecution{ID: row.ID, Status: "succeeded", Result: result}
	if callErr != nil {
		out.Status = "failed"
		var appErr *kernel.AppError
		if errors.Is(callErr, errAssistantUncertain) || (op.Write && (!errors.As(callErr, &appErr) || appErr.Status >= 500)) {
			out.Status = "unknown"
		}
		out.Error = assistantPublicError(callErr)
		out.Result = nil
	}
	encoded := assistantJSON(out)
	if len(encoded) > 2<<20 {
		out.Result = nil
		out.Error = map[string]any{"code": 413, "message": "结果超过 2 MiB，请缩小查询范围"}
		out.Status = "failed"
		if op.Write {
			out.Status = "unknown"
		}
		encoded = assistantJSON(out)
	}
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if e := tx.FinishAssistantInvocation(row.ID, out.Status, encoded, time.Since(start).Milliseconds(), time.Now()); e != nil {
			return e
		}
		event, e := newAdminAuditEvent(p.User, "assistant.operation", "assistant_invocation", row.ID, op.Method, map[string]any{"operation": op.Method, "credentialId": p.bindingID(), "source": source, "status": out.Status, "durationMs": time.Since(start).Milliseconds(), "argumentsHash": row.ArgumentsHash})
		if e != nil {
			return e
		}
		return tx.AppendAdminAudit(event)
	})
	if err != nil {
		return &AssistantExecution{ID: row.ID, Status: "unknown"}, nil
	}
	return out, nil
}
func assistantPublicError(err error) any {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr.Status < 500 {
		return map[string]any{"code": appErr.Status, "reason": appErr.Reason, "message": assistantRedact(appErr.Message)}
	}
	return map[string]any{"code": 500, "message": "操作失败，请使用调用 ID 在后台核实"}
}
func assistantRedact(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, v := range x {
			lower := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(k))
			sensitive := strings.HasSuffix(lower, "ciphertext")
			switch lower {
			case "secret", "password", "passwordhash", "token", "tokenhash", "key", "apikey", "accesskey", "accesskeyid", "accesskeysecret", "secretkey", "accesstoken", "refreshtoken", "sessiontoken", "appsecret", "verificationtoken", "encryptkey", "tldrawlicensekey", "authorization", "cookie", "cookies", "header", "headers", "headersjson", "credential", "credentials", "clientsecret", "smtpcode":
				sensitive = true
			}
			if sensitive {
				out[k] = "[redacted]"
			} else {
				out[k] = assistantRedact(v)
			}
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, v := range x {
			out[i] = assistantRedact(v)
		}
		return out
	case string:
		if strings.HasPrefix(strings.TrimSpace(x), "{") || strings.HasPrefix(strings.TrimSpace(x), "[") {
			var nested any
			if json.Unmarshal([]byte(x), &nested) == nil {
				return assistantJSON(assistantRedact(nested))
			}
		}
		if strings.Contains(x, "://") {
			if strings.ContainsAny(x, "?@#") {
				return "[redacted URL]"
			}
		}
		return assistantBearerPattern.ReplaceAllString(x, "Bearer [redacted]")
	default:
		return v
	}
}

var assistantBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`)

func (s *Service) AssistantCalls(actor *model.User, page int) ([]model.AssistantInvocation, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		return nil, BadAuthRequest("页码过大")
	}
	return s.repo.AssistantInvocations(u.ID, page)
}
func (s *Service) AssistantCall(actor *model.User, id string) (*model.AssistantInvocation, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return nil, err
	}
	return s.repo.AssistantInvocationByID(u.ID, id)
}
func (s *Service) ConfirmAssistantCall(actor *model.User, id string, approve bool) error {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return err
	}
	row, err := s.repo.AssistantInvocationByID(u.ID, id)
	if err != nil {
		return err
	}
	op, err := assistantOperation(row.Operation)
	if err != nil {
		return err
	}
	if !op.HighRisk {
		return BadAuthRequest("此操作无需确认")
	}
	if grant, e := s.repo.AssistantGrant(row.CredentialID); e == nil {
		if grant.UserID != u.ID || grant.RevokedAt != nil || !grant.ExpiresAt.After(time.Now()) {
			return Forbidden("原授权已失效")
		}
		principal := &AssistantPrincipal{Credential: &model.AssistantCredential{ApprovalMode: grant.ApprovalMode}, Scopes: assistantScopes(grant.ScopesJSON)}
		if !principal.allows(op) {
			return Forbidden("原授权不允许此操作")
		}
	} else {
		credential, e := s.repo.AssistantCredentialByID(row.CredentialID)
		if e != nil || credential.UserID != u.ID || credential.RevokedAt != nil || !credential.ExpiresAt.After(time.Now()) {
			return Forbidden("原 Token 已失效")
		}
		principal := &AssistantPrincipal{Credential: credential, Scopes: assistantScopes(credential.ScopesJSON)}
		if !principal.allows(op) {
			return Forbidden("原 Token 不允许此操作")
		}
	}
	// Confirmation never executes, creates credentials, or changes arguments.
	if row.Status != "pending" || !row.ExpiresAt.After(time.Now()) {
		return NewAppError(409, "确认已处理或过期")
	}
	status := "rejected"
	if approve {
		status = "approved"
	}
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if e := tx.TransitionAssistantInvocation(id, "pending", status, time.Now()); e != nil {
			return e
		}
		event, e := newAdminAuditEvent(u, "assistant.confirm."+status, "assistant_invocation", id, row.Operation, map[string]any{"argumentsHash": row.ArgumentsHash})
		if e != nil {
			return e
		}
		return tx.AppendAdminAudit(event)
	})
}

func (s *Service) assistantArguments(ctx context.Context, p *AssistantPrincipal, op AssistantOperation, raw json.RawMessage) ([]reflect.Value, func(), error) {
	var args map[string]json.RawMessage
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, func() {}, err
	}
	m, err := assistantMethod(op)
	if err != nil {
		return nil, func() {}, err
	}
	values := []reflect.Value{reflect.ValueOf(s)}
	forms := []*multipart.Form{}
	cleanup := func() {
		for _, f := range forms {
			_ = f.RemoveAll()
		}
	}
	index := 0
	for i := 1; i < m.Type.NumIn(); i++ {
		t := m.Type.In(i)
		if t == assistantContextType {
			values = append(values, reflect.ValueOf(ctx))
			continue
		}
		if t == assistantUserType {
			values = append(values, reflect.ValueOf(p.User))
			continue
		}
		name := op.Parameters[index]
		index++
		if assistantAdminParameter(name, t) {
			values = append(values, reflect.ValueOf(true))
			continue
		}
		b := args[name]
		if len(b) == 0 {
			values = append(values, reflect.Zero(t))
			continue
		}
		if t == assistantFileType || t == assistantBytesType {
			var id string
			if json.Unmarshal(b, &id) != nil {
				cleanup()
				return nil, func() {}, BadAuthRequest("文件参数必须是附件 ID")
			}
			attachment, e := s.repo.AssistantAttachment(p.bindingID(), id)
			if e != nil {
				cleanup()
				return nil, func() {}, NotFound("附件不存在、过期或不属于此凭据")
			}
			if t == assistantBytesType {
				values = append(values, reflect.ValueOf(attachment.Data))
				continue
			}
			var buf bytes.Buffer
			w := multipart.NewWriter(&buf)
			part, e := w.CreateFormFile("file", attachment.Name)
			if e != nil {
				cleanup()
				return nil, func() {}, e
			}
			_, e = part.Write(attachment.Data)
			if e != nil {
				cleanup()
				return nil, func() {}, e
			}
			_ = w.Close()
			form, e := multipart.NewReader(&buf, w.Boundary()).ReadForm(AssistantAttachmentLimit + 1<<20)
			if e != nil {
				cleanup()
				return nil, func() {}, e
			}
			forms = append(forms, form)
			values = append(values, reflect.ValueOf(form.File["file"][0]))
			continue
		}
		v := reflect.New(t)
		decoder := json.NewDecoder(bytes.NewReader(b))
		decoder.DisallowUnknownFields()
		if e := decoder.Decode(v.Interface()); e != nil {
			cleanup()
			return nil, func() {}, BadAuthRequest("参数类型无效：" + name)
		}
		values = append(values, v.Elem())
	}
	return values, cleanup, nil
}

var errAssistantUncertain = errors.New("assistant execution interrupted; verify result")

func (s *Service) assistantInvoke(p *AssistantPrincipal, op AssistantOperation, values []reflect.Value) (result any, err error) {
	defer func() {
		if recover() != nil {
			result = nil
			err = errAssistantUncertain
		}
	}()
	m, e := assistantMethod(op)
	if e != nil {
		return nil, e
	}
	var output []reflect.Value
	if m.Type.IsVariadic() {
		output = m.Func.CallSlice(values)
	} else {
		output = m.Func.Call(values)
	}
	if len(output) > 0 && output[len(output)-1].Type().Implements(reflect.TypeFor[error]()) {
		last := output[len(output)-1]
		output = output[:len(output)-1]
		if !last.IsNil() {
			return nil, last.Interface().(error)
		}
	}
	items := []any{}
	for _, v := range output {
		value := v.Interface()
		switch x := value.(type) {
		case []byte:
			name := op.Method + ".bin"
			media := "application/octet-stream"
			if strings.HasSuffix(op.Method, "CSV") {
				name = op.Method + ".csv"
				media = "text/csv"
			}
			if len(output) >= 3 && output[1].Kind() == reflect.String && output[2].Kind() == reflect.String {
				media = output[1].String()
				name = output[2].String()
			} else if len(output) == 2 && output[1].Kind() == reflect.String {
				name = output[1].String()
			}
			attachment, e := s.StoreAssistantAttachment(p, name, media, x)
			if e != nil {
				return nil, e
			}
			value = attachment
		case *ResourceStream:
			if x != nil && x.Body != nil {
				defer x.Body.Close()
				data, e := io.ReadAll(io.LimitReader(x.Body, AssistantAttachmentLimit+1))
				if e != nil {
					return nil, e
				}
				attachment, e := s.StoreAssistantAttachment(p, filepath.Base(x.Resource.ObjectKey), x.Resource.MimeType, data)
				if e != nil {
					return nil, e
				}
				value = attachment
			}
		case *ResourceDelivery:
			if x != nil {
				stream := x.Stream
				if stream == nil && x.Resource != nil {
					var e error
					stream, e = s.OpenResourceRangeAsAdmin(p.User, x.Resource.ID, "")
					if e != nil {
						return nil, e
					}
				}
				if stream == nil || stream.Body == nil {
					return nil, NotFound("资源文件不可用")
				}
				defer stream.Body.Close()
				data, e := io.ReadAll(io.LimitReader(stream.Body, AssistantAttachmentLimit+1))
				if e != nil {
					return nil, e
				}
				attachment, e := s.StoreAssistantAttachment(p, filepath.Base(stream.Resource.ObjectKey), stream.Resource.MimeType, data)
				if e != nil {
					return nil, e
				}
				value = attachment
			}
		}
		items = append(items, value)
	}
	var value any = map[string]any{"ok": true}
	if len(items) == 1 {
		value = items[0]
	} else if len(items) > 1 {
		multi := map[string]any{}
		for i, v := range items {
			multi[fmt.Sprintf("result%d", i)] = v
		}
		value = multi
	}
	// Never persist unmasked settings, headers or auth material in receipts.
	data, e := json.Marshal(value)
	if e != nil {
		return nil, e
	}
	var safe any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if e = decoder.Decode(&safe); e != nil {
		return nil, e
	}
	return assistantRedact(safe), nil
}

const AssistantAttachmentLimit = 32 << 20

func (s *Service) StoreAssistantAttachment(p *AssistantPrincipal, name, media string, data []byte) (*model.AssistantAttachment, error) {
	p, err := s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > AssistantAttachmentLimit {
		return nil, BadAuthRequest("附件大小应为 1 字节至 32 MiB")
	}
	if err = s.repo.CleanupAssistantAttachments(time.Now()); err != nil {
		return nil, err
	}
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.ReplaceAll(strings.ReplaceAll(name, "\r", ""), "\n", "")
	if len(name) > 240 {
		name = name[:240]
	}
	if name == "" || name == "." {
		name = "attachment.bin"
	}
	if len(media) > 160 || strings.ContainsAny(media, "\r\n") {
		media = "application/octet-stream"
	}
	now := time.Now()
	row := &model.AssistantAttachment{ID: newID(), CredentialID: p.bindingID(), Name: name, MediaType: media, Size: int64(len(data)), Data: data, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	if err = s.repo.CreateAssistantAttachmentWithinLimit(row, p.Credential.GrantID != "", 128<<20); err != nil {
		if errors.Is(err, repository.ErrAssistantAttachmentQuota) {
			return nil, RateLimited("附件总量超过 128 MiB，请等待过期")
		}
		return nil, err
	}
	return row, nil
}
func (s *Service) ReadAssistantAttachment(p *AssistantPrincipal, id string) (*model.AssistantAttachment, error) {
	p, err := s.refreshAssistantPrincipal(p)
	if err != nil {
		return nil, err
	}
	row, err := s.repo.AssistantAttachment(p.bindingID(), id)
	if err != nil {
		return nil, NotFound("附件不存在或已过期")
	}
	return row, nil
}
