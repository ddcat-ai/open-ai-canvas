package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type OfficialAssetRecommendationDetail struct {
	model.OfficialAssetRecommendation `json:",inline"`
	AssetKind                         string                           `json:"assetKind"`
	AssetTitle                        string                           `json:"assetTitle"`
	AssetDescription                  string                           `json:"assetDescription"`
	AssetTags                         []string                         `json:"assetTags,omitempty"`
	AssetCategory                     string                           `json:"assetCategory"`
	AssetResourceID                   string                           `json:"assetResourceId,omitempty"`
	AssetPreviewURL                   string                           `json:"assetPreviewUrl,omitempty"`
	CharacterSnapshot                 *characterRecommendationSnapshot `json:"characterSnapshot,omitempty"`
	CharacterSnapshotSource           string                           `json:"characterSnapshotSource,omitempty"`
}

type characterRecommendationSnapshot struct {
	VersionID       string                            `json:"versionId,omitempty"`
	Version         int                               `json:"version,omitempty"`
	Definition      json.RawMessage                   `json:"definition"`
	Representations []characterRepresentationSnapshot `json:"representations,omitempty"`
	Images          []model.AssetRepresentation       `json:"images,omitempty"` // legacy snapshots
	Voice           *CharacterVoiceSummary            `json:"voice,omitempty"`
	VisualStatus    string                            `json:"visualStatus"`
	VoiceStatus     string                            `json:"voiceStatus"`
	PartialReasons  []string                          `json:"partialReasons,omitempty"`
}

type characterRepresentationSnapshot struct {
	ID            string `json:"id,omitempty"`
	ResourceID    string `json:"resourceId"`
	MediaType     string `json:"mediaType"`
	Role          string `json:"role"`
	Status        string `json:"status"`
	FailureReason string `json:"failureReason,omitempty"`
}

func (s *Service) characterRecommendationSnapshot(asset *model.Asset) (*characterRecommendationSnapshot, error) {
	versions, reps, err := s.repo.AssetResourceRecords(asset.ID)
	if err != nil {
		return nil, err
	}
	snapshot := &characterRecommendationSnapshot{Images: []model.AssetRepresentation{}, Representations: []characterRepresentationSnapshot{}, VoiceStatus: "unavailable"}
	for _, version := range versions {
		if version.ID == asset.PrimaryVersionID {
			if json.Valid([]byte(version.DefinitionJSON)) {
				snapshot.Definition = json.RawMessage(version.DefinitionJSON)
			} else {
				snapshot.PartialReasons = append(snapshot.PartialReasons, "角色卡定义资料无效")
			}
			snapshot.VersionID = version.ID
			snapshot.Version = version.Version
		}
	}
	if len(snapshot.Definition) == 0 {
		snapshot.PartialReasons = append(snapshot.PartialReasons, "角色卡版本资料不存在")
	}
	for _, rep := range reps {
		if rep.AssetVersionID == asset.PrimaryVersionID && rep.ResourceID != "" {
			resource, resourceErr := s.repo.ResourceForUser(asset.UserID, rep.ResourceID)
			item := characterRepresentationSnapshot{ID: rep.ID, ResourceID: rep.ResourceID, MediaType: rep.MediaType, Role: rep.Role, Status: "ready"}
			if resourceErr != nil || resource == nil || resource.Status != model.ResourceStatusReady || resource.Kind != "image" {
				item.Status = "partial"
				item.FailureReason = "关联图片不可用"
				snapshot.PartialReasons = append(snapshot.PartialReasons, item.Role+"："+item.FailureReason)
			} else {
				snapshot.Images = append(snapshot.Images, rep)
			}
			snapshot.Representations = append(snapshot.Representations, item)
		}
	}
	if len(snapshot.Representations) == 0 {
		snapshot.VisualStatus = "partial"
		snapshot.PartialReasons = append(snapshot.PartialReasons, "未找到角色卡图片")
	} else if len(snapshot.PartialReasons) > 0 {
		snapshot.VisualStatus = "partial"
	} else {
		snapshot.VisualStatus = "ready"
	}
	binding, bindingErr := s.repo.CharacterVoiceBinding(asset.PrimaryVersionID)
	if bindingErr != nil && !errors.Is(bindingErr, gorm.ErrRecordNotFound) {
		return nil, bindingErr
	}
	if binding != nil {
		profile, profileErr := s.repo.VoiceProfileForUser(asset.UserID, binding.VoiceProfileID)
		if profileErr != nil || profile == nil || profile.Status != "active" {
			snapshot.PartialReasons = append(snapshot.PartialReasons, "绑定声音不可用")
		} else {
			if profile.SampleResourceID != "" {
				resource, resourceErr := s.repo.ResourceForUser(asset.UserID, profile.SampleResourceID)
				if resourceErr != nil || resource == nil || resource.Status != model.ResourceStatusReady || resource.Kind != "audio" {
					snapshot.PartialReasons = append(snapshot.PartialReasons, "角色卡试听音频不可用")
				}
			}
			if profile != nil && profile.Status == "active" {
				snapshot.Voice = &CharacterVoiceSummary{Profile: voiceProfileSummary(*profile), Instructions: binding.Instructions}
				snapshot.VoiceStatus = "ready"
			}
		}
	}
	if len(snapshot.PartialReasons) > 0 {
		snapshot.VisualStatus = "partial"
	}
	return snapshot, nil
}

