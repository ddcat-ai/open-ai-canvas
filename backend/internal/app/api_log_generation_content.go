package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

const maxGenerationSnapshotBytes = 256 << 10
const maxGenerationReferences = 100

type APICallGenerationContent = model.APICallGenerationContent
type APICallGenerationReference = model.APICallGenerationReference

// Only request text and durable resource identities survive transport conversion.
// URLs, inline bytes, headers and provider configuration never enter this schema.
type apiLogGenerationSnapshot struct {
	Version    int                         `json:"version"`
	Prompt     string                      `json:"prompt"`
	References []apiLogGenerationReference `json:"references"`
	Incomplete bool                        `json:"incomplete,omitempty"`
}

type apiLogGenerationReference struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Name       string `json:"name"`
	ResourceID string `json:"resourceId,omitempty"`
	Role       string `json:"role,omitempty"`
	SlotKey    string `json:"slotKey,omitempty"`
}

var generationLinkPattern = regexp.MustCompile(`(?i)(?:https?://|data:|asset://)[^\s<>"'` + "`" + `]+`)
var generationSecretPattern = regexp.MustCompile(`(?i)(?:authorization|cookie|set-cookie|x-api-key|x-goog-api-key|api[_-]?key|secret[_-]?key|access[_-]?token|pass[w]ord|token|signature)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)`)
var generationBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[^\s,;"'}]+`)
var generationMentionPattern = regexp.MustCompile(`@(图片|参考图|视频|音频)([1-9][0-9]*)`)

func safeGenerationText(value string, limit int, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" && secret != "system" {
			value = strings.ReplaceAll(value, secret, "[REDACTED]")
		}
	}
	value = generationLinkPattern.ReplaceAllString(value, "[媒体地址已隐藏]")
	value = generationSecretPattern.ReplaceAllString(value, "[REDACTED]")
	value = generationBearerPattern.ReplaceAllString(value, "[REDACTED]")
	return truncateRunes(strings.ToValidUTF8(value, "�"), limit)
}

func generationReferenceID(seed, kind string, index int) string {
	sum := sha256.Sum256([]byte(seed + "\n" + kind + "\n" + strconv.Itoa(index)))
	return hex.EncodeToString(sum[:16])
}

func (s *Service) generationSnapshot(userID, seed string, input canvasGenerationInput) apiLogGenerationSnapshot {
	secrets := []string{input.Config.APIKey, input.Config.SecretKey, input.Config.RunningHubWalletKey, input.Config.RunningHubUploadKey}
	for _, header := range input.Config.Headers {
		name := strings.ToLower(header.Name)
		if strings.Contains(name, "authorization") || strings.Contains(name, "cookie") || strings.Contains(name, "token") || strings.Contains(name, "key") || strings.Contains(name, "secret") {
			secrets = append(secrets, header.Value)
		}
	}
	snapshot := apiLogGenerationSnapshot{Version: 1, Prompt: safeGenerationText(input.Prompt, 64<<10, secrets...), References: []apiLogGenerationReference{}}
	if len([]rune(input.Prompt)) > 64<<10 {
		snapshot.Incomplete = true
	}
	groups := []struct {
		kind, label string
		media       []providerMedia
	}{
		{"image", "图片", input.ReferenceImages}, {"video", "视频", input.ReferenceVideos}, {"audio", "音频", input.ReferenceAudios},
	}
	for _, group := range groups {
		for i, media := range group.media {
			if len(snapshot.References) >= maxGenerationReferences {
				snapshot.Incomplete = true
				break
			}
			label := group.label + strconv.Itoa(i+1)
			ref := apiLogGenerationReference{ID: generationReferenceID(seed, group.kind, i+1), Kind: group.kind, Label: label, Name: safeGenerationText(media.Name, 256, secrets...), SlotKey: safeGenerationText(media.SlotKey, 128, secrets...)}
			if strings.TrimSpace(ref.Name) == "" {
				ref.Name = label
			}
			if media.Role == "reference" || media.Role == "first_frame" || media.Role == "last_frame" {
				ref.Role = media.Role
			}
			ref.ResourceID = s.generationOriginalResourceID(userID, media)
			if ref.ResourceID != "" {
				resource, err := s.repo.ResourceForUser(userID, ref.ResourceID)
				if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), group.kind+"/") {
					ref.ResourceID = ""
				}
			}
			if ref.ResourceID == "" {
				snapshot.Incomplete = true
			}
			snapshot.References = append(snapshot.References, ref)
		}
	}
	addMissingGenerationMentions(&snapshot, seed)
	return snapshot
}

