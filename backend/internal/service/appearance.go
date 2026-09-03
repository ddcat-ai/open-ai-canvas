package service

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const appearanceSettingKey = "appearance"

const (
	AppearanceAssetLogo     = "logo"
	AppearanceAssetDarkLogo = "logo-dark"
	AppearanceAssetVideo    = "video"
	AppearanceAssetPoster   = "poster"
)

const (
	appearanceSchemaVersion        = 6
	appearanceLogoMaxBytes   int64 = 5 << 20
	appearancePosterMaxBytes int64 = 10 << 20
	appearanceVideoMaxBytes  int64 = 256 << 20
)

const (
	defaultAppearanceBrandName = "影策"
	defaultAppearanceBrandSlug = "open-ai-canvas"
	defaultAppearanceSkinID    = "classic"
	defaultAppearanceLogoURL   = "/logo.svg"
	defaultAppearanceVideoURL  = "https://boss-shjd.biliapi.net/updream/aniforge/video/video_bbcb00bd-650d-4249-9346-5cd21fd2484c_m1hc-u0-1pu13x-3v1s.mp4"
	defaultAppearancePosterURL = "https://i0.hdslb.com/bfs/aitool/aniforge/image/02933f26-5f1b-49ff-a811-b7f95ee5e5b8_m1hc-u0-sau.jpg"
	defaultAppearanceHeroTitle = "让一个故事，\n从文字走向银幕。"
)

type AppearanceSetting struct {
	SchemaVersion             int                   `json:"schemaVersion"`
	BrandName                 string                `json:"brandName"`
	BrandSlug                 string                `json:"brandSlug"`
	AuthHeroTitle             string                `json:"authHeroTitle"`
	AuthHeroDescription       string                `json:"authHeroDescription"`
	LogoResourceID            string                `json:"logoResourceId"`
	DarkLogoResourceID        string                `json:"darkLogoResourceId"`
	LogoFrameEnabled          bool                  `json:"logoFrameEnabled"`
	AuthVideoResourceID       string                `json:"authVideoResourceId"`
	AuthVideoPosterResourceID string                `json:"authVideoPosterResourceId"`
	SkinID                    string                `json:"skinId"`
	SkinThemes                []AppearanceSkinTheme `json:"skinThemes"`
	SEOTitle                  string                `json:"seoTitle"`
	SEODescription            string                `json:"seoDescription"`
	SEOKeywords               string                `json:"seoKeywords"`
	FooterCopyright           string                `json:"footerCopyright"`
	ICPFilingEnabled          bool                  `json:"icpFilingEnabled"`
	ICPFilingNumber           string                `json:"icpFilingNumber"`
}

type PublicAppearanceSetting struct {
	SchemaVersion             int                 `json:"schemaVersion"`
	BrandName                 string              `json:"brandName"`
	BrandSlug                 string              `json:"brandSlug"`
	AuthHeroTitle             string              `json:"authHeroTitle"`
	AuthHeroDescription       string              `json:"authHeroDescription"`
	LogoURL                   string              `json:"logoUrl"`
	DarkLogoURL               string              `json:"darkLogoUrl"`
	LogoFrameEnabled          bool                `json:"logoFrameEnabled"`
	AuthVideoURL              string              `json:"authVideoUrl"`
	AuthVideoPosterURL        string              `json:"authVideoPosterUrl"`
	SkinID                    string              `json:"skinId"`
	ActiveSkin                AppearanceSkinTheme `json:"activeSkin"`
	SEOTitle                  string              `json:"seoTitle"`
	SEODescription            string              `json:"seoDescription"`
	SEOKeywords               string              `json:"seoKeywords"`
	FooterCopyright           string              `json:"footerCopyright"`
	ICPFilingEnabled          bool                `json:"icpFilingEnabled"`
	ICPFilingNumber           string              `json:"icpFilingNumber"`
	LogoConfigured            bool                `json:"logoConfigured"`
	DarkLogoConfigured        bool                `json:"darkLogoConfigured"`
	AuthVideoConfigured       bool                `json:"authVideoConfigured"`
	AuthVideoPosterConfigured bool                `json:"authVideoPosterConfigured"`
	Configured                bool                `json:"configured"`
	Revision                  string              `json:"revision"`
	UpdatedAt                 time.Time           `json:"updatedAt,omitempty"`
}

