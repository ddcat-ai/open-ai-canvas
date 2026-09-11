package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type CreationGuard struct {
	ExecutionEpoch int64  `json:"executionEpoch"`
	Owner          string `json:"owner"`
}
type CreationRequest struct {
	CreationGuard
	ClientKey            string             `json:"clientKey"`
	CanvasID             string             `json:"canvasId"`
	Revision             int64              `json:"revision"`
	ExpectedEpoch        int64              `json:"expectedEpoch"`
	State                map[string]any     `json:"state"`
	Status               string             `json:"status"`
	ProposalVersion      int64              `json:"proposalVersion"`
	Proposal             json.RawMessage    `json:"proposal"`
	Ops                  []CreationCanvasOp `json:"ops"`
	ItemKey              string             `json:"itemKey"`
	Request              CreateTaskRequest  `json:"request"`
	SubmissionIDs        []string           `json:"submissionIds"`
	SubmissionID         string             `json:"submissionId"`
	ExpectedSnapshotHash string             `json:"expectedSnapshotHash"`
	Document             json.RawMessage    `json:"document"`
}
type CreationRunOutput struct {
	model.CreationRun
	State map[string]any `json:"state"`
}
type CreationQuote struct {
	Model              string         `json:"model"`
	BillingMode        string         `json:"billingMode"`
	Quantity           int64          `json:"quantity"`
	AmountMicrocredits int64          `json:"amountMicrocredits"`
	Estimated          bool           `json:"estimated"`
	ExpiresAt          time.Time      `json:"expiresAt"`
	QuoteHash          string         `json:"quoteHash"`
	Options            map[string]any `json:"options,omitempty"`
}
type CreationSubmissionOutput struct {
	model.CreationSubmission
	Quote CreationQuote `json:"quote"`
}
type CreationDetail struct {
	Run         CreationRunOutput          `json:"run"`
	Submissions []CreationSubmissionOutput `json:"submissions"`
}
type creationTaskPreparation struct{ Order *model.BillingOrder }

