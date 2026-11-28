package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"yingce/backend/internal/kernel"

	"gorm.io/gorm"
	"yingce/backend/internal/outbound"
)

const (
	jimengAppID             = "513695"
	jimengMaxResponseBytes  = 48 << 20
	jimengMaxNodes          = 2000
	jimengMaxConnections    = 10000
	jimengMaxIDLength       = 128
	jimengMaxSize           = 100000.0
	jimengResourceBatchSize = 80
	jimengResourceReady     = 1000
	jimengImageResource     = 1
	jimengVideoResource     = 2
	jimengTitleRunes        = 40
	jimengMaxParentDepth    = 16
	jimengPreviewMaxWidth   = 960
	jimengUntrustedMedia    = "即梦素材地址不是官方 CDN 域名"
)

// jimengAPIBase 是即梦智能画布的公开接口。声明为变量，测试时指向本地服务。
var jimengAPIBase = "https://jimeng.jianying.com/octo_api/v1/"

var (
	jimengProjectIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	// 只接受已核验的即梦/剪映 CDN 域名族；数字前缀节点由官方按地区分配，不能按品牌前缀放行同名域。
	jimengImageHostPattern = regexp.MustCompile(`^p\d+-(?:dreamina-sign\.byteimg\.com|sign\.douyinpic\.com)$`)
	jimengVideoHostPattern = regexp.MustCompile(`^v\d+-dreamina-de\.jianying\.com$`)
)

type JimengImportRequest struct {
	ProjectID string `json:"projectId"`
}

type JimengImportResult struct {
	BatchID                 string                   `json:"batchId"`
	BatchCreatedAt          time.Time                `json:"batchCreatedAt"`
	ProjectID               string                   `json:"projectId"`
	ProjectName             string                   `json:"projectName"`
	Nodes                   []JimengCanvasNode       `json:"nodes"`
	Connections             []JimengCanvasConnection `json:"connections"`
	ImportedNodeCount       int                      `json:"importedNodeCount"`
	ImportedConnectionCount int                      `json:"importedConnectionCount"`
	SkippedNodes            []JimengImportIssue      `json:"skippedNodes"`
	SkippedConnections      []JimengImportIssue      `json:"skippedConnections"`
	Warnings                []JimengImportWarning    `json:"warnings"`
	MultiResultNodeCount    int                      `json:"multiResultNodeCount"`
	PlaceholderNodeCount    int                      `json:"placeholderNodeCount"`
	FrameNodeCount          int                      `json:"frameNodeCount"`
	// MediaExpiresAt 是本批临时媒体地址中最早的过期时间。视频地址约一小时后失效，
	// 导入方必须先转存素材，不能把临时地址当作持久内容。
	MediaExpiresAt time.Time `json:"mediaExpiresAt,omitzero"`
}

type JimengCanvasNode struct {
	ID             string               `json:"id"`
	Type           string               `json:"type"`
	Title          string               `json:"title"`
	ParentID       string               `json:"parentId,omitempty"`
	X              float64              `json:"x"`
	Y              float64              `json:"y"`
	Width          float64              `json:"width"`
	Height         float64              `json:"height"`
	Content        string               `json:"content"`
	PreviewContent string               `json:"previewContent,omitempty"`
	Prompt         string               `json:"prompt,omitempty"`
	Model          string               `json:"model,omitempty"`
	Size           string               `json:"size,omitempty"`
	Quality        string               `json:"quality,omitempty"`
	Seconds        string               `json:"seconds,omitempty"`
	VQuality       string               `json:"vquality,omitempty"`
	NaturalWidth   int                  `json:"naturalWidth,omitempty"`
	NaturalHeight  int                  `json:"naturalHeight,omitempty"`
	DurationMs     int64                `json:"durationMs,omitempty"`
	MimeType       string               `json:"mimeType,omitempty"`
	Status         string               `json:"status,omitempty"`
	Metadata       JimengImportMetadata `json:"metadata"`
}

type JimengImportMetadata struct {
	Provider   string    `json:"provider"`
	ProjectID  string    `json:"projectId"`
	NodeID     string    `json:"nodeId"`
	ResourceID string    `json:"mediaResourceId,omitempty"`
	BatchID    string    `json:"batchId"`
	SourceType string    `json:"sourceType,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt,omitzero"`
}

type JimengCanvasConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type JimengImportIssue struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Reason string `json:"reason"`
}