type AdminAppearanceSetting struct {
	AppearanceSetting
	Public     PublicAppearanceSetting `json:"public"`
	Configured bool                    `json:"configured"`
	UpdatedBy  string                  `json:"updatedBy,omitempty"`
	CreatedAt  time.Time               `json:"createdAt,omitempty"`
	UpdatedAt  time.Time               `json:"updatedAt,omitempty"`
}

func defaultAppearanceSetting() AppearanceSetting {
	return AppearanceSetting{
		SchemaVersion:    appearanceSchemaVersion,
		BrandName:        defaultAppearanceBrandName,
		BrandSlug:        defaultAppearanceBrandSlug,
		AuthHeroTitle:    defaultAppearanceHeroTitle,
		LogoFrameEnabled: true,
		SkinID:           defaultAppearanceSkinID,
		SkinThemes:       defaultAppearanceSkinThemes(),
	}
}

func AppearanceAssetMaxBytes(slot string) (int64, error) {
	switch strings.TrimSpace(slot) {
	case AppearanceAssetLogo, AppearanceAssetDarkLogo:
		return appearanceLogoMaxBytes, nil
	case AppearanceAssetPoster:
		return appearancePosterMaxBytes, nil
	case AppearanceAssetVideo:
		return appearanceVideoMaxBytes, nil
	default:
		return 0, BadAuthRequest("外观资源类型无效")
	}
}

func (s *Service) Appearance() (*PublicAppearanceSetting, error) {
	setting, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	return publicAppearanceSetting(setting, value), nil
}

func (s *Service) AdminAppearance(actor *model.User) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	result := &AdminAppearanceSetting{
		AppearanceSetting: value,
		Public:            *publicAppearanceSetting(setting, value),
		Configured:        setting != nil,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result, nil
}