func (s *Service) generationOriginalResourceID(userID string, media providerMedia) string {
	if strings.HasPrefix(media.URL, "asset://") {
		// sourceResourceId is only a hint; a matching owner/resource/Ark binding
		// must prove which original was used. Never infer it from a node ID.
		resourceID := validCanvasResourceID(media.SourceResourceID)
		if resourceID == "" && strings.HasPrefix(media.StorageKey, "resource:") {
			resourceID = validCanvasResourceID(strings.TrimPrefix(media.StorageKey, "resource:"))
		}
		if resourceID != "" {
			if verified, err := s.repo.HasArkPrivateAssetResourceBinding(userID, resourceID, strings.TrimPrefix(media.URL, "asset://")); err == nil && verified {
				return resourceID
			}
		}
		return ""
	}
	if strings.HasPrefix(media.StorageKey, "resource:") {
		return validCanvasResourceID(strings.TrimPrefix(media.StorageKey, "resource:"))
	}
	if strings.HasPrefix(media.URL, "/api/resources/") && !strings.ContainsAny(media.URL, "?#") {
		id := validCanvasResourceID(resourceIDFromFileURL(media.URL))
		if media.URL == resourceFileURL(id) {
			return id
		}
	}
	return ""
}

func addMissingGenerationMentions(snapshot *apiLogGenerationSnapshot, seed string) {
	labels := make(map[string]bool)
	for _, ref := range snapshot.References {
		labels[ref.Label] = true
	}
	for _, match := range generationMentionPattern.FindAllStringSubmatch(snapshot.Prompt, -1) {
		prefix := match[1]
		if prefix == "参考图" {
			prefix = "图片"
		}
		label := prefix + match[2]
		if labels[label] {
			continue
		}
		if len(snapshot.References) >= maxGenerationReferences {
			snapshot.Incomplete = true
			break
		}
		index, err := strconv.Atoi(match[2])
		if err != nil {
			snapshot.Incomplete = true
			continue
		}
		kind := map[string]string{"图片": "image", "视频": "video", "音频": "audio"}[prefix]
		snapshot.References = append(snapshot.References, apiLogGenerationReference{ID: generationReferenceID(seed, kind, index), Kind: kind, Label: label, Name: label})
		labels[label] = true
		snapshot.Incomplete = true
	}
}

func encodeGenerationSnapshot(snapshot apiLogGenerationSnapshot) string {
	for {
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return ""
		}
		if len(encoded) <= maxGenerationSnapshotBytes {
			return string(encoded)
		}
		snapshot.Incomplete = true
		prompt := []rune(snapshot.Prompt)
		if len(prompt) == 0 {
			return ""
		}
		snapshot.Prompt = string(prompt[:len(prompt)/2])
	}
}

func (s *Service) withGenerationSnapshot(ctx context.Context, userID string, input canvasGenerationInput) context.Context {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || input.Mode != "video" || resumedProviderRequestID(ctx) != "" {
		return ctx
	}
	metadata.GenerationContentJSON = encodeGenerationSnapshot(s.generationSnapshot(userID, newID(), input))
	return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
}

// Direct system relays can retain only evidence present in the sanitized request.
// Task preflight failures explicitly pass their uncompressed input at write time.
func (s *Service) captureAPILogGeneration(log *model.ApiCallLog) {
	if log.Capability != "video" || log.RequestKind != "create" || log.GenerationContentJSON != "" {
		return
	}
	input, ok := generationInputFromRequest(log.RequestBody)
	if !ok {
		return
	}
	snapshot := s.generationSnapshot(log.UserID, log.ID, input)
	snapshot.Incomplete = true
	log.GenerationContentJSON = encodeGenerationSnapshot(snapshot)
}

// Parse explicit protocol fields only. Arbitrary nested strings and response URLs
// are never interpreted as references or offered to an administrator's browser.
func generationInputFromRequest(body string) (canvasGenerationInput, bool) {
	var raw map[string]json.RawMessage
	input := canvasGenerationInput{Mode: "video"}
	if len(body) > 1<<20 || json.Unmarshal([]byte(body), &raw) != nil {
		return input, false
	}
	_ = json.Unmarshal(raw["prompt"], &input.Prompt)
	_ = json.Unmarshal(raw["referenceImages"], &input.ReferenceImages)
	_ = json.Unmarshal(raw["referenceVideos"], &input.ReferenceVideos)
	_ = json.Unmarshal(raw["referenceAudios"], &input.ReferenceAudios)
	var content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw["content"], &content)
	for _, part := range content {
		switch part.Type {
		case "text":
			if input.Prompt == "" {
				input.Prompt = part.Text
			} else {
				input.Prompt += "\n" + part.Text
			}
		case "image_url":
			input.ReferenceImages = append(input.ReferenceImages, providerMedia{})
		case "video_url":
			input.ReferenceVideos = append(input.ReferenceVideos, providerMedia{})
		case "audio_url":
			input.ReferenceAudios = append(input.ReferenceAudios, providerMedia{})
		}
	}
	if input.Prompt == "" {
		var nested struct {
			Prompt string `json:"prompt"`
		}
		_ = json.Unmarshal(raw["input"], &nested)
		input.Prompt = nested.Prompt
	}
	return input, input.Prompt != "" || len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios) > 0
}

