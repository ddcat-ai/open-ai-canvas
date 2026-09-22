package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PublicAPIKeyView struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Prefix         string     `json:"prefix"`
	Status         string     `json:"status"`
	ModelAllowlist []string   `json:"modelAllowlist,omitempty"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
	LastUsedAt     *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt      *time.Time `json:"revokedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type PublicAPIKeyCreated struct {
	PublicAPIKeyView
	Secret string `json:"secret"`
}

type PublicAPIKeyCreateRequest struct {
	Name           string   `json:"name"`
	ModelAllowlist []string `json:"modelAllowlist"`
	ExpiresAt      string   `json:"expiresAt"`
}

type PublicGenerationInput struct {
	Model         string `json:"model"`
	Type          string `json:"type"`
	Operation     string `json:"operation"`
	Prompt        string `json:"prompt"`
	Size          string `json:"size"`
	AspectRatio   string `json:"aspect_ratio"`
	Quality       string `json:"quality"`
	Resolution    string `json:"resolution"`
	Duration      int    `json:"duration"`
	GenerateAudio *bool  `json:"generate_audio"`
	Watermark     *bool  `json:"watermark"`
}

type PublicGenerationModel struct {
	ID         string `json:"id"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Capability string `json:"capability"`
	Available  bool   `json:"available"`
}

type PublicGenerationMedia struct {
	ResourceID string `json:"resource_id"`
	URL        string `json:"url"`
	MimeType   string `json:"mime_type,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	DurationMs int64  `json:"duration_ms,omitempty"`
}

type PublicGenerationResult struct {
	Images []PublicGenerationMedia `json:"images,omitempty"`
	Videos []PublicGenerationMedia `json:"videos,omitempty"`
}

type PublicGenerationView struct {
	ID        string                  `json:"id"`
	Object    string                  `json:"object"`
	Type      string                  `json:"type"`
	Status    string                  `json:"status"`
	Progress  int                     `json:"progress,omitempty"`
	Model     string                  `json:"model"`
	CreatedAt time.Time               `json:"created_at"`
	StartedAt *time.Time              `json:"started_at,omitempty"`
	EndedAt   *time.Time              `json:"ended_at,omitempty"`
	Result    *PublicGenerationResult `json:"result,omitempty"`
	Error     *PublicGenerationError  `json:"error,omitempty"`
}

type PublicGenerationError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func publicAPIKeyHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func publicRequestHash(value any) string {
	encoded, _ := json.Marshal(value)
	return publicAPIKeyHash(string(encoded))
}

func (s *Service) CreatePublicAPIKey(userID string, req PublicAPIKeyCreateRequest) (*PublicAPIKeyCreated, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 120 {
		return nil, BadAuthRequest("API Key 名称不能为空且不能超过 120 个字符")
	}
	allowlist := normalizePublicModelAllowlist(req.ModelAllowlist)
	if len(allowlist) > 100 {
		return nil, BadAuthRequest("API Key 最多授权 100 个模型")
	}
	for _, modelCode := range allowlist {
		if len([]rune(modelCode)) > 120 {
			return nil, BadAuthRequest("模型授权标识不能超过 120 个字符")
		}
	}
	var expiresAt *time.Time
	if strings.TrimSpace(req.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil || !parsed.After(time.Now()) {
			return nil, BadAuthRequest("API Key 过期时间无效")
		}
		expiresAt = &parsed
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("生成 API Key 失败：%w", err)
	}
	secret := "sk_live_" + base64.RawURLEncoding.EncodeToString(raw)
	prefix := secret
	if len(prefix) > 16 {
		prefix = prefix[:16]
	}
	allowlistJSON, _ := json.Marshal(allowlist)
	item := &model.PublicAPIKey{
		ID:                 newID(),
		UserID:             userID,
		Name:               name,
		Prefix:             prefix,
		Hash:               publicAPIKeyHash(secret),
		Status:             model.PublicAPIKeyStatusActive,
		ScopesJSON:         `["generation"]`,
		ModelAllowlistJSON: string(allowlistJSON),
		ExpiresAt:          expiresAt,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}
	if err := s.repo.CreatePublicAPIKey(item); err != nil {
		return nil, err
	}
	return &PublicAPIKeyCreated{PublicAPIKeyView: publicAPIKeyView(*item), Secret: secret}, nil
}

func (s *Service) PublicAPIKeys(userID string) ([]PublicAPIKeyView, error) {
	items, err := s.repo.PublicAPIKeys(userID)
	if err != nil {
		return nil, err
	}
	result := make([]PublicAPIKeyView, 0, len(items))
	for _, item := range items {
		result = append(result, publicAPIKeyView(item))
	}
	return result, nil
}

