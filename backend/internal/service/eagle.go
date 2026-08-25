package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const eagleDefaultBaseURL = "http://127.0.0.1:41595"

type EagleFolder struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	ParentID string        `json:"parentId,omitempty"`
	Children []EagleFolder `json:"children,omitempty"`
}

type EagleLibrary struct {
	ApplicationVersion string        `json:"applicationVersion"`
	LibraryName        string        `json:"libraryName"`
	LibraryPath        string        `json:"-"`
	Folders            []EagleFolder `json:"folders"`
}

type EagleItem struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Size             int64    `json:"size"`
	Extension        string   `json:"extension"`
	Tags             []string `json:"tags"`
	FolderIDs        []string `json:"folderIds"`
	URL              string   `json:"url"`
	Annotation       string   `json:"annotation"`
	ModificationTime int64    `json:"modificationTime"`
	Width            int      `json:"width,omitempty"`
	Height           int      `json:"height,omitempty"`
	Deleted          bool     `json:"deleted"`
}

func (item *EagleItem) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID               string   `json:"id"`
		Name             string   `json:"name"`
		Size             int64    `json:"size"`
		Extension        string   `json:"ext"`
		Tags             []string `json:"tags"`
		FolderIDs        []string `json:"folders"`
		URL              string   `json:"url"`
		Annotation       string   `json:"annotation"`
		ModificationTime int64    `json:"modificationTime"`
		Width            int      `json:"width"`
		Height           int      `json:"height"`
		Deleted          bool     `json:"isDeleted"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*item = EagleItem{
		ID: raw.ID, Name: raw.Name, Size: raw.Size, Extension: raw.Extension,
		Tags: raw.Tags, FolderIDs: raw.FolderIDs, URL: raw.URL, Annotation: raw.Annotation,
		ModificationTime: raw.ModificationTime, Width: raw.Width, Height: raw.Height, Deleted: raw.Deleted,
	}
	return nil
}

func normalizeEagleStringSlice(values []string) []string {
	normalized := make([]string, len(values))
	copy(normalized, values)
	return normalized
}

func normalizeEagleItemCollections(item *EagleItem) {
	item.FolderIDs = normalizeEagleStringSlice(item.FolderIDs)
	item.Tags = normalizeEagleStringSlice(item.Tags)
}

type EagleItemQuery struct {
	FolderID string
	Keyword  string
	Limit    int
	Offset   int
}

type EagleAddItemRequest struct {
	URL              string   `json:"url"`
	Name             string   `json:"name"`
	FolderID         string   `json:"folderId,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	Annotation       string   `json:"annotation,omitempty"`
	Website          string   `json:"website,omitempty"`
	ModificationTime int64    `json:"modificationTime,omitempty"`
}

type EagleCreatedItem struct {
	ID string `json:"id,omitempty"`
}

type EagleFile struct {
	Path     string
	Name     string
	Size     int64
	MimeType string
	Body     io.ReadCloser
}

func (s *Service) EagleLibrary(rawBaseURL string) (*EagleLibrary, error) {
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string `json:"status"`
		Data   struct {
			Folders            []EagleFolder `json:"folders"`
			ApplicationVersion string        `json:"applicationVersion"`
			Library            struct {
				Path string `json:"path"`
				Name string `json:"name"`
			} `json:"library"`
		} `json:"data"`
	}
	if err := eagleJSONRequest(http.MethodGet, baseURL, "/api/library/info", nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle 未返回成功状态，请确认 Eagle 已启动并打开素材库")
	}
	folders := flattenEagleFolders(response.Data.Folders, "")
	return &EagleLibrary{
		ApplicationVersion: response.Data.ApplicationVersion,
		LibraryName:        response.Data.Library.Name,
		LibraryPath:        response.Data.Library.Path,
		Folders:            folders,
	}, nil
}