func (s *Service) UpdateAppearance(actor *model.User, value AppearanceSetting) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	value.SchemaVersion = appearanceSchemaVersion
	value.BrandName = strings.TrimSpace(value.BrandName)
	value.BrandSlug = strings.ToLower(strings.TrimSpace(value.BrandSlug))
	value.AuthHeroTitle = normalizeAppearanceCopy(value.AuthHeroTitle)
	value.AuthHeroDescription = normalizeAppearanceCopy(value.AuthHeroDescription)
	value.LogoResourceID = strings.TrimSpace(value.LogoResourceID)
	value.DarkLogoResourceID = strings.TrimSpace(value.DarkLogoResourceID)
	value.AuthVideoResourceID = strings.TrimSpace(value.AuthVideoResourceID)
	value.AuthVideoPosterResourceID = strings.TrimSpace(value.AuthVideoPosterResourceID)
	value.SkinID = strings.TrimSpace(value.SkinID)
	if len(value.SkinThemes) == 0 {
		value.SkinThemes = defaultAppearanceSkinThemes()
	}
	value.SkinThemes = normalizeAppearanceSkinThemes(value.SkinThemes)
	value.SEOTitle = normalizeAppearanceSingleLine(value.SEOTitle)
	value.SEODescription = normalizeAppearanceCopy(value.SEODescription)
	value.SEOKeywords = normalizeAppearanceSingleLine(value.SEOKeywords)
	value.FooterCopyright = normalizeAppearanceSingleLine(value.FooterCopyright)
	value.ICPFilingNumber = normalizeAppearanceSingleLine(value.ICPFilingNumber)
	if err := validateAppearanceSetting(value); err != nil {
		return nil, err
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	current, before, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	for _, candidate := range []struct {
		slot       string
		resourceID string
		currentID  string
	}{
		{slot: AppearanceAssetLogo, resourceID: value.LogoResourceID, currentID: before.LogoResourceID},
		{slot: AppearanceAssetDarkLogo, resourceID: value.DarkLogoResourceID, currentID: before.DarkLogoResourceID},
		{slot: AppearanceAssetVideo, resourceID: value.AuthVideoResourceID, currentID: before.AuthVideoResourceID},
		{slot: AppearanceAssetPoster, resourceID: value.AuthVideoPosterResourceID, currentID: before.AuthVideoPosterResourceID},
	} {
		if err := s.validateAppearanceResource(actor, candidate.slot, candidate.resourceID, candidate.currentID); err != nil {
			return nil, err
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "appearance.update", "system_setting", appearanceSettingKey, "更新外观配置", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return s.AdminAppearance(actor)
}

func (s *Service) ResetAppearance(actor *model.User) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	_, before, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteSystemSetting(appearanceSettingKey); err != nil {
		return nil, err
	}
	after := defaultAppearanceSetting()
	if err := s.appendAdminAudit(actor, "appearance.reset", "system_setting", appearanceSettingKey, "恢复影策默认品牌标识", map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return s.AdminAppearance(actor)
}

func (s *Service) UploadAppearanceAsset(actor *model.User, slot string, header *multipart.FileHeader) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	mimeType, err := validateAppearanceUpload(slot, header)
	if err != nil {
		return nil, err
	}
	// UploadResource otherwise trusts a non-empty declared MIME. Replace it with
	// the sniffed value so the persisted resource contract matches the bytes.
	header.Header.Set("Content-Type", mimeType)
	kind := "image"
	if slot == AppearanceAssetVideo {
		kind = "video"
	}
	resource, err := s.UploadResource(actor.ID, header, kind, 0, 0, 0)
	if err != nil {
		return nil, err
	}
	resource.PublicURL = ""
	return resource, nil
}

func (s *Service) OpenAppearanceAsset(slot string, rangeHeader string) (*ResourceStream, error) {
	_, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	resourceID := appearanceResourceID(value, slot)
	if resourceID == "" {
		return nil, NotFound("未配置该外观资源")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("外观资源不存在")
		}
		return nil, err
	}
	if err := validateAppearanceResourceType(slot, resource); err != nil {
		return nil, err
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) appearanceResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := make(map[string][]AdminResourceReferenceView)
	_, value, err := s.readAppearance()
	if err != nil {
		// Invalid appearance JSON must fail closed for deletion. The caller turns
		// this sentinel into a visible blocked reference instead of deleting files.
		for _, resourceID := range resourceIDs {
			result[resourceID] = []AdminResourceReferenceView{{Kind: "外观", ID: appearanceSettingKey, Title: "外观配置无法读取"}}
		}
		return result
	}
	candidates := []struct {
		resourceID string
		title      string
	}{
		{resourceID: value.LogoResourceID, title: "浅色模式品牌 Logo"},
		{resourceID: value.DarkLogoResourceID, title: "深色模式品牌 Logo"},
		{resourceID: value.AuthVideoResourceID, title: "登录页品牌视频"},
		{resourceID: value.AuthVideoPosterResourceID, title: "登录页视频封面"},
	}
	wanted := make(map[string]struct{}, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		wanted[resourceID] = struct{}{}
	}
	for _, candidate := range candidates {
		if candidate.resourceID == "" {
			continue
		}
		if _, exists := wanted[candidate.resourceID]; exists {
			result[candidate.resourceID] = appendUniqueAdminResourceReference(result[candidate.resourceID], AdminResourceReferenceView{Kind: "外观", ID: appearanceSettingKey, Title: candidate.title})
		}
	}
	return result
}