// OfficialAssetRecommendationReviewMetadata 是管理员批准时确认的官方素材元数据。
// 指针字段用于区分“管理员未填写，沿用原素材”与“管理员明确清空”。
type OfficialAssetRecommendationReviewMetadata struct {
	Title       *string   `json:"title,omitempty"`
	Description *string   `json:"description,omitempty"`
	Category    *string   `json:"category,omitempty"`
	Tags        *[]string `json:"tags,omitempty"`
	SourceName  *string   `json:"sourceName,omitempty"`
	SourceURL   *string   `json:"sourceUrl,omitempty"`
	LicenseNote *string   `json:"licenseNote,omitempty"`
	UsageNote   *string   `json:"usageNote,omitempty"`
}
type OfficialAssetRecommendationsPage struct {
	Items    []OfficialAssetRecommendationDetail `json:"items"`
	Page     int                                 `json:"page"`
	PageSize int                                 `json:"pageSize"`
	Total    int64                               `json:"total"`
}

func recommendationMediaType(kind string) (string, bool) {
	switch kind {
	case "image":
		return model.OfficialAssetMediaTypeImage, true
	case "video":
		return model.OfficialAssetMediaTypeVideo, true
	case "audio":
		return model.OfficialAssetMediaTypeAudio, true
	case "entity":
		return model.OfficialAssetMediaTypeEntity, true
	}
	return "", false
}

func (s *Service) recommendationResourceID(asset *model.Asset) (string, error) {
	versions, reps, err := s.repo.AssetResourceRecords(asset.ID)
	if err != nil {
		return "", err
	}
	for _, version := range versions {
		if version.ID != asset.PrimaryVersionID {
			continue
		}
		for _, rep := range reps {
			if rep.AssetVersionID == version.ID && rep.ResourceID != "" {
				return rep.ResourceID, nil
			}
		}
	}
	for _, rep := range reps {
		if rep.ResourceID != "" {
			return rep.ResourceID, nil
		}
	}
	// Generation assets created by the media pipeline may not have normalized
	// asset_versions/asset_representations rows yet. Their payload still stores
	// the canonical resource URL/storage key; reuse that resource instead of
	// forcing a second upload or showing an empty preview in the admin queue.
	if resourceID := s.payloadResourceID(asset.PayloadJSON); resourceID != "" {
		if resource, resourceErr := s.repo.Resource(resourceID); resourceErr == nil && resource.Status == model.ResourceStatusReady {
			return resourceID, nil
		}
	}
	return "", BadAuthRequest("素材尚未关联可用资源")
}

func (s *Service) payloadResourceID(raw string) string {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return ""
	}
	// The primary media lives in data; the root cover may be a separate image.
	if root, ok := value.(map[string]any); ok {
		if data, ok := root["data"].(map[string]any); ok {
			for _, key := range []string{"resourceId", "resourceID", "storageKey", "url", "dataUrl"} {
				if text, ok := data[key].(string); ok {
					if id := assets.ResourceID(text); id != "" {
						return id
					}
				}
			}
		}
	}
	var walk func(any) string
	walk = func(node any) string {
		switch item := node.(type) {
		case map[string]any:
			// Prefer explicit canonical fields before walking arbitrary metadata.
			for _, key := range []string{"resourceId", "resourceID", "storageKey", "coverUrl", "dataUrl"} {
				if text, ok := item[key].(string); ok {
					if id := assets.ResourceID(text); id != "" {
						return id
					}
				}
			}
			for _, child := range item {
				if id := walk(child); id != "" {
					return id
				}
			}
		case []any:
			for _, child := range item {
				if id := walk(child); id != "" {
					return id
				}
			}
		}
		return ""
	}
	return walk(value)
}