type JimengImportWarning struct {
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

type JimengMediaRequest struct {
	ProjectID   string   `json:"projectId"`
	ResourceIDs []string `json:"resourceIds"`
}

// JimengMedia 是一个即梦素材当前可用的临时地址及其媒体规格。
type JimengMedia struct {
	ResourceID string    `json:"resourceId"`
	Kind       string    `json:"kind"`
	URL        string    `json:"url"`
	PreviewURL string    `json:"previewUrl,omitempty"`
	MimeType   string    `json:"mimeType,omitempty"`
	Width      int       `json:"width,omitempty"`
	Height     int       `json:"height,omitempty"`
	DurationMs int64     `json:"durationMs,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt,omitzero"`
}

type JimengResolvedMedia struct {
	ResourceID string       `json:"resourceId"`
	Media      *JimengMedia `json:"media,omitempty"`
	Error      string       `json:"error,omitempty"`
}

type jimengEnvelope struct {
	Ret    json.Number     `json:"ret"`
	Errmsg string          `json:"errmsg"`
	Data   json.RawMessage `json:"data"`
}

type jimengProject struct {
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
}

type jimengDraftDetail struct {
	Project     jimengProject     `json:"project"`
	DraftJSON   string            `json:"draft_json"`
	ShareReview jimengShareReview `json:"share_review"`
}

// jimengShareReview 记录分享审查信息；分享方隐藏的节点会列在 blocked_node_ids。
type jimengShareReview struct {
	BlockedNodeIDs []string `json:"blocked_node_ids"`
}

func (detail jimengDraftDetail) draft() (*jimengDraft, error) {
	if strings.TrimSpace(detail.DraftJSON) == "" {
		return nil, kernel.NewAppError(http.StatusBadGateway, "即梦画布没有可导入的草稿内容")
	}
	var draft jimengDraft
	if err := json.Unmarshal([]byte(detail.DraftJSON), &draft); err != nil {
		return nil, kernel.NewAppError(http.StatusBadGateway, "即梦画布草稿格式无效")
	}
	return &draft, nil
}

type jimengDraft struct {
	Nodes []jimengRawNode `json:"nodes"`
	Edges []jimengRawEdge `json:"edges"`
}

type jimengRawNode struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	ParentID string `json:"parentId"`
	Layout   struct {
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"layout"`
	Data struct {
		Title           string                 `json:"title"`
		Name            string                 `json:"name"`
		Source          string                 `json:"source"`
		ResourceID      string                 `json:"resourceId"`
		GenerationDraft *jimengGenerationDraft `json:"generationDraft"`
		ResourceBatches []jimengResourceBatch  `json:"resourceBatches"`
	} `json:"data"`
}

type jimengResourceBatch struct {
	ResourceIDs []string `json:"resourceIds"`
}

type jimengGenerationDraft struct {
	Parts           []jimengPromptPart `json:"parts"`
	ContentSettings map[string]any     `json:"contentSettings"`
}

type jimengPromptPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type jimengRawEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type jimengResourcePage struct {
	Resources []jimengResource           `json:"resources"`
	ImageURLs map[string]jimengImageURLs `json:"image_urls"`
	MediaURLs map[string]jimengMediaURLs `json:"media_urls"`
}

type jimengResource struct {
	ResourceID string           `json:"resource_id"`
	Type       int              `json:"type"`
	Status     int              `json:"status"`
	Image      *jimengImageMeta `json:"image"`
	Video      *jimengVideoMeta `json:"video"`
}

type jimengImageMeta struct {
	URI    string `json:"uri"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
}

type jimengVideoMeta struct {
	VID      string  `json:"vid"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	Duration float64 `json:"duration"`
}

type jimengSizedURL struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
}

type jimengImageURLs struct {
	URL              string                    `json:"url"`
	ResolutionSource map[string]jimengSizedURL `json:"resolution_source"`
}

type jimengMediaURLs struct {
	URL      string `json:"url"`
	CoverURL string `json:"cover_url"`
}

type jimengResourceSet struct {
	Resources map[string]jimengResource
	Images    map[string]jimengImageURLs
	Media     map[string]jimengMediaURLs
}

// 读取公开分享前先校验目标画布归属，避免把导入结果写入他人画布。
func (s *Service) ImportJimeng(userID, canvasProjectID, projectID string) (*JimengImportResult, error) {
	canvasProjectID, projectID, err := s.authorizeJimengImport(userID, canvasProjectID, projectID)
	if err != nil {
		return nil, err
	}
	var detail jimengDraftDetail
	if err := postJimengJSON("project/draft/get", map[string]any{
		"project_id":           projectID,
		"draft_version":        0,
		"need_draft_json":      true,
		"share_review_version": 1,
	}, &detail); err != nil {
		return nil, err
	}
	draft, err := detail.draft()
	if err != nil {
		return nil, err
	}
	resources, err := fetchJimengResources(projectID, jimengDraftResourceIDs(draft.Nodes))
	if err != nil {
		return nil, err
	}
	return adaptJimengDraft(detail, draft, resources, projectID)
}

// ResolveJimengMedia 为指定素材重新换取临时地址。即梦地址带签名且短期有效，
// 转存和续期都必须现取，不能复用导入时返回的地址。
func (s *Service) ResolveJimengMedia(userID, canvasProjectID, projectID string, resourceIDs []string) ([]JimengResolvedMedia, error) {
	canvasProjectID, projectID, err := s.authorizeJimengImport(userID, canvasProjectID, projectID)
	if err != nil {
		return nil, err
	}
	if len(resourceIDs) == 0 || len(resourceIDs) > jimengResourceBatchSize {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("单次最多处理 %d 个素材", jimengResourceBatchSize))
	}
	ids := make([]string, 0, len(resourceIDs))
	seen := make(map[string]struct{}, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		resourceID = strings.ToLower(strings.TrimSpace(resourceID))
		if !jimengProjectIDPattern.MatchString(resourceID) {
			return nil, kernel.BadAuthRequest("即梦素材 ID 格式无效")
		}
		if _, exists := seen[resourceID]; exists {
			continue
		}
		seen[resourceID] = struct{}{}
		ids = append(ids, resourceID)
	}
	resources, err := fetchJimengResources(projectID, ids)
	if err != nil {
		return nil, err
	}
	resolved := make([]JimengResolvedMedia, 0, len(ids))
	for _, resourceID := range ids {
		item := JimengResolvedMedia{ResourceID: resourceID}
		item.Media, item.Error = resources.resolve(resourceID)
		resolved = append(resolved, item)
	}
	return resolved, nil
}

func (s *Service) authorizeJimengImport(userID, canvasProjectID, projectID string) (string, string, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	projectID = strings.ToLower(strings.TrimSpace(projectID))
	if userID == "" || canvasProjectID == "" {
		return "", "", kernel.Unauthorized("请先打开已同步的故事创作画布")
	}
	if !jimengProjectIDPattern.MatchString(projectID) {
		return "", "", kernel.BadAuthRequest("即梦画布 ID 格式无效")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		// 新建后尚未同步到云端的画布在服务端还没有记录，明确提示保存而不是报系统错误。
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", kernel.NotFound("目标画布尚未同步到云端，请先保存画布后重试")
		}
		return "", "", err
	}
	return canvasProjectID, projectID, nil
}

func postJimengJSON(path string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint, err := url.Parse(strings.TrimRight(jimengAPIBase, "/") + "/" + path)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("appid", jimengAppID)
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(30 * time.Second)
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("即梦接口不允许重定向")
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return kernel.NewAppError(http.StatusGatewayTimeout, "即梦请求超时，请稍后重试")
		}
		return kernel.NewAppError(http.StatusBadGateway, "即梦请求失败，请检查网络或分享链接")
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, jimengMaxResponseBytes+1))
	if err != nil {
		return kernel.NewAppError(http.StatusBadGateway, "读取即梦响应失败")
	}
	if len(responseBody) > jimengMaxResponseBytes {
		return kernel.NewAppError(http.StatusBadGateway, "即梦画布响应过大")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("即梦请求失败（HTTP %d）", resp.StatusCode))
	}
	var envelope jimengEnvelope
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return kernel.NewAppError(http.StatusBadGateway, "即梦响应格式无效")
	}
	// 即梦的业务失败也返回 HTTP 200，必须判断 ret。
	if envelope.Ret != "0" {
		return jimengBusinessError(envelope.Errmsg)
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return kernel.NewAppError(http.StatusBadGateway, "即梦画布数据格式无效")
	}
	return nil
}

func jimengBusinessError(errmsg string) error {
	message := strings.TrimSpace(errmsg)
	if strings.EqualFold(message, "login is required") {
		return kernel.BadAuthRequest("该即梦画布未公开分享或分享已失效，请确认链接后重试")
	}
	if message == "" || strings.EqualFold(message, "ok") {
		message = "即梦返回业务错误"
	}
	return kernel.NewAppError(http.StatusBadGateway, "即梦返回错误："+message)
}

func fetchJimengResources(projectID string, resourceIDs []string) (*jimengResourceSet, error) {
	set := &jimengResourceSet{
		Resources: make(map[string]jimengResource),
		Images:    make(map[string]jimengImageURLs),
		Media:     make(map[string]jimengMediaURLs),
	}
	for start := 0; start < len(resourceIDs); start += jimengResourceBatchSize {
		end := min(start+jimengResourceBatchSize, len(resourceIDs))
		var page jimengResourcePage
		if err := postJimengJSON("resource/batch_get", map[string]any{"project_id": projectID, "resource_ids": resourceIDs[start:end]}, &page); err != nil {
			return nil, err
		}
		for _, resource := range page.Resources {
			if resourceID := strings.ToLower(strings.TrimSpace(resource.ResourceID)); resourceID != "" {
				set.Resources[resourceID] = resource
			}
		}
		for key, value := range page.ImageURLs {
			set.Images[key] = value
		}
		for key, value := range page.MediaURLs {
			set.Media[key] = value
		}
	}
	return set, nil
}

func (set *jimengResourceSet) resolve(resourceID string) (*JimengMedia, string) {
	resource, ok := set.Resources[resourceID]
	if !ok {
		return nil, "即梦素材不存在或已被删除"
	}
	if resource.Status != jimengResourceReady {
		return nil, "即梦素材尚未生成完成"
	}
	var media JimengMedia
	media.ResourceID = resourceID
	switch resource.Type {
	case jimengImageResource:
		if resource.Image == nil {
			return nil, "即梦素材缺少图片信息"
		}
		urls := set.Images[resource.Image.URI]
		media.Kind = "image"
		media.URL = jimengAllowedImageURL(urls.URL)
		media.PreviewURL = jimengImagePreview(urls.ResolutionSource)
		media.Width, media.Height = resource.Image.Width, resource.Image.Height
		media.MimeType = jimengImageMime(resource.Image.Format, media.URL)
	case jimengVideoResource:
		if resource.Video == nil {
			return nil, "即梦素材缺少视频信息"
		}
		urls := set.Media[resource.Video.VID]
		media.Kind = "video"
		media.URL = jimengAllowedVideoURL(urls.URL)
		media.PreviewURL = jimengAllowedImageURL(urls.CoverURL)
		media.Width, media.Height = resource.Video.Width, resource.Video.Height
		if resource.Video.Duration > 0 && !math.IsNaN(resource.Video.Duration) {
			media.DurationMs = int64(math.Round(resource.Video.Duration * 1000))
		}
		media.MimeType = "video/mp4"
	default:
		return nil, "暂不支持的即梦素材类型"
	}
	if media.URL == "" {
		return nil, jimengUntrustedMedia
	}
	media.ExpiresAt = jimengEarliest(jimengURLExpiry(media.URL), jimengURLExpiry(media.PreviewURL))
	return &media, ""
}

// jimengURLExpiry 读取签名地址里的过期时间：图片在 x-expires 查询参数，
// 视频在路径第二段的十六进制时间戳（第一段是文件摘要）。读不到时返回零值。
func jimengURLExpiry(raw string) time.Time {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}
	}
	if value := parsed.Query().Get("x-expires"); value != "" {
		if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds > 1e9 {
			return time.Unix(seconds, 0).UTC()
		}
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(segments) > 1 {
		if seconds, err := strconv.ParseInt(segments[1], 16, 64); err == nil && seconds > 1e9 {
			return time.Unix(seconds, 0).UTC()
		}
	}
	return time.Time{}
}

func jimengEarliest(values ...time.Time) time.Time {
	var earliest time.Time
	for _, value := range values {
		if value.IsZero() {
			continue
		}
		if earliest.IsZero() || value.Before(earliest) {
			earliest = value
		}
	}
	return earliest
}

func jimengAllowedImageURL(raw string) string {
	return jimengAllowedURL(raw, jimengImageHostPattern)
}

func jimengAllowedVideoURL(raw string) string {
	return jimengAllowedURL(raw, jimengVideoHostPattern)
}

func jimengAllowedURL(raw string, hosts *regexp.Regexp) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Port() != "" {
		return ""
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if !hosts.MatchString(host) {
		return ""
	}
	return parsed.String()
}

// jimengImagePreview 优先选不超过 960 的最大档位，全部超标时取最小档位。
func jimengImagePreview(entries map[string]jimengSizedURL) string {
	var best jimengSizedURL
	for _, entry := range entries {
		entry.URL = jimengAllowedImageURL(entry.URL)
		if entry.URL == "" {
			continue
		}
		if best.URL == "" || (entry.Width <= jimengPreviewMaxWidth && (best.Width > jimengPreviewMaxWidth || entry.Width > best.Width)) || (best.Width > jimengPreviewMaxWidth && entry.Width < best.Width) {
			best = entry
		}
	}
	return best.URL
}

func jimengImageMime(format string, raw string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "png":
		return "image/png"
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	}
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, ".png"):
		return "image/png"
	case strings.Contains(lower, ".jpg") || strings.Contains(lower, ".jpeg"):
		return "image/jpeg"
	case strings.Contains(lower, ".webp"):
		return "image/webp"
	case strings.Contains(lower, ".gif"):
		return "image/gif"
	default:
		return "image/*"
	}
}
