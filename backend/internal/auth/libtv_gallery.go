package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"github.com/google/uuid"
)

const (
	libTVPublicFeedURL     = "https://api.liblib.tv/api/community/project/template/feed/stream"
	libTVPublicTemplateURL = "https://api.liblib.tv/api/canvas/project/template/detail"
	libTVResourceHost      = "libtv-res.liblib.art"
)

type LibTVGalleryRequest struct {
	Page      int    `form:"page"`
	PageSize  int    `form:"pageSize"`
	Keyword   string `form:"keyword"`
	TagID     int    `form:"tagId"`
	RequestID string `form:"requestId"`
}

type LibTVGalleryTag struct {
	ID    int    `json:"id"`
	Code  string `json:"code"`
	Label string `json:"label"`
}

type LibTVGalleryItem struct {
	TemplateUUID string            `json:"templateUuid"`
	ProjectUUID  string            `json:"projectUuid"`
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	CoverURL     string            `json:"coverUrl"`
	MediaURL     string            `json:"mediaUrl"`
	MediaType    string            `json:"mediaType"`
	AuthorName   string            `json:"authorName"`
	AuthorAvatar string            `json:"authorAvatar"`
	LikeCount    int               `json:"likeCount"`
	PublishedAt  string            `json:"publishedAt"`
	Tags         []LibTVGalleryTag `json:"tags"`
	SourceURL    string            `json:"sourceUrl"`
}

type LibTVGalleryResult struct {
	Items     []LibTVGalleryItem `json:"items"`
	Page      int                `json:"page"`
	PageSize  int                `json:"pageSize"`
	HasMore   bool               `json:"hasMore"`
	RequestID string             `json:"requestId"`
}

type LibTVWorkStep struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Type             string   `json:"type"`
	Prompt           string   `json:"prompt"`
	Text             string   `json:"text"`
	Model            string   `json:"model"`
	MediaURLs        []string `json:"mediaUrls"`
	AspectRatio      string   `json:"aspectRatio"`
	Resolution       string   `json:"resolution"`
	DurationSeconds  float64  `json:"durationSeconds"`
	ReferenceNodeIDs []string `json:"referenceNodeIds"`
}

type LibTVWorkDetail struct {
	Work            LibTVGalleryItem     `json:"work"`
	Steps           []LibTVWorkStep      `json:"steps"`
	NodeCount       int                  `json:"nodeCount"`
	ConnectionCount int                  `json:"connectionCount"`
	CanImport       bool                 `json:"canImport"`
	Warnings        []LibTVImportWarning `json:"warnings"`
}