func creationConflict(message string) error {
	return &AppError{Status: 409, Code: 409, Message: message}
}
func creationError(err error) error {
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return BadAuthRequest("积分不足，请充值后重试")
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return BadAuthRequest("同时排队或运行的任务已达到上限")
	}
	if errors.Is(err, repository.ErrLogicalModelUnavailable) {
		return creationConflict("模型已更新或停用，请重新准备报价")
	}
	if errors.Is(err, repository.ErrCreationConflict) {
		return creationConflict("创作状态已变化，请重新读取后继续")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &AppError{Status: 404, Code: 404, Message: "创作记录不存在或无权访问"}
	}
	return err
}
func creationHash(value any) string {
	b, _ := json.Marshal(value)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func creationRunOutput(run model.CreationRun) CreationRunOutput {
	state := map[string]any{}
	_ = json.Unmarshal([]byte(run.StateJSON), &state)
	return CreationRunOutput{run, state}
}
func creationSubmissionOutput(item model.CreationSubmission) CreationSubmissionOutput {
	var quote CreationQuote
	_ = json.Unmarshal([]byte(item.QuoteJSON), &quote)
	return CreationSubmissionOutput{item, quote}
}
func validateCreationGuard(run *model.CreationRun, guard CreationGuard) error {
	if guard.Owner == "" || run.ExecutionOwner != guard.Owner || run.ExecutionEpoch != guard.ExecutionEpoch || run.LeaseExpiresAt == nil || !run.LeaseExpiresAt.After(time.Now()) {
		return creationConflict("执行控制权已过期，请在当前页面重新接管")
	}
	return nil
}
func validateCreationJSON(value any) error {
	b, err := json.Marshal(value)
	if err != nil || len(b) > 1<<20 {
		return BadAuthRequest("创作内容超过限制或格式无效")
	}
	var decoded any
	_ = json.Unmarshal(b, &decoded)
	var visit func(any) bool
	visit = func(v any) bool {
		switch item := v.(type) {
		case map[string]any:
			for key, child := range item {
				switch strings.ToLower(key) {
				case "apikey", "secretkey", "authorization", "cookie", "headers", "baseurl", "token", "accesstoken", "refresh_token":
					if child != nil && child != "" {
						return false
					}
				}
				if !visit(child) {
					return false
				}
			}
		case []any:
			for _, child := range item {
				if !visit(child) {
					return false
				}
			}
		case string:
			if strings.HasPrefix(item, "data:") || strings.Contains(item, "X-Amz-Signature=") || strings.Contains(item, "X-Tos-Signature=") {
				return false
			}
		}
		return true
	}
	if !visit(decoded) {
		return BadAuthRequest("创作记录不能包含密钥、内嵌媒体或临时签名链接")
	}
	return nil
}
func (s *Service) CreateCreationRun(userID string, req CreationRequest) (*CreationDetail, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(req.ClientKey) == "" || len(req.ClientKey) > 120 {
		return nil, BadAuthRequest("缺少稳定会话键")
	}
	if err := validateCreationJSON(req.State); err != nil {
		return nil, err
	}
	if req.CanvasID != "" {
		if _, err := s.repo.CanvasProjectForUser(userID, req.CanvasID); err != nil {
			return nil, creationError(err)
		}
	}
	b, _ := json.Marshal(req.State)
	run := model.CreationRun{ID: newID(), UserID: userID, ClientKey: req.ClientKey, CreateHash: creationHash([]any{req.CanvasID, req.State}), CanvasID: req.CanvasID, Revision: 1, Status: "idle", StateJSON: string(b)}
	if old, e := s.repo.CreationRunByClientKey(userID, req.ClientKey); e == nil {
		if old.CreateHash != run.CreateHash {
			return nil, creationConflict("同一会话键的内容不同")
		}
		return s.GetCreationRun(userID, old.ID)
	} else if !errors.Is(e, gorm.ErrRecordNotFound) {
		return nil, e
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := s.validateCreationStorage(s.repo, userID, true, int64(len(b))); err != nil {
		return nil, err
	}
	if err := s.repo.CreateCreationRun(&run); err != nil {
		return nil, creationError(err)
	}
	return s.GetCreationRun(userID, run.ID)
}
func (s *Service) GetCreationRun(userID, id string) (*CreationDetail, error) {
	run, err := s.repo.CreationRun(userID, id)
	if err != nil {
		return nil, creationError(err)
	}
	items, err := s.repo.CreationSubmissions(userID, id)
	if err != nil {
		return nil, err
	}
	out := &CreationDetail{Run: creationRunOutput(*run), Submissions: []CreationSubmissionOutput{}}
	for _, item := range items {
		out.Submissions = append(out.Submissions, creationSubmissionOutput(item))
	}
	return out, nil
}
func (s *Service) ListCreationRuns(userID string) (map[string]any, error) {
	items, err := s.repo.CreationRuns(userID)
	out := []CreationRunOutput{}
	for _, run := range items {
		out = append(out, creationRunOutput(run))
	}
	return map[string]any{"runs": out}, err
}
func (s *Service) ChangeCreationRun(userID, id, action string, req CreationRequest) (any, error) {
	if action == "save" || action == "proposal-approve" || action == "proposal-invalidate" {
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
	}
	var out any
	err := s.repo.MutateCreationRun(userID, id, func(run *model.CreationRun, repo *repository.Repository) error {
		previousBytes := len(run.StateJSON) + len(run.ApprovedOperationsJSON) + len(run.ApprovedCanvasJSON)
		now := time.Now()
		if action == "claim" {
			if req.Owner == "" || len(req.Owner) > 120 || req.ExpectedEpoch != run.ExecutionEpoch {
				return creationConflict("执行代次已变化")
			}
			run.ExecutionEpoch++
			run.ExecutionOwner = req.Owner
			until := now.Add(45 * time.Second)
			run.LeaseExpiresAt = &until
		} else {
			if err := validateCreationGuard(run, req.CreationGuard); err != nil {
				return err
			}
			switch action {
			case "heartbeat":
				until := now.Add(45 * time.Second)
				run.LeaseExpiresAt = &until
				out = map[string]any{"leaseExpiresAt": until}
				return nil
			case "release":
				run.LeaseExpiresAt = nil
				out = map[string]any{"released": true}
				return nil
			case "save":
				if req.Revision != run.Revision {
					return repository.ErrCreationConflict
				}
				if err := validateCreationJSON(req.State); err != nil {
					return err
				}
				if !strings.Contains("|idle|running|waiting_answer|waiting_proposal|waiting_canvas|waiting_payment|waiting_task|paused|completed|cancelled|", "|"+req.Status+"|") || req.Status == "" {
					return BadAuthRequest("创作状态无效")
				}
				if run.Status == "cancelled" && req.Status != "cancelled" {
					return creationConflict("已取消会话不能继续执行")
				}
				b, _ := json.Marshal(req.State)
				run.StateJSON = string(b)
				run.Status = req.Status
			case "proposal-approve":
				if req.Revision != run.Revision || req.ProposalVersion <= 0 {
					return repository.ErrCreationConflict
				}
				if err := validateCreationOps(req.Ops); err != nil {
					return err
				}
				if err := validateCreationJSON(req.Proposal); err != nil {
					return err
				}
				for _, op := range req.Ops {
					if key := stringValue(op.Metadata["storageKey"]); key != "" {
						if !strings.HasPrefix(key, "resource:") {
							return BadAuthRequest("已有素材必须来自当前账号资源库")
						}
						resource, e := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
						if e != nil {
							return e
						}
						if resource.Status != model.ResourceStatusReady {
							return BadAuthRequest("已有素材尚未就绪")
						}
					}
				}
				hash := creationHash([]any{req.Proposal, req.Ops})
				if req.ProposalVersion <= run.ApprovedProposalVersion {
					if req.ProposalVersion == run.ApprovedProposalVersion && hash == run.ApprovedProposalHash {
						out = creationRunOutput(*run)
						return nil
					}
					return repository.ErrCreationConflict
				}
				if err := repo.RevokeCreationSubmissions(id); err != nil {
					return err
				}
				b, _ := json.Marshal(req.Ops)
				run.ApprovedOperationsJSON = string(b)
				run.ApprovedProposalVersion = req.ProposalVersion
				run.ApprovedProposalHash = hash
				run.ApprovedAt = &now
				run.ApprovedCanvasJSON = ""
				if run.CanvasID != "" {
					canvas, e := repo.CanvasProjectForUser(userID, run.CanvasID)
					if e != nil {
						return e
					}
					baseline, e := creationApprovalBaseline(canvas.PayloadJSON, req.Ops)
					if e != nil {
						return e
					}
					run.ApprovedCanvasJSON = baseline
				}
			case "proposal-invalidate":
				if req.Revision != run.Revision {
					return repository.ErrCreationConflict
				}
				if err := repo.RevokeCreationSubmissions(id); err != nil {
					return err
				}
				run.ApprovedAt = nil
				run.ApprovedProposalHash = ""
				run.ApprovedOperationsJSON = ""
				run.ApprovedCanvasJSON = ""
			default:
				return BadAuthRequest("未知创作操作")
			}
		}
		run.Revision++
		if action == "save" || action == "proposal-approve" {
			delta := int64(len(run.StateJSON) + len(run.ApprovedOperationsJSON) + len(run.ApprovedCanvasJSON) - previousBytes)
			if e := s.validateCreationStorage(repo, userID, false, delta); e != nil {
				return e
			}
		}
		out = creationRunOutput(*run)
		return nil
	})
	return out, creationError(err)
}

func (s *Service) prepareCreationTask(userID string, req CreateTaskRequest) (*model.Task, *model.BillingOrder, string, error) {
	config, _ := req.Input["config"].(map[string]any)
	if req.LogicalModelID == "" && strings.TrimSpace(stringValue(config["channelId"])) == "" {
		return nil, nil, "", BadAuthRequest("智能创作目前仅支持后端受管模型，请在原入口使用其他渠道")
	}
	if taskInputUsesWorkflowProvider(req.Input) || isTextReplayTaskRequest(req.Input) {
		return nil, nil, "", BadAuthRequest("智能创作不支持本机、工作流或文本回放任务")
	}
	// System selectors are the only authority; discard frontend sentinel credentials.
	safeConfig := map[string]any{}
	for _, key := range []string{"channelId", "channelModelKey", "model", "priceTierId", "apiFormat", "interfaceType", "size", "quality", "transparentBackground", "count", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark", "videoArkPrivateAssetUpload", "systemPrompt"} {
		if value, ok := config[key]; ok {
			safeConfig[key] = value
		}
	}
	config = safeConfig
	req.Input["config"] = safeConfig
	if err := validateCreationJSON(req); err != nil {
		return nil, nil, "", err
	}
	if req.Type != "canvas_text" && req.Type != "text" && req.Type != "agent_storyboard_rows" && req.Type != "canvas_image" && req.Type != "canvas_video" {
		return nil, nil, "", BadAuthRequest("智能创作任务类型不受支持")
	}
	expectedMode := map[string]string{"text": "text", "canvas_text": "text", "agent_storyboard_rows": "text", "canvas_image": "image", "canvas_video": "video"}[req.Type]
	if stringValue(req.Input["mode"]) != expectedMode || strings.TrimSpace(stringValue(req.Input["prompt"])) != strings.TrimSpace(req.Prompt) {
		return nil, nil, "", BadAuthRequest("任务类型、模式和实际提示词必须一致")
	}
	if req.SessionID != "" {
		return nil, nil, "", BadAuthRequest("智能创作不能写入旧会话")
	}
	if expectedMode != "text" && req.Input["agentRequests"] != nil {
		return nil, nil, "", BadAuthRequest("媒体任务不允许携带独立模型协议请求")
	}
	if count := stringValue(config["count"]); count != "" && count != "1" {
		return nil, nil, "", BadAuthRequest("每个获批执行项只能生成一个产物")
	}
	if req.Input["mask"] != nil {
		return nil, nil, "", BadAuthRequest("本期智能创作暂不支持蒙版任务")
	}
	if expectedMode != "text" {
		canvas, e := s.repo.CanvasProjectForUser(userID, req.ProjectID)
		if e != nil {
			return nil, nil, "", creationError(e)
		}
		doc, e := creationDocument(canvas.PayloadJSON)
		if e != nil {
			return nil, nil, "", e
		}
		nodes, e := creationObjects(doc["nodes"])
		if e != nil {
			return nil, nil, "", e
		}
		if refs, ok := req.Input["referenceImages"].([]any); ok {
			for _, raw := range refs {
				ref, _ := raw.(map[string]any)
				node := nodes[stringValue(ref["id"])]
				meta, _ := node["metadata"].(map[string]any)
				if node == nil || node["type"] != "image" || meta["status"] != "success" || stringValue(ref["storageKey"]) != stringValue(meta["storageKey"]) {
					return nil, nil, "", creationConflict("参考素材已变化或尚未就绪")
				}
			}
		}
	}
	for _, name := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		if list, ok := req.Input[name].([]any); ok {
			for _, raw := range list {
				media, ok := raw.(map[string]any)
				if !ok {
					return nil, nil, "", BadAuthRequest("素材引用格式无效")
				}
				key := stringValue(media["storageKey"])
				if !strings.HasPrefix(key, "resource:") {
					return nil, nil, "", BadAuthRequest("请先将参考素材保存到当前账号资源库")
				}
				resource, err := s.repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
				if err != nil {
					return nil, nil, "", creationError(err)
				}
				if resource.Status != "ready" {
					return nil, nil, "", BadAuthRequest("参考素材尚未就绪")
				}
				delete(media, "url")
				delete(media, "dataUrl")
				media["bytes"] = resource.Size
				media["durationMs"] = resource.DurationMs
			}
		}
	}
	prepared := &creationTaskPreparation{}
	req.creationPrepare = prepared
	task, err := s.CreateTask(userID, req)
	if err != nil {
		return nil, nil, "", err
	}
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	resolved, _ := input["config"].(map[string]any)
	for _, key := range []string{"size", "videoSeconds", "vquality", "quality", "count"} {
		if requested := stringValue(config[key]); requested != "" && !strings.EqualFold(requested, stringValue(resolved[key])) {
			return nil, nil, "", creationConflict("模型解析后的生成规格与请求不同，请调整方案后重新报价")
		}
	}
	channel, channelErr := s.repo.SystemChannel(stringValue(resolved["channelId"]))
	if channelErr != nil {
		return nil, nil, "", channelErr
	}
	if channel.AllowLocalChannel {
		return nil, nil, "", BadAuthRequest("智能创作暂不支持本机受管渠道")
	}
	if expectedMode == "text" {
		var typed canvasGenerationInput
		if err = json.Unmarshal([]byte(task.InputJSON), &typed); err != nil {
			return nil, nil, "", err
		}
		if len(typed.ReferenceImages) > 0 {
			cm, e := s.repo.ChannelModelByKey(channel.ID, stringValue(resolved["model"]))
			if e != nil {
				return nil, nil, "", e
			}
			profile, e := DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
			if e != nil || profile == nil || profile.Text == nil || profile.Text.References.MaxImages < len(typed.ReferenceImages) {
				return nil, nil, "", BadAuthRequest("当前文本模型未配置足够的图片理解能力")
			}
		}
		if err = validateAgentResourcePlaceholders(typed); err != nil {
			return nil, nil, "", err
		}
	}
	sig, err := s.repo.CreationPriceSignature(task, stringValue(resolved["channelId"]), stringValue(resolved["model"]))
	return task, prepared.Order, sig, err
}
func creationQuoteFor(task *model.Task, order *model.BillingOrder, signature string, expires time.Time) CreationQuote {
	quote := CreationQuote{Model: task.Model, BillingMode: "free", Quantity: 1, ExpiresAt: expires}
	if order != nil {
		quote.BillingMode = order.BillingMode
		quote.Quantity = order.Quantity
		quote.AmountMicrocredits = order.AmountMicrocredits
		quote.Estimated = order.BillingMode == "token"
	}
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	quote.Options = map[string]any{}
	for _, key := range []string{"size", "videoSeconds", "vquality", "quality", "maxTokens"} {
		if value, ok := config[key]; ok {
			quote.Options[key] = value
		}
	}
	quote.QuoteHash = creationHash([]any{signature, quote.BillingMode, quote.Quantity, quote.AmountMicrocredits, quote.Options})
	return quote
}
func validateCreationSubmissionScope(run *model.CreationRun, version int64, req CreateTaskRequest) error {
	if run.Status == "paused" || run.Status == "cancelled" || run.Status == "completed" {
		return creationConflict("请先恢复创作任务")
	}
	if req.Type == "canvas_text" || req.Type == "text" || req.Type == "agent_storyboard_rows" {
		if req.ProjectID != "" && req.ProjectID != run.CanvasID {
			return creationConflict("规划任务的画布关联不匹配")
		}
		return nil
	}
	if run.CanvasID == "" || req.ProjectID != run.CanvasID {
		return creationConflict("媒体任务必须提交到当前创作画布")
	}
	if run.ApprovedAt == nil || version != run.ApprovedProposalVersion || run.ApprovedProposalHash == "" {
		return creationConflict("请先确认当前方案")
	}
	var ops []CreationCanvasOp
	_ = json.Unmarshal([]byte(run.ApprovedOperationsJSON), &ops)
	nodeID := stringValue(req.Input["nodeId"])
	metadata, _ := req.Input["metadata"].(map[string]any)
	if nodeID == "" {
		nodeID = stringValue(metadata["nodeId"])
	}
	for _, op := range ops {
		if op.ID != nodeID || nodeID == "" {
			continue
		}
		if op.Type != "add_node" && op.Type != "update_node" {
			continue
		}
		meta := op.Metadata
		if nested, ok := op.Patch["metadata"].(map[string]any); ok {
			meta = mergeCreationMaps(nested, meta)
		}
		prompt := stringValue(meta["prompt"])
		if prompt == "" {
			prompt = stringValue(meta["text"])
		}
		if strings.TrimSpace(req.Prompt) != strings.TrimSpace(prompt) || prompt == "" {
			return creationConflict("任务提示词已超出获批方案")
		}
		if stringValue(meta["model"]) == "" || stringValue(meta["model"]) != req.Model {
			return creationConflict("模型与已批准方案不同")
		}
		config, _ := req.Input["config"].(map[string]any)
		for _, key := range []string{"size", "videoSeconds", "vquality", "quality"} {
			metadataKey := key
			if key == "videoSeconds" {
				metadataKey = "seconds"
			}
			if approved := stringValue(meta[metadataKey]); approved != "" && approved != stringValue(config[key]) {
				return creationConflict("生成规格与已批准方案不同")
			}
		}
		refs, _ := meta["referenceNodeIds"].([]any)
		images, _ := req.Input["referenceImages"].([]any)
		if len(refs) != len(images) {
			return creationConflict("参考素材数量与已批准方案不同")
		}
		for index, ref := range refs {
			image, _ := images[index].(map[string]any)
			if stringValue(ref) != stringValue(image["id"]) {
				return creationConflict("参考素材与已批准方案不同")
			}
		}
		for _, kind := range []string{"referenceVideos", "referenceAudios"} {
			if values, ok := req.Input[kind].([]any); ok && len(values) > 0 {
				return creationConflict("本期方案尚未授权视频或音频参考输入")
			}
		}
		return nil
	}
	return creationConflict("任务节点不在已批准方案范围内")
}
func (s *Service) PrepareCreationSubmission(userID, id string, req CreationRequest) (*CreationSubmissionOutput, error) {
	if req.ItemKey == "" || len(req.ItemKey) > 160 {
		return nil, BadAuthRequest("缺少稳定执行项键")
	}
	if strings.HasPrefix(req.ItemKey, "requote:") {
		return nil, BadAuthRequest("该执行项键由报价刷新接口保留")
	}
	run, err := s.repo.CreationRun(userID, id)
	if err != nil {
		return nil, creationError(err)
	}
	if err = validateCreationGuard(run, req.CreationGuard); err != nil {
		return nil, err
	}
	if err = validateCreationSubmissionScope(run, req.ProposalVersion, req.Request); err != nil {
		return nil, err
	}
	item, original, err := s.buildCreationSubmission(userID, run, req.ItemKey, req.ProposalVersion, req.Request)
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCreationRun(userID, id, func(current *model.CreationRun, repo *repository.Repository) error {
		if e := validateCreationGuard(current, req.CreationGuard); e != nil {
			return e
		}
		if e := validateCreationSubmissionScope(current, req.ProposalVersion, original); e != nil {
			return e
		}
		items, e := repo.CreationSubmissions(userID, id)
		if e != nil {
			return e
		}
		for _, old := range items {
			if old.ItemKey == req.ItemKey {
				if old.RequestHash != item.RequestHash || old.ProposalVersion != item.ProposalVersion {
					return repository.ErrCreationConflict
				}
				item = old
				return nil
			}
		}
		if e = s.validateCreationStorage(repo, userID, false, int64(len(item.RequestJSON)+len(item.QuoteJSON)+len(item.PriceSignature))); e != nil {
			return e
		}
		return repo.SaveCreationSubmission(&item)
	})
	if err != nil {
		return nil, creationError(err)
	}
	out := creationSubmissionOutput(item)
	return &out, nil
}

func (s *Service) buildCreationSubmission(userID string, run *model.CreationRun, itemKey string, proposalVersion int64, request CreateTaskRequest) (model.CreationSubmission, CreateTaskRequest, error) {
	// JSON normalization also isolates the immutable snapshot from mutable caller maps.
	b, err := json.Marshal(request)
	if err != nil {
		return model.CreationSubmission{}, CreateTaskRequest{}, err
	}
	var normalized CreateTaskRequest
	if err = json.Unmarshal(b, &normalized); err != nil {
		return model.CreationSubmission{}, normalized, err
	}
	task, order, signature, err := s.prepareCreationTask(userID, normalized)
	if err != nil {
		return model.CreationSubmission{}, normalized, err
	}
	expires := time.Now().Add(5 * time.Minute)
	quote := creationQuoteFor(task, order, signature, expires)
	quoteJSON, _ := json.Marshal(quote)
	requestJSON, _ := json.Marshal(normalized)
	item := model.CreationSubmission{ID: newID(), UserID: userID, RunID: run.ID, ItemKey: itemKey, ProposalVersion: proposalVersion, ProposalHash: run.ApprovedProposalHash, RequestJSON: string(requestJSON), RequestHash: creationHash(normalized), QuoteJSON: string(quoteJSON), PriceSignature: signature, ExpiresAt: expires}
	return item, normalized, nil
}

// Refresh creates an unapproved successor. The old quote and approval remain immutable.
func (s *Service) RefreshCreationSubmission(userID, id string, req CreationRequest) (*CreationSubmissionOutput, error) {
	run, err := s.repo.CreationRun(userID, id)
	if err != nil {
		return nil, creationError(err)
	}
	if err = validateCreationGuard(run, req.CreationGuard); err != nil {
		return nil, err
	}
	old, err := s.repo.CreationSubmission(userID, id, req.SubmissionID)
	if err != nil {
		return nil, creationError(err)
	}
	if old.TaskID != nil {
		return nil, creationConflict("任务已提交，请查看原任务，不需要刷新报价")
	}
	successorKey := "requote:" + old.ID
	items, err := s.repo.CreationSubmissions(userID, id)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ItemKey == successorKey {
			out := creationSubmissionOutput(item)
			return &out, nil
		}
	}
	if old.RevokedAt != nil {
		return nil, creationConflict("原方案已撤销，请重新准备生成项")
	}
	var request CreateTaskRequest
	if err = json.Unmarshal([]byte(old.RequestJSON), &request); err != nil {
		return nil, err
	}
	if err = validateCreationSubmissionScope(run, old.ProposalVersion, request); err != nil {
		return nil, err
	}
	if old.ProposalVersion > 0 && old.ProposalHash != run.ApprovedProposalHash {
		return nil, creationConflict("原方案已变化，请重新准备生成项")
	}
	item, normalized, err := s.buildCreationSubmission(userID, run, successorKey, old.ProposalVersion, request)
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCreationRun(userID, id, func(current *model.CreationRun, repo *repository.Repository) error {
		if e := validateCreationGuard(current, req.CreationGuard); e != nil {
			return e
		}
		fresh, e := repo.CreationSubmission(userID, id, old.ID)
		if e != nil {
			return e
		}
		if fresh.TaskID != nil {
			return creationConflict("任务已经提交，不能刷新报价")
		}
		all, e := repo.CreationSubmissions(userID, id)
		if e != nil {
			return e
		}
		for _, existing := range all {
			if existing.ItemKey == successorKey {
				item = existing
				return nil
			}
		}
		if fresh.RevokedAt != nil {
			return creationConflict("原报价已撤销")
		}
		if e = validateCreationSubmissionScope(current, fresh.ProposalVersion, normalized); e != nil {
			return e
		}
		if fresh.ProposalVersion > 0 && fresh.ProposalHash != current.ApprovedProposalHash {
			return repository.ErrCreationConflict
		}
		if e = s.validateCreationStorage(repo, userID, false, int64(len(item.RequestJSON)+len(item.QuoteJSON)+len(item.PriceSignature))); e != nil {
			return e
		}
		now := time.Now()
		fresh.RevokedAt = &now
		if e = repo.SaveCreationSubmission(fresh); e != nil {
			return e
		}
		return repo.SaveCreationSubmission(&item)
	})
	if err != nil {
		return nil, creationError(err)
	}
	out := creationSubmissionOutput(item)
	return &out, nil
}