func (s *Service) EagleItems(rawBaseURL string, query EagleItemQuery) ([]EagleItem, error) {
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	limit := query.Limit
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))
	if query.FolderID != "" {
		params.Set("folders", query.FolderID)
	}
	if strings.TrimSpace(query.Keyword) != "" {
		params.Set("keyword", strings.TrimSpace(query.Keyword))
	}
	var response struct {
		Status string      `json:"status"`
		Data   []EagleItem `json:"data"`
	}
	if err := eagleJSONRequest(http.MethodGet, baseURL, "/api/item/list?"+params.Encode(), nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle 未返回素材列表")
	}
	for index := range response.Data {
		item := &response.Data[index]
		item.Extension = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(item.Extension)), ".")
		normalizeEagleItemCollections(item)
	}
	return response.Data, nil
}

func (s *Service) OpenEagleItemFile(rawBaseURL string, itemID string) (*EagleFile, error) {
	if strings.TrimSpace(itemID) == "" || strings.ContainsAny(itemID, "/\\?&") {
		return nil, BadAuthRequest("Eagle 素材 ID 无效")
	}
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	library, err := s.EagleLibrary(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string `json:"status"`
		Data   string `json:"data"`
	}
	pathQuery := "/api/item/thumbnail?id=" + url.QueryEscape(itemID)
	if err := eagleJSONRequest(http.MethodGet, baseURL, pathQuery, nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" || strings.TrimSpace(response.Data) == "" {
		return nil, errors.New("Eagle 未返回素材路径")
	}
	thumbnailPath, err := url.PathUnescape(response.Data)
	if err != nil {
		return nil, errors.New("Eagle 素材路径编码无效")
	}
	originalPath, err := eagleOriginalPath(thumbnailPath, itemID, library.LibraryPath)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(originalPath)
	if err != nil {
		return nil, errors.New("无法读取 Eagle 原始文件，请确认素材库仍处于可用状态")
	}
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(originalPath))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return &EagleFile{Path: originalPath, Name: filepath.Base(originalPath), Size: stat.Size(), MimeType: mimeType, Body: file}, nil
}

func (s *Service) AddEagleItem(rawBaseURL string, request EagleAddItemRequest) (*EagleCreatedItem, error) {
	if !isEagleMediaDataURL(request.URL) {
		return nil, BadAuthRequest("写入 Eagle 只接受图片、视频或音频数据")
	}
	if strings.TrimSpace(request.Name) == "" {
		return nil, BadAuthRequest("写入 Eagle 时必须提供素材名称")
	}
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string           `json:"status"`
		Data   EagleCreatedItem `json:"data"`
	}
	if err := eagleJSONRequest(http.MethodPost, baseURL, "/api/item/addFromURL", request, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle 拒绝写入素材")
	}
	return &response.Data, nil
}

func isEagleMediaDataURL(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < len("data:,") || !strings.EqualFold(trimmed[:5], "data:") {
		return false
	}
	comma := strings.IndexByte(trimmed, ',')
	if comma <= len("data:") {
		return false
	}
	mediaType := strings.TrimSpace(trimmed[len("data:"):comma])
	if semicolon := strings.IndexByte(mediaType, ';'); semicolon >= 0 {
		mediaType = mediaType[:semicolon]
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	return strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "video/") || strings.HasPrefix(mediaType, "audio/")
}
func (s *Service) CreateEagleFolder(rawBaseURL string, name string, parentID string) error {
	if strings.TrimSpace(name) == "" {
		return BadAuthRequest("Eagle 文件夹名称不能为空")
	}
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return err
	}
	payload := struct {
		FolderName string `json:"folderName"`
		Parent     string `json:"parent,omitempty"`
	}{FolderName: strings.TrimSpace(name), Parent: strings.TrimSpace(parentID)}
	var response struct {
		Status string `json:"status"`
	}
	if err := eagleJSONRequest(http.MethodPost, baseURL, "/api/folder/create", payload, &response); err != nil {
		return err
	}
	if response.Status != "success" {
		return errors.New("Eagle 文件夹创建失败")
	}
	return nil
}