func (s *Service) readAppearance() (*model.SystemSetting, AppearanceSetting, error) {
	setting, err := s.repo.SystemSetting(appearanceSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultAppearanceSetting(), nil
	}
	if err != nil {
		return nil, AppearanceSetting{}, err
	}
	value := defaultAppearanceSetting()
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, AppearanceSetting{}, errors.New("外观配置格式无效")
	}
	value.SchemaVersion = appearanceSchemaVersion
	value.BrandName = strings.TrimSpace(value.BrandName)
	if value.BrandName == "" {
		value.BrandName = defaultAppearanceBrandName
	}
	value.BrandSlug = strings.ToLower(strings.TrimSpace(value.BrandSlug))
	if value.BrandSlug == "" {
		value.BrandSlug = defaultAppearanceBrandSlug
	}
	value.AuthHeroTitle = normalizeAppearanceCopy(value.AuthHeroTitle)
	if value.AuthHeroTitle == "" {
		value.AuthHeroTitle = defaultAppearanceHeroTitle
	}
	value.AuthHeroDescription = normalizeAppearanceCopy(value.AuthHeroDescription)
	value.SkinID = strings.TrimSpace(value.SkinID)
	if value.SkinID == "" {
		value.SkinID = defaultAppearanceSkinID
	}
	if len(value.SkinThemes) == 0 {
		value.SkinThemes = defaultAppearanceSkinThemes()
	}
	value.SkinThemes = normalizeAppearanceSkinThemes(value.SkinThemes)
	value.SEOTitle = normalizeAppearanceSingleLine(value.SEOTitle)
	value.SEODescription = normalizeAppearanceCopy(value.SEODescription)
	value.SEOKeywords = normalizeAppearanceSingleLine(value.SEOKeywords)
	value.FooterCopyright = normalizeAppearanceSingleLine(value.FooterCopyright)
	value.ICPFilingNumber = normalizeAppearanceSingleLine(value.ICPFilingNumber)
	return setting, value, nil
}

func validateAppearanceSetting(value AppearanceSetting) error {
	if value.BrandName == "" || utf8.RuneCountInString(value.BrandName) > 40 {
		return BadAuthRequest("品牌名称必须为 1 到 40 个字符")
	}
	for _, char := range value.BrandName {
		if unicode.IsControl(char) {
			return BadAuthRequest("品牌名称不能包含控制字符")
		}
	}
	if !validAppearanceBrandSlug(value.BrandSlug) {
		return BadAuthRequest("英文品牌标识须为 1 到 48 位小写字母、数字或连字符，且不能以连字符开头或结尾")
	}
	if err := validateAppearanceCopy(value.AuthHeroTitle, "登录页主标题", 80, true); err != nil {
		return err
	}
	if err := validateAppearanceCopy(value.AuthHeroDescription, "登录页说明文案", 160, false); err != nil {
		return err
	}
	if err := validateAppearanceSkinThemes(value.SkinThemes, value.SkinID); err != nil {
		return err
	}
	for _, field := range []struct {
		value string
		label string
		max   int
	}{
		{value.SEOTitle, "SEO 标题", 70},
		{value.SEODescription, "SEO 描述", 200},
		{value.SEOKeywords, "SEO 关键词", 300},
		{value.FooterCopyright, "版权信息", 160},
		{value.ICPFilingNumber, "备案号", 64},
	} {
		if err := validateAppearanceCopy(field.value, field.label, field.max, false); err != nil {
			return err
		}
	}
	if value.ICPFilingEnabled && value.ICPFilingNumber == "" {
		return BadAuthRequest("显示备案号前请先填写备案号")
	}
	for _, resourceID := range []string{value.LogoResourceID, value.DarkLogoResourceID, value.AuthVideoResourceID, value.AuthVideoPosterResourceID} {
		if len(resourceID) > 80 {
			return BadAuthRequest("外观资源 ID 无效")
		}
	}
	return nil
}

func normalizeAppearanceCopy(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n"))
}

func normalizeAppearanceSingleLine(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", " "), "\r", " "))
}

