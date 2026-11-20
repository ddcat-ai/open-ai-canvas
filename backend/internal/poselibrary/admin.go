package poselibrary

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type Stats struct {
	Total    int64 `json:"total"`
	Ready    int64 `json:"ready"`
	Pending  int64 `json:"pending"`
	Failed   int64 `json:"failed"`
	Disabled int64 `json:"disabled"`
}

type AdminQuery struct {
	Keyword   string
	SourceKey string
	System    string
	Status    string
	Page      int
	PageSize  int
}

type AdminItem struct {
	model.PoseLibraryItem
	Version int64 `json:"version"`
}

type AdminPage struct {
	Items    []AdminItem                           `json:"items"`
	Total    int64                                 `json:"total"`
	Page     int                                   `json:"page"`
	PageSize int                                   `json:"pageSize"`
	Stats    Stats                                 `json:"stats"`
	Sources  []model.PoseLibrarySource             `json:"sources"`
	Systems  []repository.PoseLibrarySystemSummary `json:"systems"`
}

func (s *Service) stats() (Stats, error) {
	rows, err := s.repo.PoseLibraryStatusCounts()
	if err != nil {
		return Stats{}, err
	}
	var stats Stats
	for _, row := range rows {
		stats.Total += row.Count
		switch row.Status {
		case model.PoseLibraryStatusReady:
			stats.Ready += row.Count
		case model.PoseLibraryStatusPending:
			stats.Pending += row.Count
		case model.PoseLibraryStatusFailed:
			stats.Failed += row.Count
		}
		if !row.Enabled {
			stats.Disabled += row.Count
		}
	}
	return stats, nil
}

func (s *Service) AdminList(actor *model.User, query AdminQuery) (*AdminPage, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	switch query.Status {
	case "", model.PoseLibraryStatusPending, model.PoseLibraryStatusReady, model.PoseLibraryStatusFailed:
	default:
		return nil, kernel.BadAuthRequest("同步状态无效")
	}
	page, pageSize := normalizePage(query.Page, query.PageSize)
	pageSize = min(max(pageSize, 1), 100)
	items, total, err := s.repo.AdminPoseLibraryItems(repository.PoseLibraryFilter{Keyword: clip(query.Keyword, 80), SourceKey: clip(query.SourceKey, 64), System: clip(query.System, 80), Status: query.Status}, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	views := make([]AdminItem, 0, len(items))
	for _, item := range items {
		views = append(views, AdminItem{PoseLibraryItem: item, Version: itemVersion(item)})
	}
	stats, err := s.stats()
	if err != nil {
		return nil, err
	}
	sources, err := s.repo.PoseLibrarySources()
	if err != nil {
		return nil, err
	}
	systems, err := s.repo.PoseLibrarySystemSummaries()
	if err != nil {
		return nil, err
	}
	return &AdminPage{Items: views, Total: total, Page: page, PageSize: pageSize, Stats: stats, Sources: sources, Systems: systems}, nil
}

type UpdateItemRequest struct {
	Name     *string `json:"name"`
	System   *string `json:"system"`
	Category *string `json:"category"`
	Angle    *string `json:"angle"`
	Code     *string `json:"code"`
	Enabled  *bool   `json:"enabled"`
}

func (s *Service) adminItem(id string) (*model.PoseLibraryItem, error) {
	id = strings.TrimSpace(id)
	if !validItemID(id) {
		return nil, kernel.NotFound("姿势不存在")
	}
	item, err := s.repo.PoseLibraryItem(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("姿势不存在")
	}
	return item, err
}

func (s *Service) UpdateItem(actor *model.User, id string, req UpdateItemRequest) (*AdminItem, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := s.adminItem(id)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	text := func(value *string, limit int, column string, target *string, required bool) error {
		if value == nil {
			return nil
		}
		next := clip(*value, limit)
		if required && next == "" {
			return kernel.BadAuthRequest("名称、体系和分类不能为空")
		}
		*target = next
		fields[column] = next
		return nil
	}
	if err := text(req.Name, 160, "name", &item.Name, true); err != nil {
		return nil, err
	}
	if err := text(req.System, 80, "system", &item.System, true); err != nil {
		return nil, err
	}
	if err := text(req.Category, 80, "category", &item.Category, true); err != nil {
		return nil, err
	}
	if err := text(req.Code, 40, "code", &item.Code, false); err != nil {
		return nil, err
	}
	if req.Angle != nil {
		item.Angle = normalizeAngle(*req.Angle)
		fields["angle"] = item.Angle
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
		fields["enabled"] = item.Enabled
	}
	if len(fields) == 0 {
		return &AdminItem{PoseLibraryItem: *item, Version: itemVersion(*item)}, nil
	}
	item.SearchText = searchText(item.Name, item.Category, item.System, item.Code, item.Angle, item.ExternalKey)
	item.UpdatedAt = time.Now()
	fields["search_text"] = item.SearchText
	fields["updated_at"] = item.UpdatedAt
	affected, err := s.repo.UpdatePoseLibraryItem(item.ID, fields)
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, kernel.NotFound("姿势不存在")
	}
	if err := s.admin.AppendAudit(actor, "pose_library.update", "pose_library_item", item.ID, "修改姿势 "+item.Name, fields); err != nil {
		return nil, err
	}
	return &AdminItem{PoseLibraryItem: *item, Version: itemVersion(*item)}, nil
}

type BulkRequest struct {
	Action    string   `json:"action"`
	IDs       []string `json:"ids"`
	SourceKey string   `json:"sourceKey"`
	System    string   `json:"system"`
}