func (s *Service) RevokePublicAPIKey(userID, id string) error {
	ok, err := s.repo.RevokePublicAPIKey(userID, id, time.Now())
	if err != nil {
		return err
	}
	if !ok {
		return NotFound("API Key 不存在或已经撤销")
	}
	return nil
}

func (s *Service) AuthenticatePublicAPIKey(authorization string) (*model.PublicAPIKey, error) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) < 20 {
		return nil, Unauthorized("缺少有效的 API Key")
	}
	key, err := s.repo.PublicAPIKeyByHash(publicAPIKeyHash(parts[1]))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, Unauthorized("API Key 无效")
	}
	if err != nil {
		return nil, err
	}
	if key.Status != model.PublicAPIKeyStatusActive || (key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now())) {
		return nil, Unauthorized("API Key 已失效")
	}
	user, err := s.repo.User(key.UserID)
	if err != nil || user.Status != model.UserStatusActive {
		return nil, Unauthorized("API Key 所属账号不可用")
	}
	_ = s.repo.TouchPublicAPIKey(key.ID, time.Now())
	return key, nil
}

func (s *Service) PublicGenerationModels(key *model.PublicAPIKey) ([]PublicGenerationModel, error) {
	items, err := s.PublicLogicalModels(nil)
	if err != nil {
		return nil, err
	}
	result := make([]PublicGenerationModel, 0)
	for _, item := range items {
		if item.Capability != "image" && item.Capability != "video" {
			continue
		}
		if !item.Available {
			continue
		}
		if !publicAPIKeyAllowsModel(key, item.Code, item.ID) {
			continue
		}
		result = append(result, PublicGenerationModel{ID: item.ID, Code: item.Code, Name: item.Name, Capability: item.Capability, Available: item.Available})
	}
	return result, nil
}

func (s *Service) CreatePublicGeneration(userID string, key *model.PublicAPIKey, request PublicGenerationInput, endpoint, idempotencyKey, traceID, requestID string) (*PublicGenerationView, error) {
	if key == nil || key.UserID != userID {
		return nil, Unauthorized("API Key 无效")
	}
	input, taskType, operation, err := normalizePublicGenerationInput(request)
	if err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureFrontendModels); err != nil {
		return nil, err
	}
	idemHash := publicAPIKeyHash(strings.TrimSpace(idempotencyKey))
	requestHash := publicRequestHash(request)
	if existing, lookupErr := s.repo.PublicGenerationRequestByIdempotency(key.ID, endpoint, idemHash); lookupErr != nil {
		return nil, lookupErr
	} else if existing != nil {
		if existing.RequestHash != requestHash {
			return nil, NewAppError(409, "Idempotency-Key 已用于其他请求")
		}
		return s.PublicGeneration(userID, key.ID, existing.TaskID)
	}
	submissionID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(key.ID+"\n"+endpoint+"\n"+idemHash)).String()
	intent := ModelRequestIntentFromTaskInput(input, taskType, operation)
	models, err := s.PublicLogicalModels(&intent)
	if err != nil {
		return nil, err
	}
	logicalModelID := ""
	logicalModelCode := ""
	for _, item := range models {
		if (item.Code == request.Model || item.ID == request.Model) && item.Available && (item.Capability == "image" || item.Capability == "video") {
			logicalModelID = item.ID
			logicalModelCode = item.Code
			break
		}
	}
	if logicalModelID == "" {
		return nil, ModelRouteUnavailable("模型不存在、未开放或当前不可用")
	}
	// Allowlist checks use the resolved canonical model identifiers. A caller
	// may submit either the public code or the database ID, while a key may be
	// restricted using either form. Checking before resolution made those two
	// valid forms disagree with GET /v1/models.
	if !publicAPIKeyAllowsModel(key, logicalModelID, logicalModelCode) {
		return nil, Forbidden("该 API Key 未授权使用此模型")
	}
	task, err := s.CreateTask(userID, CreateTaskRequest{
		Type: taskType, Operation: operation, Prompt: request.Prompt, LogicalModelID: logicalModelID,
		Input: input, TraceID: traceID, RequestID: requestID, CreationSubmissionID: submissionID,
	})
	if err != nil {
		if existingTask, lookupErr := s.repo.TaskByCreationSubmission(userID, submissionID); lookupErr == nil && existingTask != nil {
			return s.PublicGeneration(userID, key.ID, existingTask.ID)
		}
		return nil, err
	}
	item := &model.PublicGenerationRequest{ID: newID(), UserID: userID, APIKeyID: key.ID, Endpoint: endpoint, IdempotencyHash: idemHash, RequestHash: requestHash, CreationSubmitID: submissionID, TaskID: task.ID, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := s.repo.CreatePublicGenerationRequest(item); err != nil {
		if existing, lookupErr := s.repo.PublicGenerationRequestByIdempotency(key.ID, endpoint, idemHash); lookupErr == nil && existing != nil {
			return s.PublicGeneration(userID, key.ID, existing.TaskID)
		}
		// CreateTask and the public idempotency row are separate persistence
		// operations. If the latter briefly fails after the task committed,
		// recover the deterministic submission and retry the mapping once so a
		// transient database error does not strand an otherwise valid task.
		if existingTask, lookupErr := s.repo.TaskByCreationSubmission(userID, submissionID); lookupErr == nil && existingTask != nil {
			if retryErr := s.repo.CreatePublicGenerationRequest(item); retryErr == nil {
				return s.PublicGeneration(userID, key.ID, existingTask.ID)
			}
		}
		return nil, err
	}
	return s.PublicGeneration(userID, key.ID, task.ID)
}