func validAppearanceBrandSlug(value string) bool {
	if len(value) == 0 || len(value) > 48 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

func validateAppearanceCopy(value string, label string, maxRunes int, required bool) error {
	if required && value == "" {
		return BadAuthRequest(label + "不能为空")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s不能超过 %d 个字符", label, maxRunes))
	}
	for _, char := range value {
		if unicode.IsControl(char) && char != '\n' {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

func (s *Service) validateAppearanceResource(actor *model.User, slot string, resourceID string, currentID string) error {
	if resourceID == "" {
		return nil
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		return BadAuthRequest("选择的外观资源不存在")
	}
	if resourceID != currentID && resource.UserID != actor.ID {
		return Forbidden("只能使用当前管理员上传的外观资源")
	}
	return validateAppearanceResourceType(slot, resource)
}

func validateAppearanceResourceType(slot string, resource *model.Resource) error {
	if resource == nil || resource.Status != model.ResourceStatusReady {
		return BadAuthRequest("外观资源尚未上传完成")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(resource.MimeType, ";")[0]))
	allowed := appearanceAllowedMIMETypes(slot)
	if _, exists := allowed[mimeType]; !exists {
		return BadAuthRequest("外观资源文件类型不受支持")
	}
	if slot == AppearanceAssetVideo && resource.Kind != "video" {
		return BadAuthRequest("登录页品牌视频必须是视频资源")
	}
	if slot != AppearanceAssetVideo && resource.Kind != "image" {
		return BadAuthRequest("Logo 和视频封面必须是图片资源")
	}
	return nil
}

func validateAppearanceUpload(slot string, header *multipart.FileHeader) (string, error) {
	maxBytes, err := AppearanceAssetMaxBytes(slot)
	if err != nil {
		return "", err
	}
	if header == nil || header.Size <= 0 || header.Size > maxBytes {
		return "", BadAuthRequest(fmt.Sprintf("%s大小必须在 %dMB 以内", appearanceAssetLabel(slot), maxBytes>>20))
	}
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]byte, 512)
	read, readErr := file.Read(buffer)
	if readErr != nil && read == 0 {
		return "", BadAuthRequest("外观资源内容无法读取")
	}
	mimeType := detectAppearanceMIME(slot, buffer[:read], header.Size)
	if _, exists := appearanceAllowedMIMETypes(slot)[mimeType]; !exists {
		return "", BadAuthRequest(appearanceAssetLabel(slot) + "文件类型不受支持")
	}
	return mimeType, nil
}

func detectAppearanceMIME(slot string, data []byte, fileSize int64) string {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if slot != AppearanceAssetVideo || mimeType == "video/mp4" || len(data) < 12 {
		return mimeType
	}
	// Go's generic sniffer only recognises a subset of MP4 compatible brands.
	// Accept a structurally valid ISO Base Media File Format `ftyp` first box,
	// which covers common `isom`, `iso2`, `avc1`, `M4V ` and similar MP4 files.
	boxSize := int64(binary.BigEndian.Uint32(data[:4]))
	if string(data[4:8]) == "ftyp" && boxSize >= 12 && boxSize%4 == 0 && boxSize <= fileSize {
		return "video/mp4"
	}
	return mimeType
}

func appearanceAllowedMIMETypes(slot string) map[string]struct{} {
	if slot == AppearanceAssetVideo {
		return map[string]struct{}{"video/mp4": {}, "video/webm": {}}
	}
	return map[string]struct{}{"image/png": {}, "image/jpeg": {}, "image/webp": {}}
}

func appearanceAssetLabel(slot string) string {
	switch slot {
	case AppearanceAssetLogo:
		return "浅色模式品牌 Logo"
	case AppearanceAssetDarkLogo:
		return "深色模式品牌 Logo"
	case AppearanceAssetPoster:
		return "视频封面"
	case AppearanceAssetVideo:
		return "品牌视频"
	default:
		return "外观资源"
	}
}

func appearanceResourceID(value AppearanceSetting, slot string) string {
	switch slot {
	case AppearanceAssetLogo:
		return value.LogoResourceID
	case AppearanceAssetDarkLogo:
		return value.DarkLogoResourceID
	case AppearanceAssetVideo:
		return value.AuthVideoResourceID
	case AppearanceAssetPoster:
		return value.AuthVideoPosterResourceID
	default:
		return ""
	}
}

func publicAppearanceSetting(setting *model.SystemSetting, value AppearanceSetting) *PublicAppearanceSetting {
	revision := "builtin"
	if setting != nil {
		revision = strconv.FormatInt(setting.UpdatedAt.UTC().UnixNano(), 36)
	}
	result := &PublicAppearanceSetting{
		SchemaVersion:       appearanceSchemaVersion,
		BrandName:           value.BrandName,
		BrandSlug:           value.BrandSlug,
		AuthHeroTitle:       value.AuthHeroTitle,
		AuthHeroDescription: value.AuthHeroDescription,
		LogoURL:             defaultAppearanceLogoURL,
		DarkLogoURL:         defaultAppearanceLogoURL,
		LogoFrameEnabled:    value.LogoFrameEnabled,
		AuthVideoURL:        defaultAppearanceVideoURL,
		AuthVideoPosterURL:  defaultAppearancePosterURL,
		SkinID:              value.SkinID,
		ActiveSkin:          activeAppearanceSkin(value.SkinThemes, value.SkinID),
		SEOTitle:            effectiveAppearanceSEOTitle(value),
		SEODescription:      effectiveAppearanceSEODescription(value),
		SEOKeywords:         value.SEOKeywords,
		FooterCopyright:     effectiveAppearanceCopyright(value),
		ICPFilingEnabled:    value.ICPFilingEnabled && value.ICPFilingNumber != "",
		ICPFilingNumber:     value.ICPFilingNumber,
		Configured:          setting != nil,
		Revision:            revision,
	}
	if setting != nil {
		result.UpdatedAt = setting.UpdatedAt
	}
	if value.LogoResourceID != "" || value.DarkLogoResourceID != "" {
		result.LogoConfigured = true
		if value.LogoResourceID != "" {
			result.LogoURL = appearanceAssetURL(AppearanceAssetLogo, revision)
		} else {
			result.LogoURL = appearanceAssetURL(AppearanceAssetDarkLogo, revision)
		}
		if value.DarkLogoResourceID != "" {
			result.DarkLogoConfigured = true
			result.DarkLogoURL = appearanceAssetURL(AppearanceAssetDarkLogo, revision)
		} else {
			result.DarkLogoURL = result.LogoURL
		}
		if value.LogoResourceID == "" {
			result.LogoURL = result.DarkLogoURL
		}
	}
	if value.AuthVideoResourceID != "" {
		result.AuthVideoConfigured = true
		result.AuthVideoURL = appearanceAssetURL(AppearanceAssetVideo, revision)
		if value.AuthVideoPosterResourceID == "" {
			// A custom video must not briefly reveal the built-in poster while its
			// first frame loads. An optional custom poster may be configured below.
			result.AuthVideoPosterURL = ""
		}
	}
	if value.AuthVideoPosterResourceID != "" {
		result.AuthVideoPosterConfigured = true
		result.AuthVideoPosterURL = appearanceAssetURL(AppearanceAssetPoster, revision)
	}
	return result
}

func effectiveAppearanceSEOTitle(value AppearanceSetting) string {
	if value.SEOTitle != "" {
		return value.SEOTitle
	}
	return value.BrandName
}

func effectiveAppearanceSEODescription(value AppearanceSetting) string {
	if value.SEODescription != "" {
		return value.SEODescription
	}
	return value.BrandName + "，面向 AI 影视与短剧创作的工作台。"
}

func effectiveAppearanceCopyright(value AppearanceSetting) string {
	if value.FooterCopyright != "" {
		return value.FooterCopyright
	}
	return fmt.Sprintf("© %d %s. All rights reserved.", time.Now().Year(), value.BrandName)
}

func (s *Service) appearanceBrandName() string {
	brandName, _ := s.appearanceIdentity()
	return brandName
}

func (s *Service) appearanceIdentity() (string, string) {
	_, value, err := s.readAppearance()
	if err != nil || strings.TrimSpace(value.BrandName) == "" {
		return defaultAppearanceBrandName, defaultAppearanceBrandSlug
	}
	return value.BrandName, value.BrandSlug
}

func appearanceAssetURL(slot string, revision string) string {
	return "/api/public/appearance/assets/" + url.PathEscape(slot) + "?v=" + url.QueryEscape(revision)
}