func (s *Service) apiLogGenerationSnapshot(log *model.ApiCallLog) (*apiLogGenerationSnapshot, string, error) {
	if log.Capability != "video" || log.RequestKind != "create" {
		return nil, "", nil
	}
	if log.GenerationContentJSON != "" && len(log.GenerationContentJSON) <= maxGenerationSnapshotBytes {
		var snapshot apiLogGenerationSnapshot
		if json.Unmarshal([]byte(log.GenerationContentJSON), &snapshot) == nil && snapshot.Version == 1 && len(snapshot.References) <= maxGenerationReferences {
			return &snapshot, "snapshot", nil
		}
	}
	if log.TaskID != "" {
		task, err := s.repo.Task(log.TaskID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", err
		}
		// Reused task IDs and changed billing/request identities cannot prove an
		// older attempt's inputs. Do not use the current canvas as a fallback.
		if err == nil && task.UserID == log.UserID && task.Attempts <= 1 && task.RouteRun <= 1 && task.BillingOrderID == log.BillingOrderID && task.RequestID == log.RequestID && !task.CreatedAt.After(log.CreatedAt) && (task.StartedAt == nil || !task.StartedAt.After(log.CreatedAt)) {
			var input canvasGenerationInput
			if raw, err := s.decryptTaskInputJSON(task.InputJSON); err == nil && json.Unmarshal([]byte(raw), &input) == nil {
				if input.Prompt == "" {
					input.Prompt = task.Prompt
				}
				if input.Prompt != "" {
					snapshot := s.generationSnapshot(log.UserID, log.ID, input)
					snapshot.Incomplete = true
					return &snapshot, "task", nil
				}
			}
		}
	}
	input, _ := generationInputFromRequest(log.RequestBody)
	snapshot := s.generationSnapshot(log.UserID, log.ID, input)
	snapshot.Incomplete = true
	return &snapshot, "request", nil
}

func (s *Service) apiLogReferenceResource(log *model.ApiCallLog, ref apiLogGenerationReference) (*model.Resource, error) {
	if ref.ResourceID == "" || log.UserID == "" {
		return nil, NotFound("原始媒体不存在或不可访问")
	}
	// A deleted task does not invalidate an immutable log snapshot, but an
	// existing task with another owner indicates a broken ownership chain.
	if log.TaskID != "" {
		task, err := s.repo.Task(log.TaskID)
		if (err != nil && !errors.Is(err, gorm.ErrRecordNotFound)) || (err == nil && task.UserID != log.UserID) {
			return nil, NotFound("原始媒体不存在或不可访问")
		}
	}
	resource, err := s.repo.ResourceForUser(log.UserID, ref.ResourceID)
	if err != nil || resource.Status != model.ResourceStatusReady || (ref.Kind != "image" && ref.Kind != "video" && ref.Kind != "audio") || !strings.HasPrefix(strings.ToLower(resource.MimeType), ref.Kind+"/") {
		return nil, NotFound("原始媒体不存在或不可访问")
	}
	return resource, nil
}

func (s *Service) decorateAPILogGeneration(log *model.ApiCallLog) error {
	snapshot, source, err := s.apiLogGenerationSnapshot(log)
	if err != nil || snapshot == nil {
		return err
	}
	content := &model.APICallGenerationContent{Prompt: safeGenerationText(snapshot.Prompt, 64<<10), Source: source, Incomplete: snapshot.Incomplete, References: []model.APICallGenerationReference{}}
	for _, ref := range snapshot.References {
		item := model.APICallGenerationReference{ID: ref.ID, Kind: ref.Kind, Label: safeGenerationText(ref.Label, 80), Name: safeGenerationText(ref.Name, 256), Role: ref.Role}
		if _, err := s.apiLogReferenceResource(log, ref); err == nil {
			item.Available = true
			item.MediaURL = "/api/admin/api-logs/" + url.PathEscape(log.ID) + "/references/" + url.PathEscape(ref.ID) + "/media"
		} else {
			item.UnavailableReason = "原始媒体不存在或不可访问"
			if ref.ResourceID == "" {
				item.UnavailableReason = "该请求未保存可验证的原始媒体"
			}
			content.Incomplete = true
		}
		content.References = append(content.References, item)
	}
	if content.Incomplete {
		content.Note = "部分历史内容或原始媒体未保存，无法完整还原；仅展示可验证的请求内容。"
	}
	log.GenerationContent = content
	return nil
}

func (s *Service) PrepareAdminAPICallLogReferenceDelivery(actor *model.User, logID, referenceID, rangeHeader string) (*ResourceDelivery, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("请求日志不存在")
	}
	if err != nil {
		return nil, err
	}
	snapshot, _, err := s.apiLogGenerationSnapshot(log)
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, NotFound("原始媒体不存在或不可访问")
	}
	for _, ref := range snapshot.References {
		if ref.ID != referenceID {
			continue
		}
		resource, err := s.apiLogReferenceResource(log, ref)
		if err != nil {
			return nil, err
		}
		stream, err := s.openResourceRange(log.UserID, resource, rangeHeader)
		if err != nil {
			return nil, NotFound("原始媒体暂不可用")
		}
		// No CDN/access URL is resolved, even for signed origin storage.
		return &ResourceDelivery{Resource: resource, Stream: stream, Access: &assets.ResourceAccess{RequestedVariant: assets.VariantOriginal, ActualVariant: assets.VariantOriginal, Delivery: assets.DeliveryProxy}}, nil
	}
	return nil, NotFound("原始媒体不存在或不可访问")
}