func (s *Service) validateCreationStorage(repo *repository.Repository, userID string, creating bool, delta int64) error {
	usage, err := repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	count, bytes, err := repo.CreationStorageUsage(userID)
	if err != nil {
		return err
	}
	usage.SessionCount += count
	usage.SessionBytes += bytes
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	return validateStructuredStorageQuotaWithPolicy(usage, "session", creating, delta, policy.Resource)
}
func (s *Service) ApproveCreationSubmissions(userID, id string, req CreationRequest) (map[string]any, error) {
	if len(req.SubmissionIDs) == 0 || len(req.SubmissionIDs) > 20 {
		return nil, BadAuthRequest("请选择 1 到 20 项生成任务")
	}
	// Compute current prices before the write transaction; transaction checks their config signatures again.
	prepared := map[string]*model.Task{}
	signatures := map[string]string{}
	for _, sid := range req.SubmissionIDs {
		item, err := s.repo.CreationSubmission(userID, id, sid)
		if err != nil {
			return nil, creationError(err)
		}
		var request CreateTaskRequest
		_ = json.Unmarshal([]byte(item.RequestJSON), &request)
		task, order, sig, err := s.prepareCreationTask(userID, request)
		if err != nil {
			return nil, err
		}
		if creationQuoteFor(task, order, sig, item.ExpiresAt).QuoteHash != creationSubmissionOutput(*item).Quote.QuoteHash {
			return nil, creationConflict("报价已变化，请重新准备并确认")
		}
		prepared[sid] = task
		signatures[sid] = sig
	}
	out := []CreationSubmissionOutput{}
	err := s.repo.MutateCreationRun(userID, id, func(run *model.CreationRun, repo *repository.Repository) error {
		if e := validateCreationGuard(run, req.CreationGuard); e != nil {
			return e
		}
		now := time.Now()
		for _, sid := range req.SubmissionIDs {
			item, e := repo.CreationSubmission(userID, id, sid)
			if e != nil {
				return e
			}
			if item.RevokedAt != nil || !item.ExpiresAt.After(now) {
				return creationConflict("报价已过期或撤销")
			}
			var request CreateTaskRequest
			_ = json.Unmarshal([]byte(item.RequestJSON), &request)
			if e = validateCreationSubmissionScope(run, item.ProposalVersion, request); e != nil {
				return e
			}
			if item.ProposalVersion > 0 && item.ProposalHash != run.ApprovedProposalHash {
				return repository.ErrCreationConflict
			}
			if e = checkCreationPriceSignature(repo, prepared[sid], signatures[sid]); e != nil {
				return e
			}
			if item.ApprovedAt == nil {
				item.ApprovedAt = &now
				if e = repo.SaveCreationSubmission(item); e != nil {
					return e
				}
			}
			out = append(out, creationSubmissionOutput(*item))
		}
		return nil
	})
	return map[string]any{"submissions": out}, creationError(err)
}
func checkCreationPriceSignature(repo *repository.Repository, task *model.Task, want string) error {
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	got, err := repo.CreationPriceSignature(task, stringValue(config["channelId"]), stringValue(config["model"]))
	if err != nil {
		return err
	}
	if got != want {
		return creationConflict("模型或价格配置已更新，请重新确认")
	}
	return nil
}
func (s *Service) ExecuteCreationSubmission(userID, id string, req CreationRequest) (*model.Task, error) {
	run, err := s.repo.CreationRun(userID, id)
	if err != nil {
		return nil, creationError(err)
	}
	if err = validateCreationGuard(run, req.CreationGuard); err != nil {
		return nil, err
	}
	item, err := s.repo.CreationSubmission(userID, id, req.SubmissionID)
	if err != nil {
		return nil, creationError(err)
	}
	if item.TaskID != nil {
		task, e := s.repo.TaskForUser(userID, *item.TaskID)
		if e != nil {
			return nil, e
		}
		return taskForOutput(*task), nil
	}
	var request CreateTaskRequest
	if err = json.Unmarshal([]byte(item.RequestJSON), &request); err != nil {
		return nil, err
	}
	if err = validateCreationSubmissionScope(run, item.ProposalVersion, request); err != nil {
		return nil, err
	}
	task, order, signature, err := s.prepareCreationTask(userID, request)
	if err != nil {
		return nil, err
	}
	if creationQuoteFor(task, order, signature, item.ExpiresAt).QuoteHash != creationSubmissionOutput(*item).Quote.QuoteHash {
		return nil, creationConflict("报价已变化，请重新确认")
	}
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	if err = s.protectTaskSecrets(input); err != nil {
		return nil, err
	}
	b, _ := json.Marshal(input)
	task.InputJSON = string(b)
	task.CreationSubmissionID = &item.ID
	if order != nil {
		task.BillingOrderID = order.ID
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCreationRun(userID, id, func(current *model.CreationRun, repo *repository.Repository) error {
		if e := validateCreationGuard(current, req.CreationGuard); e != nil {
			return e
		}
		fresh, e := repo.CreationSubmission(userID, id, item.ID)
		if e != nil {
			return e
		}
		if fresh.TaskID != nil {
			existing, e := repo.TaskForUser(userID, *fresh.TaskID)
			if e != nil {
				return e
			}
			task = existing
			return nil
		}
		if fresh.ApprovedAt == nil || fresh.RevokedAt != nil || !fresh.ExpiresAt.After(time.Now()) {
			return creationConflict("任务尚未批准或报价已过期")
		}
		if e = validateCreationSubmissionScope(current, fresh.ProposalVersion, request); e != nil {
			return e
		}
		if fresh.ProposalVersion > 0 && fresh.ProposalHash != current.ApprovedProposalHash {
			return repository.ErrCreationConflict
		}
		if e = checkCreationPriceSignature(repo, task, signature); e != nil {
			return e
		}
		if e = createTaskWithStorageQuotaRepository(repo, task, order, policy); e != nil {
			return e
		}
		fresh.TaskID = &task.ID
		if e = repo.SaveCreationSubmission(fresh); e != nil {
			return e
		}
		return nil
	})
	if err != nil {
		return nil, creationError(err)
	}
	return taskForOutput(*task), nil
}