// PublicGenerationReplay checks an existing idempotency mapping without
// consuming the task creation rate limit. The handler calls this after it has
// parsed the request body and before applying the new-task limiter.
func (s *Service) PublicGenerationReplay(userID string, key *model.PublicAPIKey, request PublicGenerationInput, endpoint, idempotencyKey string) (*PublicGenerationView, bool, error) {
	if key == nil || key.UserID != userID {
		return nil, false, Unauthorized("API Key 无效")
	}
	if err := s.RequireFeature(FeatureFrontendModels); err != nil {
		return nil, false, err
	}
	idemHash := publicAPIKeyHash(strings.TrimSpace(idempotencyKey))
	existing, err := s.repo.PublicGenerationRequestByIdempotency(key.ID, endpoint, idemHash)
	if err != nil || existing == nil {
		return nil, false, err
	}
	if existing.RequestHash != publicRequestHash(request) {
		return nil, true, NewAppError(409, "Idempotency-Key 已用于其他请求")
	}
	view, err := s.PublicGeneration(userID, key.ID, existing.TaskID)
	return view, true, err
}

func (s *Service) PublicGeneration(userID, apiKeyID, taskID string) (*PublicGenerationView, error) {
	if _, err := s.repo.PublicGenerationRequestByTask(apiKeyID, userID, taskID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("生成任务不存在")
		}
		return nil, err
	}
	task, err := s.Task(userID, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("生成任务不存在")
		}
		return nil, err
	}
	view := &PublicGenerationView{ID: task.ID, Object: "generation", Type: publicGenerationType(task.Type), Status: string(task.Status), Progress: task.Progress, Model: task.Model, CreatedAt: task.CreatedAt, StartedAt: task.StartedAt, EndedAt: task.CompletedAt}
	if task.Status == model.TaskStatusFailed {
		view.Error = &PublicGenerationError{Code: "generation_failed", Message: "生成任务失败，请稍后重试"}
	}
	if task.Status == model.TaskStatusCancelled {
		view.Error = &PublicGenerationError{Code: "generation_cancelled", Message: "生成任务已取消"}
	}
	if task.Status == model.TaskStatusSucceeded {
		result, err := s.publicGenerationResult(userID, task.ResultJSON)
		if err != nil {
			return nil, err
		}
		view.Result = result
	}
	return view, nil
}

func publicAPIKeyView(item model.PublicAPIKey) PublicAPIKeyView {
	return PublicAPIKeyView{ID: item.ID, Name: item.Name, Prefix: item.Prefix, Status: item.Status, ModelAllowlist: decodePublicModelAllowlist(item.ModelAllowlistJSON), ExpiresAt: item.ExpiresAt, LastUsedAt: item.LastUsedAt, RevokedAt: item.RevokedAt, CreatedAt: item.CreatedAt}
}