const officialRecommendationConsentVersion = "commercial-use-v1"

func (s *Service) CreateOfficialAssetRecommendation(user *model.User, assetID, note, consentVersion string) (*model.OfficialAssetRecommendation, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if consentVersion != officialRecommendationConsentVersion {
		return nil, BadAuthRequest("请先确认素材使用授权")
	}
	asset, err := s.repo.AssetForUser(user.ID, strings.TrimSpace(assetID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("素材不存在或尚未同步，请刷新后重试")
		}
		return nil, err
	}
	if asset.Status == model.AssetVersionStatusArchived {
		return nil, BadAuthRequest("回收站素材不能推荐")
	}
	if _, ok := recommendationMediaType(asset.Kind); !ok {
		return nil, BadAuthRequest("仅支持图片、视频、音频和角色卡")
	}
	if existing, err := s.repo.UserOfficialAssetRecommendation(asset.ID, user.ID); err == nil {
		if existing.Status == model.OfficialAssetRecommendationChangesRequested {
			return s.ResubmitOfficialAssetRecommendation(user, existing.ID, note, consentVersion)
		}
		return nil, BadAuthRequest("该素材已有待审核或已通过的推荐")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if len([]rune(note)) > 2000 {
		return nil, BadAuthRequest("推荐说明不能超过 2000 个字符")
	}
	now := time.Now()
	v := &model.OfficialAssetRecommendation{ID: "oar_" + kernel.NewID(), AssetID: asset.ID, SubmitterID: user.ID, Title: asset.Title, Note: strings.TrimSpace(note), ConsentVersion: consentVersion, ConsentAt: &now, Status: model.OfficialAssetRecommendationPending, CreatedAt: now, UpdatedAt: now}
	if asset.Kind == "entity" {
		snapshot, snapshotErr := s.characterRecommendationSnapshot(asset)
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		raw, marshalErr := json.Marshal(snapshot)
		if marshalErr != nil {
			return nil, marshalErr
		}
		v.SnapshotJSON = string(raw)
	}
	return v, s.repo.CreateOfficialAssetRecommendation(v)
}
func (s *Service) AdminOfficialAssetRecommendationsPage(user *model.User, status string, page, size int) (*OfficialAssetRecommendationsPage, error) {
	if err := s.RequireAdmin(user); err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	rows, total, err := s.repo.OfficialAssetRecommendationsPage(status, page, size)
	if err != nil {
		return nil, err
	}
	out := &OfficialAssetRecommendationsPage{Page: page, PageSize: size, Total: total, Items: make([]OfficialAssetRecommendationDetail, 0, len(rows))}
	for _, row := range rows {
		d, err := s.officialAssetRecommendationDetail(row)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, d)
	}
	return out, nil
}

func (s *Service) officialAssetRecommendationDetail(row model.OfficialAssetRecommendation) (OfficialAssetRecommendationDetail, error) {
	d := OfficialAssetRecommendationDetail{OfficialAssetRecommendation: row}
	if strings.TrimSpace(row.SnapshotJSON) != "" {
		var snapshot characterRecommendationSnapshot
		if err := json.Unmarshal([]byte(row.SnapshotJSON), &snapshot); err != nil {
			// Keep the queue readable even for legacy/corrupt snapshots; the
			// publish gate below will require a fresh complete submission.
			d.CharacterSnapshotSource = "submitted"
		} else {
			d.CharacterSnapshot = &snapshot
			d.CharacterSnapshotSource = "submitted"
		}
	}
	if a, err := s.repo.AssetForUser(row.SubmitterID, row.AssetID); err == nil {
		d.AssetKind = a.Kind
		d.AssetTitle = a.Title
		d.AssetDescription = ""
		var payload struct {
			Tags []string `json:"tags"`
		}
		if json.Unmarshal([]byte(a.PayloadJSON), &payload) == nil {
			d.AssetTags = payload.Tags
		}
		d.AssetCategory = string(a.Category)
		if d.CharacterSnapshot == nil && a.Kind == "entity" {
			if snapshot, snapshotErr := s.characterRecommendationSnapshot(a); snapshotErr == nil {
				d.CharacterSnapshot = snapshot
				d.CharacterSnapshotSource = "current"
			}
		}
		if d.AssetResourceID == "" {
			if resourceID, resourceErr := s.recommendationResourceID(a); resourceErr == nil {
				d.AssetResourceID = resourceID
				d.AssetPreviewURL = "/api/admin/resources/" + resourceID + "/file"
			}
		}
	}
	if d.AssetKind == "" && d.CharacterSnapshot != nil {
		d.AssetKind = "entity"
		d.AssetCategory = string(model.AssetCategoryCharacter)
	}
	if d.AssetTitle == "" {
		d.AssetTitle = row.Title
	}
	if d.AssetKind == "entity" && d.CharacterSnapshot != nil {
		for _, rep := range d.CharacterSnapshot.Representations {
			if rep.Status == "ready" && rep.ResourceID != "" {
				d.AssetResourceID = rep.ResourceID
				d.AssetPreviewURL = "/api/admin/resources/" + rep.ResourceID + "/file"
				break
			}
		}
		if d.AssetResourceID == "" && len(d.CharacterSnapshot.Images) > 0 {
			d.AssetResourceID = d.CharacterSnapshot.Images[0].ResourceID
			d.AssetPreviewURL = "/api/admin/resources/" + d.AssetResourceID + "/file"
		}
	}
	return d, nil
}

