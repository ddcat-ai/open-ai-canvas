package app

import (
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

type UpdateAnnouncement struct {
	Enabled        bool            `json:"enabled"`
	CurrentVersion string          `json:"currentVersion"`
	Releases       []UpdateRelease `json:"releases"`
}

type UpdateRelease struct {
	ID      string        `json:"id"`
	Version string        `json:"version"`
	Title   string        `json:"title"`
	Date    string        `json:"date"`
	Blocks  []UpdateBlock `json:"blocks"`
}

type UpdateBlock struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Text       string `json:"text"`
	ResourceID string `json:"resourceId"`
	Caption    string `json:"caption"`
	Layout     string `json:"layout"`
	MediaURL   string `json:"mediaUrl,omitempty"`
}

func normalizeUpdateAnnouncement(value UpdateAnnouncement) (UpdateAnnouncement, error) {
	value.CurrentVersion = normalizeAppearanceSingleLine(value.CurrentVersion)
	if err := validateAppearanceCopy(value.CurrentVersion, "公告当前版本", 40, value.Enabled); err != nil {
		return value, err
	}
	if len(value.Releases) > 30 {
		return value, BadAuthRequest("更新公告最多 30 个版本")
	}
	if value.Enabled && len(value.Releases) == 0 {
		return value, BadAuthRequest("开启自定义更新公告前请添加版本和内容")
	}
	seen := map[string]bool{}
	versions := map[string]bool{}
	total := 0
	currentFound := false
	for i := range value.Releases {
		r := &value.Releases[i]
		r.ID, r.Version = strings.TrimSpace(r.ID), normalizeAppearanceSingleLine(r.Version)
		r.Title, r.Date = normalizeAppearanceSingleLine(r.Title), strings.TrimSpace(r.Date)
		if r.ID == "" || len(r.ID) > 80 || seen[r.ID] {
			return value, BadAuthRequest("公告版本标识无效或重复")
		}
		seen[r.ID] = true
		if err := validateAppearanceCopy(r.Version, "公告版本号", 40, true); err != nil {
			return value, err
		}
		if versions[r.Version] {
			return value, BadAuthRequest("公告版本号不能重复")
		}
		versions[r.Version] = true
		if r.Version == value.CurrentVersion {
			currentFound = true
		}
		if err := validateAppearanceCopy(r.Title, "公告标题", 100, false); err != nil {
			return value, err
		}
		if r.Date != "" {
			if _, err := time.Parse("2006-01-02", r.Date); err != nil {
				return value, BadAuthRequest("公告日期须为 YYYY-MM-DD")
			}
		}
		if len(r.Blocks) == 0 || len(r.Blocks) > 50 {
			return value, BadAuthRequest("每个公告版本须包含 1 至 50 个内容块")
		}
		for j := range r.Blocks {
			b := &r.Blocks[j]
			b.ID, b.ResourceID = strings.TrimSpace(b.ID), strings.TrimSpace(b.ResourceID)
			b.Text, b.Caption, b.MediaURL = normalizeAppearanceCopy(b.Text), normalizeAppearanceSingleLine(b.Caption), ""
			if b.ID == "" || len(b.ID) > 80 || seen[b.ID] {
				return value, BadAuthRequest("公告内容块标识无效或重复")
			}
			seen[b.ID] = true
			if b.Layout == "" {
				b.Layout = "full"
			}
			if b.Layout != "full" && b.Layout != "half" {
				return value, BadAuthRequest("公告布局须为整行或半行")
			}
			if err := validateAppearanceCopy(b.Text, "公告正文", 10000, b.Type == "text"); err != nil {
				return value, err
			}
			if err := validateAppearanceCopy(b.Caption, "媒体说明", 200, false); err != nil {
				return value, err
			}
			switch b.Type {
			case "text":
				b.ResourceID = ""
			case "image", "video":
				if b.ResourceID == "" || len(b.ResourceID) > 80 {
					return value, BadAuthRequest("请上传公告图片或视频")
				}
				b.Text = ""
			default:
				return value, BadAuthRequest("公告内容块类型无效")
			}
			total += len(b.Text) + len(b.Caption)
		}
	}
	if total > 200000 {
		return value, BadAuthRequest("公告内容总大小不能超过 200KB")
	}
	if value.Enabled && !currentFound {
		return value, BadAuthRequest("公告当前版本必须对应已添加的版本")
	}
	return value, nil
}

func updateResourceSlot(kind string) string {
	if kind == "video" {
		return AppearanceAssetUpdateVideo
	}
	return AppearanceAssetUpdateImage
}

func updateReferenced(value UpdateAnnouncement, id string) bool {
	for _, release := range value.Releases {
		for _, block := range release.Blocks {
			if block.ResourceID == id && (block.Type == "image" || block.Type == "video") {
				return true
			}
		}
	}
	return false
}

func (s *Service) validateUpdateAnnouncementResources(actor *model.User, value, before UpdateAnnouncement) error {
	for _, release := range value.Releases {
		for _, block := range release.Blocks {
			if block.ResourceID == "" {
				continue
			}
			current := ""
			if updateReferenced(before, block.ResourceID) {
				current = block.ResourceID
			}
			slot := updateResourceSlot(block.Type)
			if err := s.validateAppearanceResource(actor, slot, block.ResourceID, current); err != nil {
				return err
			}
			resource, err := s.repo.Resource(block.ResourceID)
			if err != nil {
				return err
			}
			maxBytes, _ := AppearanceAssetMaxBytes(slot)
			if resource.Size <= 0 || resource.Size > maxBytes {
				return BadAuthRequest("公告媒体大小超过允许范围")
			}
		}
	}
	return nil
}

func publicUpdateAnnouncement(value UpdateAnnouncement, revision string) UpdateAnnouncement {
	if !value.Enabled {
		return UpdateAnnouncement{Releases: []UpdateRelease{}}
	}
	result := value
	result.Releases = append([]UpdateRelease(nil), value.Releases...)
	for i := range result.Releases {
		result.Releases[i].Blocks = append([]UpdateBlock(nil), value.Releases[i].Blocks...)
		for j := range result.Releases[i].Blocks {
			b := &result.Releases[i].Blocks[j]
			if b.ResourceID != "" {
				b.MediaURL = "/api/public/appearance/updates/" + url.PathEscape(b.ResourceID) + "?v=" + url.QueryEscape(revision)
			}
		}
	}
	return result
}

// Public delivery is limited to the currently enabled announcement references.
// Draft previews require an administrator and never expose unrelated resources.
func (s *Service) PrepareUpdateAnnouncementDelivery(actor *model.User, id string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if actor != nil {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	_, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	referenced := updateReferenced(value.Updates, id)
	if actor == nil && (!value.Updates.Enabled || !referenced) {
		return nil, NotFound("公告媒体未发布")
	}
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, NotFound("公告媒体不存在")
	}
	if actor != nil && resource.UserID != actor.ID && !referenced {
		return nil, Forbidden("不能预览其他管理员的未发布媒体")
	}
	if resource.Kind != "image" && resource.Kind != "video" {
		return nil, BadAuthRequest("公告仅支持图片和视频")
	}
	if err := validateAppearanceResourceType(updateResourceSlot(resource.Kind), resource); err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}