func normalizePublicModelAllowlist(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func decodePublicModelAllowlist(raw string) []string {
	var values []string
	if json.Unmarshal([]byte(raw), &values) != nil {
		return nil
	}
	return normalizePublicModelAllowlist(values)
}

func publicAPIKeyAllowsModel(key *model.PublicAPIKey, values ...string) bool {
	allowlist := decodePublicModelAllowlist(key.ModelAllowlistJSON)
	if len(allowlist) == 0 {
		return true
	}
	for _, value := range values {
		for _, allowed := range allowlist {
			if strings.TrimSpace(value) != "" && value == allowed {
				return true
			}
		}
	}
	return false
}

func normalizePublicGenerationInput(request PublicGenerationInput) (map[string]any, string, string, error) {
	typeName := strings.ToLower(strings.TrimSpace(request.Type))
	if typeName != "image" && typeName != "video" {
		return nil, "", "", BadAuthRequest("type 只能是 image 或 video")
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" || len([]rune(prompt)) > 8000 {
		return nil, "", "", BadAuthRequest("prompt 不能为空且不能超过 8000 个字符")
	}
	if strings.TrimSpace(request.Model) == "" {
		return nil, "", "", BadAuthRequest("model 不能为空")
	}
	operation := strings.TrimSpace(request.Operation)
	if operation == "" {
		operation = map[string]string{"image": "text_to_image", "video": "text_to_video"}[typeName]
	}
	wantOperation := map[string]string{"image": "text_to_image", "video": "text_to_video"}[typeName]
	if operation != wantOperation {
		return nil, "", "", BadAuthRequest("MVP 只支持文生图和文生视频")
	}
	options := map[string]any{}
	if typeName == "image" {
		size := strings.TrimSpace(request.Size)
		if size == "" {
			size = strings.TrimSpace(request.AspectRatio)
		}
		if size != "" {
			options["size"] = size
		}
		if quality := strings.TrimSpace(request.Quality); quality != "" {
			options["quality"] = quality
		}
	} else {
		if size := strings.TrimSpace(request.AspectRatio); size != "" {
			options["size"] = size
		}
		if resolution := strings.TrimSpace(request.Resolution); resolution != "" {
			options["vquality"] = resolution
		}
		if request.Duration > 0 {
			if request.Duration > 60 {
				return nil, "", "", BadAuthRequest("视频时长不能超过 60 秒")
			}
			options["videoSeconds"] = request.Duration
		}
		if request.GenerateAudio != nil {
			options["videoGenerateAudio"] = *request.GenerateAudio
		}
		if request.Watermark != nil {
			options["videoWatermark"] = *request.Watermark
		}
	}
	return map[string]any{"mode": typeName, "capabilityOptions": options, "config": map[string]any{}, "metadata": map[string]any{"source": "public-api"}}, "canvas_" + typeName, operation, nil
}

func publicGenerationType(taskType string) string {
	if strings.Contains(taskType, "video") {
		return "video"
	}
	return "image"
}

func (s *Service) publicGenerationResult(userID, raw string) (*PublicGenerationResult, error) {
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, publicGenerationResultUnavailable(err)
	}
	result := &PublicGenerationResult{}
	seen := map[string]bool{}
	var walk func(any) error
	walk = func(node any) error {
		switch typed := node.(type) {
		case []any:
			for _, item := range typed {
				if err := walk(item); err != nil {
					return err
				}
			}
		case map[string]any:
			resourceID := publicGenerationResourceID(typed)
			if resourceID != "" && !seen[resourceID] {
				resource, err := s.repo.ResourceForUser(userID, resourceID)
				if err != nil {
					return err
				}
				access, err := s.resolveResourceAccess(resource, ResourceAccessOptions{Purpose: assets.PurposeDisplay})
				if err != nil {
					return err
				}
				media := PublicGenerationMedia{ResourceID: resourceID, URL: access.URL, MimeType: stringValue(typed["mimeType"]), Width: intValue(typed["width"]), Height: intValue(typed["height"]), DurationMs: int64ValuePublic(typed["durationMs"])}
				if strings.HasPrefix(media.MimeType, "video/") || typed["durationMs"] != nil {
					result.Videos = append(result.Videos, media)
				} else {
					result.Images = append(result.Images, media)
				}
				seen[resourceID] = true
			}
			for _, item := range typed {
				if err := walk(item); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk(value); err != nil {
		return nil, err
	}
	if len(result.Images) == 0 && len(result.Videos) == 0 {
		return nil, publicGenerationResultUnavailable(errors.New("生成结果未包含可用资源"))
	}
	return result, nil
}

func publicGenerationResultUnavailable(cause error) error {
	err := NewAppError(500, "生成结果暂时不可用，请稍后重试")
	err.Reason = ErrorReason("result_unavailable")
	err.Cause = cause
	return err
}

func publicGenerationResourceID(value map[string]any) string {
	if resourceID := stringValue(value["resourceId"]); resourceID != "" {
		return resourceID
	}
	storageKey := stringValue(value["storageKey"])
	if !strings.HasPrefix(storageKey, "resource:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(storageKey, "resource:"))
}

func int64ValuePublic(value any) int64 {
	return int64(intValue(value))
}