func (s *Service) AdminOfficialAssetRecommendationDetail(user *model.User, id string) (*OfficialAssetRecommendationDetail, error) {
	if err := s.RequireAdmin(user); err != nil {
		return nil, err
	}
	row, err := s.repo.OfficialAssetRecommendationByID(id)
	if err != nil {
		return nil, err
	}
	d, err := s.officialAssetRecommendationDetail(*row)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *Service) ResubmitOfficialAssetRecommendation(user *model.User, id, note, consentVersion string) (*model.OfficialAssetRecommendation, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if consentVersion != officialRecommendationConsentVersion {
		return nil, BadAuthRequest("请先确认素材使用授权")
	}
	row, err := s.repo.OfficialAssetRecommendationByID(id)
	if err != nil {
		return nil, err
	}
	if row.SubmitterID != user.ID {
		return nil, Forbidden("无权修改该推荐")
	}
	if row.Status != model.OfficialAssetRecommendationChangesRequested {
		return nil, BadAuthRequest("只有退回补充的推荐可以重新提交")
	}
	if len([]rune(note)) > 2000 {
		return nil, BadAuthRequest("推荐说明不能超过 2000 个字符")
	}
	asset, err := s.repo.AssetForUser(user.ID, row.AssetID)
	if err != nil {
		return nil, err
	}
	var raw []byte
	if asset.Kind == "entity" {
		snapshot, err := s.characterRecommendationSnapshot(asset)
		if err != nil {
			return nil, err
		}
		raw, err = json.Marshal(snapshot)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	fields := map[string]any{"note": strings.TrimSpace(note), "snapshot_json": string(raw), "consent_version": consentVersion, "consent_at": now, "status": model.OfficialAssetRecommendationPending, "reviewer_id": "", "reviewer_note": "", "reviewed_at": nil, "official_asset_id": "", "updated_at": now}
	if err := s.repo.UpdateOfficialAssetRecommendation(row.ID, fields); err != nil {
		return nil, err
	}
	return s.repo.OfficialAssetRecommendationByID(row.ID)
}
func (s *Service) ReviewOfficialAssetRecommendation(user *model.User, id, action, note string, metadata *OfficialAssetRecommendationReviewMetadata) (*model.OfficialAssetRecommendation, error) {
	if err := s.RequireAdmin(user); err != nil {
		return nil, err
	}
	row, err := s.repo.OfficialAssetRecommendationByID(id)
	if err != nil {
		return nil, err
	}
	if row.Status != model.OfficialAssetRecommendationPending && row.Status != model.OfficialAssetRecommendationChangesRequested {
		return nil, BadAuthRequest("该推荐已处理")
	}
	action = strings.TrimSpace(action)
	if action != "approve" && action != "reject" && action != "changes_requested" {
		return nil, BadAuthRequest("无效的审核动作")
	}
	if (action == "reject" || action == "changes_requested") && strings.TrimSpace(note) == "" {
		return nil, BadAuthRequest("退回或拒绝时必须填写原因")
	}
	now := time.Now().UTC()
	status := actionToRecommendationStatus(action)
	fields := map[string]any{"status": status, "reviewer_id": user.ID, "reviewer_note": strings.TrimSpace(note), "reviewed_at": now, "updated_at": now}
	if action == "approve" {
		if row.ConsentVersion != officialRecommendationConsentVersion || row.ConsentAt == nil {
			return nil, BadAuthRequest("尚未确认素材使用授权，请退回并让推荐人重新提交")
		}
		asset, e := s.repo.AssetForUser(row.SubmitterID, row.AssetID)
		if e != nil {
			return nil, e
		}
		media, ok := recommendationMediaType(asset.Kind)
		if !ok {
			return nil, BadAuthRequest("素材类型不支持")
		}
		var submittedCharacterSnapshot string
		if asset.Kind == "entity" {
			if strings.TrimSpace(row.SnapshotJSON) == "" {
				return nil, BadAuthRequest("角色卡缺少提交快照，请让用户重新提交")
			}
			var snapshot characterRecommendationSnapshot
			if e := json.Unmarshal([]byte(row.SnapshotJSON), &snapshot); e != nil || strings.TrimSpace(snapshot.VersionID) == "" || len(snapshot.Representations) == 0 && len(snapshot.Images) == 0 {
				return nil, BadAuthRequest("角色卡提交快照不完整，请让用户重新提交")
			}
			submittedCharacterSnapshot = row.SnapshotJSON
		}
		resourceID, e := s.recommendationResourceID(asset)
		if e != nil {
			return nil, e
		}
		title, description, category, sourceName, sourceURL, licenseNote, usageNote := asset.Title, "", string(asset.Category), "用户推荐", "", "", ""
		var tags []string
		if metadata != nil {
			if metadata.Title != nil {
				title = strings.TrimSpace(*metadata.Title)
			}
			if metadata.Description != nil {
				description = strings.TrimSpace(*metadata.Description)
			}
			if metadata.Category != nil {
				category = strings.TrimSpace(*metadata.Category)
			}
			if metadata.Tags != nil {
				tags = *metadata.Tags
			}
			if metadata.SourceName != nil {
				sourceName = strings.TrimSpace(*metadata.SourceName)
			}
			if metadata.SourceURL != nil {
				sourceURL = strings.TrimSpace(*metadata.SourceURL)
			}
			if metadata.UsageNote != nil {
				usageNote = strings.TrimSpace(*metadata.UsageNote)
			}
		}
		licenseNote = "推荐人已授权出彩及用户使用，包括商业用途；版权归原权利人所有。"
		if title == "" || utf8.RuneCountInString(title) > 240 {
			return nil, BadAuthRequest("官方素材标题不能为空且不能超过 240 个字符")
		}
		if utf8.RuneCountInString(description) > 500 || utf8.RuneCountInString(sourceName) > 240 || utf8.RuneCountInString(sourceURL) > 500 || utf8.RuneCountInString(licenseNote) > 500 || utf8.RuneCountInString(usageNote) > 500 {
			return nil, BadAuthRequest("官方素材信息长度超出限制")
		}
		category = string(model.NormalizeAssetCategory(model.AssetCategory(category), asset.Kind))
		normalizedTags := model.NormalizeOfficialAssetTags(tags)
		if len(normalizedTags) > model.OfficialAssetTagMaxCount {
			return nil, BadAuthRequest("官方素材标签最多 20 个")
		}
		for _, tag := range normalizedTags {
			if utf8.RuneCountInString(tag) > model.OfficialAssetTagMaxRunes {
				return nil, BadAuthRequest("单个标签不能超过 40 个字符")
			}
		}
		tagsJSON, e := model.EncodeOfficialAssetTags(normalizedTags)
		if e != nil {
			return nil, e
		}
		oa := &model.OfficialAsset{ID: "oas_" + kernel.NewID(), ResourceID: resourceID, Title: title, Description: description, MediaType: media, Category: model.AssetCategory(category), TagsJSON: tagsJSON, SourceName: sourceName, SourceURL: sourceURL, LicenseNote: licenseNote, UsageNote: usageNote, Status: model.OfficialAssetStatusPublished, CreatedBy: user.ID, CreatedAt: now, UpdatedAt: now, PublishedAt: &now}
		if asset.Kind == "entity" {
			oa.CharacterSnapshotJSON = submittedCharacterSnapshot
		}
		fields["official_asset_id"] = oa.ID
		if e = s.repo.ApproveOfficialAssetRecommendation(row.ID, oa, fields); e != nil {
			return nil, e
		}
		row.OfficialAssetID = oa.ID
	} else if err = s.repo.UpdateOfficialAssetRecommendation(row.ID, fields); err != nil {
		return nil, err
	}
	row.Status = status
	row.ReviewerID = user.ID
	row.ReviewerNote = strings.TrimSpace(note)
	row.ReviewedAt = &now
	return row, nil
}
func actionToRecommendationStatus(a string) model.OfficialAssetRecommendationStatus {
	switch a {
	case "approve":
		return model.OfficialAssetRecommendationApproved
	case "reject":
		return model.OfficialAssetRecommendationRejected
	default:
		return model.OfficialAssetRecommendationChangesRequested
	}
}