type libTVPublishedTemplate struct {
	TemplateUUID string `json:"templateUuid"`
	ProjectUUID  string `json:"projectUuid"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	CoverURL     string `json:"coverUrl"`
	FinalOutput  string `json:"finalOutput"`
	Nickname     string `json:"nickname"`
	Avatar       string `json:"avatar"`
	LikeCount    int    `json:"likeCount"`
	PublishAt    string `json:"publishAt"`
	CreateAt     string `json:"createAt"`
	AuditStatus  int    `json:"auditStatus"`
	SnapshotID   int64  `json:"snapshotId"`
	SnapshotData string `json:"snapshotData"`
	Tags         []struct {
		ID       int    `json:"id"`
		Code     string `json:"code"`
		TagLabel string `json:"tagLabel"`
	} `json:"tags"`
}

func normalizeLibTVGalleryRequest(req LibTVGalleryRequest) (LibTVGalleryRequest, error) {
	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 20
	}
	req.Keyword = strings.TrimSpace(req.Keyword)
	req.RequestID = strings.TrimSpace(req.RequestID)
	if req.Page < 1 || req.Page > 1000 || req.PageSize < 1 || req.PageSize > 40 || req.TagID < 0 || utf8.RuneCountInString(req.Keyword) > 100 {
		return req, kernel.BadAuthRequest("LibTV 查询参数无效")
	}
	if req.RequestID == "" {
		req.RequestID = uuid.NewString()
	} else if id, err := uuid.Parse(req.RequestID); err != nil {
		return req, kernel.BadAuthRequest("LibTV 查询标识格式无效")
	} else {
		req.RequestID = id.String()
	}
	return req, nil
}

func (s *Service) allowLibTVGalleryRead(ctx context.Context, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	allowed, err := s.host.AllowRequest(ctx, "libtv-gallery:"+userID, 60, time.Minute)
	if err != nil {
		return err
	}
	if !allowed {
		return kernel.RateLimited("LibTV 查询过于频繁，请稍后重试")
	}
	return nil
}

func (s *Service) LibTVGallery(ctx context.Context, actor *model.User, req LibTVGalleryRequest) (*LibTVGalleryResult, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	req, err := normalizeLibTVGalleryRequest(req)
	if err != nil {
		return nil, err
	}
	if err := s.allowLibTVGalleryRead(ctx, actor.ID); err != nil {
		return nil, err
	}
	payload := struct {
		Page      int    `json:"page"`
		PageSize  int    `json:"pageSize"`
		Name      string `json:"name,omitempty"`
		TagID     int    `json:"tagId,omitempty"`
		RequestID string `json:"requestId"`
	}{req.Page, req.PageSize, req.Keyword, req.TagID, req.RequestID}
	data, err := requestLibTVPublic(ctx, http.MethodPost, libTVPublicFeedURL, payload)
	if err != nil {
		return nil, err
	}
	return decodeLibTVGallery(data, req)
}

func decodeLibTVGallery(data json.RawMessage, req LibTVGalleryRequest) (*LibTVGalleryResult, error) {
	var feed struct {
		List    []libTVPublishedTemplate `json:"list"`
		HasMore *bool                    `json:"hasMore"`
	}
	if err := json.Unmarshal(data, &feed); err != nil || feed.List == nil || feed.HasMore == nil || len(feed.List) > 40 {
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 作品列表格式已变化")
	}
	result := &LibTVGalleryResult{Items: make([]LibTVGalleryItem, 0, len(feed.List)), Page: req.Page, PageSize: req.PageSize, HasMore: *feed.HasMore, RequestID: req.RequestID}
	for _, item := range feed.List {
		if item.AuditStatus != 1 || !isLibTVProjectUUID(item.TemplateUUID) {
			continue
		}
		result.Items = append(result.Items, libTVGalleryItem(item))
	}
	return result, nil
}

func (s *Service) LibTVWork(ctx context.Context, actor *model.User, templateUUID string) (*LibTVWorkDetail, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if !isLibTVProjectUUID(strings.TrimSpace(templateUUID)) {
		return nil, kernel.BadAuthRequest("LibTV 作品 UUID 格式无效")
	}
	if err := s.allowLibTVGalleryRead(ctx, actor.ID); err != nil {
		return nil, err
	}
	work, snapshot, err := fetchLibTVPublishedTemplate(ctx, templateUUID)
	if err != nil {
		return nil, err
	}
	imported := adaptLibTVTemplate(work, snapshot)
	result := &LibTVWorkDetail{
		Work: libTVGalleryItem(*work), Steps: libTVWorkSteps(snapshot), NodeCount: len(snapshot.Nodes),
		ConnectionCount: len(snapshot.Edges), CanImport: imported.ImportedNodeCount > 0, Warnings: imported.Warnings,
	}
	for _, issue := range imported.SkippedNodes {
		result.Warnings = append(result.Warnings, LibTVImportWarning{ID: issue.ID, Message: issue.Reason})
	}
	for _, issue := range imported.SkippedConnections {
		result.Warnings = append(result.Warnings, LibTVImportWarning{ID: issue.ID, Message: issue.Reason})
	}
	if !result.CanImport {
		result.Warnings = append(result.Warnings, LibTVImportWarning{Message: "作品没有可导入的公开节点"})
	}
	return result, nil
}

func (s *Service) ImportLibTVTemplate(ctx context.Context, userID, canvasProjectID, templateUUID string) (*LibTVImportResult, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(canvasProjectID) == "" {
		return nil, kernel.Unauthorized("请先打开已同步的画布")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		return nil, err
	}
	if !isLibTVProjectUUID(strings.TrimSpace(templateUUID)) {
		return nil, kernel.BadAuthRequest("LibTV 作品 UUID 格式无效")
	}
	if err := s.allowLibTVGalleryRead(ctx, userID); err != nil {
		return nil, err
	}
	work, snapshot, err := fetchLibTVPublishedTemplate(ctx, templateUUID)
	if err != nil {
		return nil, err
	}
	result := adaptLibTVTemplate(work, snapshot)
	if result.ImportedNodeCount == 0 {
		return nil, kernel.BadAuthRequest("作品没有可导入的公开节点")
	}
	return result, nil
}

func fetchLibTVPublishedTemplate(ctx context.Context, templateUUID string) (*libTVPublishedTemplate, *libTVTemplateSnapshot, error) {
	query := url.Values{"projectTemplateUuid": {strings.ToLower(strings.TrimSpace(templateUUID))}}
	data, err := requestLibTVPublic(ctx, http.MethodGet, libTVPublicTemplateURL+"?"+query.Encode(), nil)
	if err != nil {
		return nil, nil, err
	}
	return decodeLibTVPublishedTemplate(data, templateUUID)
}

func decodeLibTVPublishedTemplate(data json.RawMessage, templateUUID string) (*libTVPublishedTemplate, *libTVTemplateSnapshot, error) {
	var value struct {
		Detail *libTVPublishedTemplate `json:"detail"`
	}
	if err := json.Unmarshal(data, &value); err != nil || value.Detail == nil {
		return nil, nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 作品详情格式已变化")
	}
	work := value.Detail
	if !strings.EqualFold(work.TemplateUUID, strings.TrimSpace(templateUUID)) || work.AuditStatus != 1 {
		return nil, nil, kernel.Forbidden("作品未公开或未通过审核")
	}
	if !isLibTVProjectUUID(work.ProjectUUID) {
		return nil, nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 作品来源标识无效")
	}
	snapshot := &libTVTemplateSnapshot{Nodes: []libTVTemplateNode{}, Edges: []libTVTemplateEdge{}}
	if strings.TrimSpace(work.SnapshotData) != "" {
		if err := json.Unmarshal([]byte(work.SnapshotData), snapshot); err != nil || snapshot.Nodes == nil || snapshot.Edges == nil || len(snapshot.Nodes) > 2000 || len(snapshot.Edges) > 10000 {
			return nil, nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 公开快照无效或过大")
		}
	}
	return work, snapshot, nil
}

func libTVGalleryItem(work libTVPublishedTemplate) LibTVGalleryItem {
	item := LibTVGalleryItem{
		TemplateUUID: strings.ToLower(work.TemplateUUID), ProjectUUID: strings.ToLower(work.ProjectUUID), Title: strings.TrimSpace(work.Name),
		Description: strings.TrimSpace(work.Description), CoverURL: safeLibTVResourceURL(work.CoverURL), MediaURL: safeLibTVResourceURL(work.FinalOutput),
		AuthorName: strings.TrimSpace(work.Nickname), AuthorAvatar: safeLibTVAvatarURL(work.Avatar), LikeCount: max(0, work.LikeCount),
		PublishedAt: kernel.FirstNonEmpty(work.PublishAt, work.CreateAt), Tags: make([]LibTVGalleryTag, 0, len(work.Tags)), SourceURL: "https://www.liblib.tv/",
	}
	item.MediaType = libTVMediaType(item.MediaURL)
	for _, tag := range work.Tags {
		if tag.ID > 0 && strings.TrimSpace(tag.TagLabel) != "" {
			item.Tags = append(item.Tags, LibTVGalleryTag{ID: tag.ID, Code: tag.Code, Label: tag.TagLabel})
		}
	}
	return item
}

func safeLibTVResourceURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, libTVResourceHost) || u.User != nil {
		return ""
	}
	return u.String()
}

func safeLibTVAvatarURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Host != "liblibai-online.liblib.cloud" && u.Host != libTVResourceHost) {
		return ""
	}
	return u.String()
}

func libTVMediaType(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || raw == "" {
		return "unknown"
	}
	switch strings.ToLower(path.Ext(u.Path)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov", ".m3u8":
		return "video"
	case ".mp3", ".wav", ".ogg", ".m4a", ".flac":
		return "audio"
	default:
		return "unknown"
	}
}

func requestLibTVPublic(ctx context.Context, method, endpoint string, payload any) (json.RawMessage, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-language", "zh")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(20 * time.Second)
	// 公开作品读取不携带本站 Cookie 或管理员保存的 LibTV Token，也不接受重定向。
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("LibTV 不允许重定向") }
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 公开接口暂时无法连接")
	}
	defer resp.Body.Close()
	return readLibTVPublicResponse(resp)
}

func readLibTVPublicResponse(resp *http.Response) (json.RawMessage, error) {
	if resp.StatusCode == http.StatusNotFound {
		return nil, kernel.NotFound("LibTV 作品或公开接口不可用")
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, kernel.RateLimited("LibTV 上游限流，请稍后重试")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 公开接口返回 HTTP %d", resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, libTVMaxResponseBytes+1))
	if err != nil || len(body) > libTVMaxResponseBytes {
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 响应读取失败或过大")
	}
	var value struct {
		Code *int            `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &value); err != nil || value.Code == nil || len(value.Data) == 0 || bytes.Equal(value.Data, []byte("null")) {
		return nil, kernel.NewAppError(http.StatusBadGateway, "LibTV 公开接口响应格式已变化")
	}
	if *value.Code != 0 {
		return nil, kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("LibTV 公开接口返回业务错误（%d）", *value.Code))
	}
	return value.Data, nil
}