func validateEagleBaseURL(raw string) (*url.URL, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = eagleDefaultBaseURL
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, BadAuthRequest("Eagle 地址必须是 http://127.0.0.1:41595")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return nil, BadAuthRequest("为避免内网代理风险，Eagle 插件只允许连接本机地址")
	}
	if parsed.Port() != "41595" {
		return nil, BadAuthRequest("当前 Eagle 插件只支持默认端口 41595")
	}
	parsed.Path = ""
	return parsed, nil
}

func eagleJSONRequest(method string, baseURL *url.URL, endpoint string, payload any, target any) error {
	requestURL := *baseURL
	endpointURL, err := url.Parse(endpoint)
	if err != nil || endpointURL.IsAbs() || endpointURL.Host != "" || endpointURL.Path == "" {
		return errors.New("Eagle API 路径无效")
	}
	requestURL.Path = strings.TrimRight(requestURL.Path, "/") + endpointURL.Path
	requestURL.RawQuery = endpointURL.RawQuery
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = strings.NewReader(string(encoded))
	}
	request, err := http.NewRequestWithContext(context.Background(), method, requestURL.String(), body)
	if err != nil {
		return err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	// Eagle 只允许连接回环地址；本机 API 必须绕过 Clash，否则代理可能把本机请求改写成 404。
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	client := &http.Client{Timeout: 2 * time.Minute, Transport: transport}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("无法连接 Eagle，请确认 Eagle 已启动并打开素材库")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusNotFound {
			return errors.New("Eagle 未找到当前接口或素材，请确认 Eagle 已打开素材库并使用默认 API 地址")
		}
		return fmt.Errorf("Eagle API 返回 HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return errors.New("Eagle API 返回了无法解析的数据")
	}
	return nil
}

func eagleOriginalPath(thumbnailPath string, itemID string, libraryPath string) (string, error) {
	thumbnailPath = filepath.Clean(filepath.FromSlash(thumbnailPath))
	libraryPath = filepath.Clean(filepath.FromSlash(libraryPath))
	if libraryPath == "." || !filepath.IsAbs(libraryPath) {
		return "", errors.New("Eagle 素材库路径无效，无法安全读取原文件")
	}
	itemDir := filepath.Join(libraryPath, "images", itemID+".info")
	rel, err := filepath.Rel(itemDir, thumbnailPath)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", errors.New("Eagle 素材路径不在当前素材库内")
	}
	base := filepath.Base(thumbnailPath)
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	stem = strings.TrimSuffix(stem, "_thumbnail")
	if ext := filepath.Ext(base); ext != "" {
		candidate := filepath.Join(itemDir, stem+ext)
		if stat, statErr := os.Stat(candidate); statErr == nil && !stat.IsDir() {
			return candidate, nil
		}
	}
	entries, err := os.ReadDir(itemDir)
	if err != nil {
		return "", errors.New("Eagle 原文件目录不存在")
	}
	candidates := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.EqualFold(entry.Name(), "metadata.json") || strings.Contains(strings.ToLower(entry.Name()), "_thumbnail") {
			continue
		}
		candidates = append(candidates, filepath.Join(itemDir, entry.Name()))
	}
	if len(candidates) == 0 {
		return "", errors.New("Eagle 原始文件不存在")
	}
	sort.Strings(candidates)
	return candidates[0], nil
}

func flattenEagleFolders(folders []EagleFolder, parentID string) []EagleFolder {
	result := make([]EagleFolder, 0, len(folders))
	for _, folder := range folders {
		folder.ParentID = parentID
		children := flattenEagleFolders(folder.Children, folder.ID)
		folder.Children = nil
		result = append(result, folder)
		result = append(result, children...)
	}
	return result
}