type BulkResult struct {
	Affected int64 `json:"affected"`
}

// Bulk 按条目 ID 或按"来源 + 体系"批量启用、停用或删除。删除先移除记录，再清理图片目录。
func (s *Service) Bulk(actor *model.User, req BulkRequest) (*BulkResult, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	switch req.Action {
	case "enable", "disable", "delete", "resync":
	default:
		return nil, kernel.BadAuthRequest("批量操作无效")
	}
	var ids []string
	if len(req.IDs) > 0 {
		if len(req.IDs) > 1000 {
			return nil, kernel.BadAuthRequest("一次最多处理 1000 条")
		}
		for _, id := range req.IDs {
			if id = strings.TrimSpace(id); validItemID(id) {
				ids = append(ids, id)
			}
		}
	} else {
		system := clip(req.System, 80)
		if system == "" {
			return nil, kernel.BadAuthRequest("请指定条目或体系")
		}
		var err error
		ids, err = s.repo.PoseLibraryItemIDs(repository.PoseLibraryFilter{SourceKey: clip(req.SourceKey, 64), System: system})
		if err != nil {
			return nil, err
		}
	}
	if len(ids) == 0 {
		return &BulkResult{}, nil
	}
	var affected int64
	var err error
	switch req.Action {
	case "delete":
		err = s.deleteItems(ids)
		affected = int64(len(ids))
	case "resync":
		// 数据目录丢失或来源图片更新后重新下载；自建条目没有来源地址，不受影响。
		affected, err = s.repo.RequeuePoseLibraryItems(ids)
	default:
		affected, err = s.repo.SetPoseLibraryItemsEnabled(ids, req.Action == "enable")
	}
	if err != nil {
		return nil, err
	}
	summary := fmt.Sprintf("姿势库批量%s %d 条", map[string]string{"enable": "启用", "disable": "停用", "delete": "删除", "resync": "重新同步"}[req.Action], affected)
	if err := s.admin.AppendAudit(actor, "pose_library.bulk_"+req.Action, "pose_library", req.System, summary, map[string]any{"count": affected, "sourceKey": req.SourceKey, "system": req.System}); err != nil {
		return nil, err
	}
	return &BulkResult{Affected: affected}, nil
}

func (s *Service) DeleteItem(actor *model.User, id string) error {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return err
	}
	item, err := s.adminItem(id)
	if err != nil {
		return err
	}
	if err := s.deleteItems([]string{item.ID}); err != nil {
		return err
	}
	return s.admin.AppendAudit(actor, "pose_library.delete", "pose_library_item", item.ID, "删除姿势 "+item.Name, nil)
}

// deleteItems 删除后用户已插入画布的姿势不受影响：画布节点引用的是选用时复制出的用户资源。
func (s *Service) deleteItems(ids []string) error {
	if err := s.repo.DeletePoseLibraryItems(ids); err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.removeItemFiles(id); err != nil {
			log.Printf("pose library: remove files of %s failed: %v", id, err)
		}
	}
	return nil
}

type CreateItemRequest struct {
	Name     string
	System   string
	Category string
	Angle    string
	Code     string
	Data     []byte
}

// CreateCustomItem 保存管理员上传的一张自建姿势图。填写相同编号的多张图会合并为同一姿势的不同视角。
func (s *Service) CreateCustomItem(actor *model.User, req CreateItemRequest) (*AdminItem, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	name := clip(req.Name, 160)
	if name == "" {
		return nil, kernel.BadAuthRequest("请填写姿势名称")
	}
	system := clip(req.System, 80)
	if system == "" {
		system = "站点自建"
	}
	category := clip(req.Category, 80)
	if category == "" {
		category = "其他"
	}
	if int64(len(req.Data)) > MaxImageBytes {
		return nil, kernel.BadAuthRequest("姿势图不能超过 20 MB")
	}
	original, err := inspectImage(req.Data)
	if err != nil {
		return nil, err
	}
	thumb, err := makeThumbnail(original)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	source := &model.PoseLibrarySource{Key: SourceCustom, Name: "站点自建", Attribution: "本站管理员上传", CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.UpsertPoseLibrarySource(source); err != nil {
		return nil, err
	}
	maxOrder, err := s.repo.MaxPoseLibrarySortOrder()
	if err != nil {
		return nil, err
	}
	id := kernel.NewID()
	code := clip(req.Code, 40)
	group := id
	if code != "" {
		group = code
	}
	angle := normalizeAngle(req.Angle)
	item := &model.PoseLibraryItem{
		ID: id, SourceKey: SourceCustom, ExternalKey: id, GroupKey: SourceCustom + ":" + group, Code: code,
		System: system, Category: category, Name: name, Angle: angle, SearchText: searchText(name, category, system, code, angle),
		SortOrder: maxOrder + 1, Enabled: true, Status: model.PoseLibraryStatusPending, CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreatePoseLibraryItem(item); err != nil {
		return nil, err
	}
	if err := s.storeItemImages(id, original, thumb); err != nil {
		if deleteErr := s.deleteItems([]string{id}); deleteErr != nil {
			return nil, errors.Join(err, deleteErr)
		}
		return nil, err
	}
	saved, err := s.adminItem(id)
	if err != nil {
		return nil, err
	}
	if err := s.admin.AppendAudit(actor, "pose_library.create", "pose_library_item", id, "新增姿势 "+name, nil); err != nil {
		return nil, err
	}
	return &AdminItem{PoseLibraryItem: *saved, Version: itemVersion(*saved)}, nil
}
