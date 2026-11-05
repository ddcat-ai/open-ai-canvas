package poselibrary

import (
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CatalogQuery struct {
	Keyword  string
	System   string
	Category string
	Angle    string
	Page     int
	PageSize int
}

type CatalogItem struct {
	ID      string `json:"id"`
	Angle   string `json:"angle"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Version int64  `json:"version"`
}

// CatalogPose 是一个姿势（同组多视角）。
type CatalogPose struct {
	Key       string        `json:"key"`
	Code      string        `json:"code"`
	Name      string        `json:"name"`
	System    string        `json:"system"`
	Category  string        `json:"category"`
	SourceKey string        `json:"sourceKey"`
	Items     []CatalogItem `json:"items"`
}

type CatalogFacets struct {
	Systems    []repository.PoseLibraryFacet `json:"systems"`
	Categories []repository.PoseLibraryFacet `json:"categories"`
	Angles     []repository.PoseLibraryFacet `json:"angles"`
}

// CatalogPage 不带来源署名：姿势库可以只装站点自己的素材，来源信息只在后台展示。
type CatalogPage struct {
	Poses    []CatalogPose `json:"poses"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
	Facets   CatalogFacets `json:"facets"`
}

func normalizePage(page int, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	return page, min(pageSize, maxPageSize)
}

func itemVersion(item model.PoseLibraryItem) int64 {
	if item.SyncedAt != nil {
		return item.SyncedAt.Unix()
	}
	return item.UpdatedAt.Unix()
}

// Catalog 返回登录用户可见的姿势分页（只含已启用且图片已同步的条目）和筛选计数。
func (s *Service) Catalog(actor *model.User, query CatalogQuery) (*CatalogPage, error) {
	if actor == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	page, pageSize := normalizePage(query.Page, query.PageSize)
	filter := repository.PoseLibraryFilter{
		VisibleOnly: true,
		Keyword:     clip(query.Keyword, 80),
		System:      clip(query.System, 80),
		Category:    clip(query.Category, 80),
		Angle:       clip(query.Angle, 20),
	}
	groupKeys, total, err := s.repo.PoseLibraryGroupPage(filter, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	items, err := s.repo.PoseLibraryVisibleItemsByGroups(groupKeys)
	if err != nil {
		return nil, err
	}
	byGroup := make(map[string][]model.PoseLibraryItem, len(groupKeys))
	for _, item := range items {
		byGroup[item.GroupKey] = append(byGroup[item.GroupKey], item)
	}
	poses := make([]CatalogPose, 0, len(groupKeys))
	for _, key := range groupKeys {
		group := byGroup[key]
		if len(group) == 0 {
			continue
		}
		sort.SliceStable(group, func(left, right int) bool {
			if rankLeft, rankRight := angleRank(group[left].Angle), angleRank(group[right].Angle); rankLeft != rankRight {
				return rankLeft < rankRight
			}
			return group[left].SortOrder < group[right].SortOrder
		})
		head := group[0]
		pose := CatalogPose{Key: key, Code: head.Code, Name: head.Name, System: head.System, Category: head.Category, SourceKey: head.SourceKey, Items: make([]CatalogItem, 0, len(group))}
		for _, item := range group {
			pose.Items = append(pose.Items, CatalogItem{ID: item.ID, Angle: item.Angle, Width: item.Width, Height: item.Height, Version: itemVersion(item)})
		}
		poses = append(poses, pose)
	}
	facets, err := s.catalogFacets(filter)
	if err != nil {
		return nil, err
	}
	return &CatalogPage{Poses: poses, Total: total, Page: page, PageSize: pageSize, Facets: facets}, nil
}

// catalogFacets 逐级收窄：体系计数看全部，分类计数看所选体系，视角计数看所选体系和分类。
func (s *Service) catalogFacets(filter repository.PoseLibraryFilter) (CatalogFacets, error) {
	systems, err := s.repo.PoseLibraryGroupFacets("system", repository.PoseLibraryFilter{VisibleOnly: true})
	if err != nil {
		return CatalogFacets{}, err
	}
	categories, err := s.repo.PoseLibraryGroupFacets("category", repository.PoseLibraryFilter{VisibleOnly: true, System: filter.System})
	if err != nil {
		return CatalogFacets{}, err
	}
	angles, err := s.repo.PoseLibraryGroupFacets("angle", repository.PoseLibraryFilter{VisibleOnly: true, System: filter.System, Category: filter.Category})
	if err != nil {
		return CatalogFacets{}, err
	}
	sort.SliceStable(angles, func(left, right int) bool { return angleRank(angles[left].Name) < angleRank(angles[right].Name) })
	return CatalogFacets{Systems: systems, Categories: categories, Angles: angles}, nil
}

// visibleItem 读取用户可用的条目：普通用户只能看已启用且已同步的图，管理员还能预览停用条目。
func (s *Service) visibleItem(actor *model.User, id string) (*model.PoseLibraryItem, error) {
	if actor == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	id = strings.TrimSpace(id)
	if !validItemID(id) {
		return nil, kernel.NotFound("姿势不存在")
	}
	item, err := s.repo.PoseLibraryItem(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("姿势不存在")
		}
		return nil, err
	}
	if item.Status != model.PoseLibraryStatusReady {
		return nil, kernel.NotFound("姿势图片尚未同步")
	}
	if !item.Enabled && s.admin.RequireAdmin(actor) != nil {
		return nil, kernel.NotFound("姿势不存在")
	}
	return item, nil
}

type FileVariant string

const (
	FileThumb FileVariant = "thumb"
	FileImage FileVariant = "image"
)

type OpenedFile struct {
	File     *os.File
	Info     os.FileInfo
	MimeType string
}

func (s *Service) OpenFile(actor *model.User, id string, variant FileVariant) (*OpenedFile, error) {
	item, err := s.visibleItem(actor, id)
	if err != nil {
		return nil, err
	}
	relative, mimeType := item.ThumbFile, item.ThumbMime
	if variant == FileImage {
		relative, mimeType = item.ImageFile, item.ImageMime
	}
	file, info, err := s.openItemFile(relative)
	if err != nil {
		return nil, err
	}
	return &OpenedFile{File: file, Info: info, MimeType: mimeType}, nil
}

// UseSource 是一张准备复制到用户资源的原图。
type UseSource struct {
	Item     model.PoseLibraryItem
	Data     []byte
	FileName string
}

// ImagesForUse 校验选中的条目并读取原图字节，按请求顺序返回。
func (s *Service) ImagesForUse(actor *model.User, ids []string) ([]UseSource, error) {
	if actor == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	if len(ids) == 0 {
		return nil, kernel.BadAuthRequest("请选择要插入的姿势")
	}
	if len(ids) > MaxUseItems {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("一次最多插入 %d 张姿势图", MaxUseItems))
	}
	seen := map[string]bool{}
	sources := make([]UseSource, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		item, err := s.visibleItem(actor, id)
		if err != nil {
			return nil, err
		}
		file, _, err := s.openItemFile(item.ImageFile)
		if err != nil {
			return nil, err
		}
		data, readErr := readLimited(file, MaxImageBytes)
		file.Close()
		if readErr != nil {
			return nil, readErr
		}
		sources = append(sources, UseSource{Item: *item, Data: data, FileName: useFileName(*item)})
	}
	return sources, nil
}

func useFileName(item model.PoseLibraryItem) string {
	name := strings.Map(func(char rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, char) {
			return '-'
		}
		return char
	}, clip(item.Name+"-"+item.Angle, 60))
	return "姿势-" + name + imageExtension(item.ImageMime)
}

func readLimited(reader io.Reader, maxBytes int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, kernel.BadAuthRequest("姿势原图超过大小上限")
	}
	return data, nil
}
