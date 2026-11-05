package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// AdminArkGroupQuery 是管理员素材组列表的筛选条件。
type AdminArkGroupQuery struct {
	Kind     string
	Scope    string
	Expiry   string
	Keyword  string
	Page     int
	PageSize int
}

type AdminArkGroupPage struct {
	Items         []ArkPortraitGroupView           `json:"items"`
	Total         int64                            `json:"total"`
	Page          int                              `json:"page"`
	PageSize      int                              `json:"pageSize"`
	Stats         repository.ArkPortraitGroupStats `json:"stats"`
	PendingReview int64                            `json:"pendingReview"`
	Sessions      []ArkPortraitSessionView         `json:"sessions"`
}

// AdminArkGroupCreateRequest 创建平台素材组：GroupID 为空时在方舟新建（虚拟 / 版权 IP），
// 非空时登记控制台已有的素材组（真人需为 LivenessFace）。
type AdminArkGroupCreateRequest struct {
	Kind         string   `json:"kind"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	GroupID      string   `json:"groupId"`
	GrantAll     bool     `json:"grantAll"`
	GrantUserIDs []string `json:"grantUserIds"`
}

// AdminArkGroupUpdateRequest 修改素材组；字段为 nil 表示不修改。授权只对平台素材组生效。
type AdminArkGroupUpdateRequest struct {
	Name         *string    `json:"name"`
	Description  *string    `json:"description"`
	GrantAll     *bool      `json:"grantAll"`
	GrantUserIDs *[]string  `json:"grantUserIds"`
	ExpiresAt    *time.Time `json:"expiresAt"`
}

type AdminArkReviewPage struct {
	Items    []ArkPortraitAssetView `json:"items"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
}

type AdminArkReviewResult struct {
	Succeeded []string               `json:"succeeded"`
	Failed    []AdminArkReviewFailed `json:"failed"`
}

type AdminArkReviewFailed struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

const maxArkGrantUsers = 500

func (s *Service) AdminArkGroups(actor *model.User, query AdminArkGroupQuery) (*AdminArkGroupPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, pageSize := normalizeAdminPage(query.Page, query.PageSize)
	kind, scope, expiry := strings.TrimSpace(query.Kind), strings.TrimSpace(query.Scope), strings.TrimSpace(query.Expiry)
	if kind != "" && !validArkGroupKind(kind) {
		return nil, BadAuthRequest("素材组类型无效")
	}
	if scope != "" && scope != arkGroupScopeUser && scope != arkGroupScopePlatform {
		return nil, BadAuthRequest("素材组归属无效")
	}
	if expiry != "" && expiry != "valid" && expiry != "expiring" && expiry != "expired" {
		return nil, BadAuthRequest("授权状态无效")
	}
	now := time.Now()
	groups, total, err := s.repo.AdminArkPortraitGroups(repository.AdminArkPortraitGroupFilter{
		Kind: kind, Scope: scope, Expiry: expiry, Keyword: query.Keyword, Now: now, Limit: pageSize, Offset: (page - 1) * pageSize,
	})
	if err != nil {
		return nil, err
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	items, err := s.adminArkGroupViews(groups, setting, now, false)
	if err != nil {
		return nil, err
	}
	stats, err := s.repo.ArkPortraitGroupStats(now)
	if err != nil {
		return nil, err
	}
	pendingReview, err := s.repo.CountArkPortraitAssetsByStatus(arkPortraitAssetPendingReview)
	if err != nil {
		return nil, err
	}
	pending, err := s.repo.PendingArkPortraitSessions(actor.ID, arkGroupScopePlatform, now, 10)
	if err != nil {
		return nil, err
	}
	sessions, err := s.arkSessionViews(pending)
	if err != nil {
		return nil, err
	}
	return &AdminArkGroupPage{Items: items, Total: total, Page: page, PageSize: pageSize, Stats: stats, PendingReview: pendingReview, Sessions: sessions}, nil
}

func (s *Service) AdminArkGroup(actor *model.User, id string) (*ArkPortraitGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	group, err := s.adminArkGroup(id)
	if err != nil {
		return nil, err
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	views, err := s.adminArkGroupViews([]model.ArkPortraitGroup{*group}, setting, time.Now(), true)
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

// adminArkGroupViews 附带所有者、各状态素材数与授权用户；withAssets 时返回全部素材及上传者。
func (s *Service) adminArkGroupViews(groups []model.ArkPortraitGroup, setting arkPrivateAssetSettingValue, now time.Time, withAssets bool) ([]ArkPortraitGroupView, error) {
	groupIDs := make([]string, 0, len(groups))
	userIDs := make([]string, 0, len(groups))
	platformIDs := make([]string, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.ID)
		userIDs = append(userIDs, group.UserID)
		if group.Scope == arkGroupScopePlatform {
			platformIDs = append(platformIDs, group.ID)
		}
	}
	counts, err := s.repo.ArkPortraitAssetStatusCounts(groupIDs)
	if err != nil {
		return nil, err
	}
	grants, err := s.repo.ArkPortraitGroupGrantUsers(platformIDs)
	if err != nil {
		return nil, err
	}
	var members []model.ArkPortraitAsset
	if withAssets {
		if members, err = s.repo.ArkPortraitAssetsForGroups(groupIDs, nil); err != nil {
			return nil, err
		}
		for _, member := range members {
			userIDs = append(userIDs, member.UserID)
		}
	}
	for _, ids := range grants {
		userIDs = append(userIDs, ids...)
	}
	users, err := s.repo.UsersByIDs(uniqueStrings(userIDs))
	if err != nil {
		return nil, err
	}
	assetsByGroup := map[string][]ArkPortraitAssetView{}
	if withAssets {
		views, err := s.arkAssetViewsForUser("", members)
		if err != nil {
			return nil, err
		}
		for index, view := range views {
			view.Uploader = arkUserSummary(users, members[index].UserID)
			assetsByGroup[view.GroupID] = append(assetsByGroup[view.GroupID], view)
		}
	}
	items := make([]ArkPortraitGroupView, 0, len(groups))
	for _, group := range groups {
		view := arkPortraitGroupView(group, setting, now)
		view.Owner = arkUserSummary(users, group.UserID)
		view.AssetCounts = counts[group.ID]
		if view.AssetCounts == nil {
			view.AssetCounts = map[string]int64{}
		}
		for _, userID := range grants[group.ID] {
			if summary := arkUserSummary(users, userID); summary != nil {
				view.GrantUsers = append(view.GrantUsers, *summary)
			}
		}
		if items := assetsByGroup[group.ID]; items != nil {
			view.Assets = items
		}
		items = append(items, view)
	}
	return items, nil
}

func arkUserSummary(users map[string]model.User, id string) *ArkUserSummary {
	user, ok := users[id]
	if !ok {
		if id == "" {
			return nil
		}
		return &ArkUserSummary{ID: id}
	}
	return &ArkUserSummary{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

// AdminCreateArkGroup 创建或登记平台素材组。真人素材组只能登记控制台已有的组或通过 H5 认证生成。
func (s *Service) AdminCreateArkGroup(ctx context.Context, actor *model.User, req AdminArkGroupCreateRequest) (*ArkPortraitGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	kind := strings.TrimSpace(req.Kind)
	if !validArkGroupKind(kind) {
		return nil, BadAuthRequest("请选择素材组类型：真人、虚拟或版权 IP")
	}
	input, err := normalizeArkGroupInput(ArkGroupInput{Name: req.Name, Description: req.Description})
	if err != nil {
		return nil, err
	}
	grantUserIDs, err := s.validArkGrantUsers(req.GrantUserIDs)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	group := &model.ArkPortraitGroup{
		ID: newID(), UserID: actor.ID, Kind: kind, Scope: arkGroupScopePlatform, Name: input.Name, Description: input.Description,
		Site: setting.Site, Region: setting.Region, ProjectName: setting.ProjectName, GrantAll: req.GrantAll,
	}
	groupID := strings.TrimSpace(req.GroupID)
	if groupID == "" {
		if kind == arkGroupKindReal {
			return nil, BadAuthRequest("真人素材组需要本人完成 H5 认证，或登记方舟控制台已授权的素材组 ID")
		}
		if group.GroupID, err = s.createArkAssetGroupUpstream(ctx, setting, input); err != nil {
			return nil, err
		}
		group.Source = arkGroupSourceCreated
	} else {
		if !arkPortraitGroupIDPattern.MatchString(groupID) {
			return nil, BadAuthRequest("请填写 group- 开头的方舟素材组 ID")
		}
		response, err := callArkPrivateAssetAPI(ctx, setting, "GetAssetGroup", map[string]interface{}{"Id": groupID, "ProjectName": setting.ProjectName})
		if err != nil {
			return nil, BadAuthRequest("读取方舟素材组失败：" + safeArkPortraitError(err))
		}
		groupType := arkPrivateAssetResponseField(response, "GroupType")
		if kind == arkGroupKindReal && groupType != "" && !strings.EqualFold(groupType, arkPortraitGroupType) {
			return nil, BadAuthRequest("该素材组不是真人人像（LivenessFace）素材组")
		}
		if kind != arkGroupKindReal && strings.EqualFold(groupType, arkPortraitGroupType) {
			return nil, BadAuthRequest("该素材组是真人人像素材组，请选择「真人」类型登记")
		}
		group.GroupID, group.Source = groupID, arkGroupSourceManual
		if kind == arkGroupKindReal {
			now := time.Now()
			expiresAt := now.Add(time.Duration(setting.RealAuthorizationDays) * 24 * time.Hour)
			group.AuthorizedAt, group.ExpiresAt = &now, &expiresAt
		}
	}
	registered, err := s.repo.CreateArkPortraitGroupWithCharge(group, "")
	if errors.Is(err, repository.ErrArkPortraitGroupTaken) {
		return nil, NewAppError(http.StatusConflict, "该方舟素材组已登记在其他账号名下")
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.ReplaceArkPortraitGroupGrants(registered.ID, req.GrantAll, grantUserIDs, actor.ID); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "ark_group.create", "ark_portrait_group", registered.ID, "创建平台方舟素材组", map[string]any{"kind": kind, "groupId": registered.GroupID, "source": registered.Source, "grantAll": req.GrantAll, "grantUsers": len(grantUserIDs)}); err != nil {
		return nil, err
	}
	return s.AdminArkGroup(actor, registered.ID)
}

// AdminCreateArkPortraitSession 管理员为平台真人素材组发起 H5 认证；不收费、不占用户额度。
func (s *Service) AdminCreateArkPortraitSession(ctx context.Context, actor *model.User, name, description, lang string) (*ArkPortraitSessionView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.createArkPortraitSession(ctx, actor, name, description, lang, arkGroupScopePlatform)
}

func (s *Service) AdminUpdateArkGroup(actor *model.User, id string, req AdminArkGroupUpdateRequest) (*ArkPortraitGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	group, err := s.adminArkGroup(id)
	if err != nil {
		return nil, err
	}
	name, description := group.Name, group.Description
	if req.Name != nil {
		name = *req.Name
	}
	if req.Description != nil {
		description = *req.Description
	}
	input, err := normalizeArkGroupInput(ArkGroupInput{Name: name, Description: description})
	if err != nil {
		return nil, err
	}
	group.Name, group.Description = input.Name, input.Description
	if req.ExpiresAt != nil {
		if group.Kind != arkGroupKindReal {
			return nil, BadAuthRequest("只有真人素材组有授权有效期")
		}
		expiresAt := req.ExpiresAt.UTC()
		group.ExpiresAt = &expiresAt
	}
	if err := s.repo.SaveArkPortraitGroup(group); err != nil {
		return nil, err
	}
	if req.GrantAll != nil || req.GrantUserIDs != nil {
		if group.Scope != arkGroupScopePlatform {
			return nil, BadAuthRequest("只有平台素材组可以设置授权范围")
		}
		grantAll := group.GrantAll
		if req.GrantAll != nil {
			grantAll = *req.GrantAll
		}
		var requested []string
		if req.GrantUserIDs != nil {
			requested = *req.GrantUserIDs
		} else {
			current, err := s.repo.ArkPortraitGroupGrantUsers([]string{group.ID})
			if err != nil {
				return nil, err
			}
			requested = current[group.ID]
		}
		grantUserIDs, err := s.validArkGrantUsers(requested)
		if err != nil {
			return nil, err
		}
		if err := s.repo.ReplaceArkPortraitGroupGrants(group.ID, grantAll, grantUserIDs, actor.ID); err != nil {
			return nil, err
		}
	}
	if err := s.appendAdminAudit(actor, "ark_group.update", "ark_portrait_group", group.ID, "修改方舟素材组", map[string]any{"name": group.Name, "expiresAt": group.ExpiresAt, "grantAll": req.GrantAll, "grantUsersChanged": req.GrantUserIDs != nil}); err != nil {
		return nil, err
	}
	return s.AdminArkGroup(actor, group.ID)
}

func (s *Service) AdminDeleteArkGroup(ctx context.Context, actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	group, err := s.adminArkGroup(id)
	if err != nil {
		return err
	}
	if err := s.deleteArkGroup(ctx, group); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "ark_group.delete", "ark_portrait_group", group.ID, "删除方舟素材组", map[string]any{"kind": group.Kind, "scope": group.Scope, "groupId": group.GroupID, "owner": group.UserID})
}

// AdminCreateArkPortraitAsset 管理员向平台素材组上传素材，免平台审核，直接提交方舟。
func (s *Service) AdminCreateArkPortraitAsset(ctx context.Context, actor *model.User, groupID string, input ArkAssetUploadInput) (*ArkPortraitAssetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	group, err := s.adminArkGroup(groupID)
	if err != nil {
		return nil, err
	}
	if group.Scope != arkGroupScopePlatform {
		return nil, BadAuthRequest("用户自建素材组只能由用户本人上传")
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	resource, err := s.arkUploadableResource(actor.ID, group, setting, input.ResourceID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	asset := &model.ArkPortraitAsset{
		ID: newID(), UserID: actor.ID, GroupID: group.ID, ResourceID: resource.ID, AssetType: "Image",
		Name: truncateRunes(firstNonEmpty(strings.TrimSpace(input.Name), "asset-"+resource.ID), 120), ReviewedBy: actor.ID, ReviewedAt: &now,
	}
	if err := s.submitArkPortraitAsset(ctx, setting, *group, asset, resource); err != nil {
		return nil, err
	}
	if err := s.repo.CreateArkPortraitAsset(asset); err != nil {
		return nil, err
	}
	view := arkPortraitAssetView(*asset)
	view.MimeType, view.Width, view.Height, view.Bytes = resource.MimeType, resource.Width, resource.Height, resource.Size
	return &view, nil
}

func (s *Service) AdminDeleteArkPortraitAsset(ctx context.Context, actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	asset, err := s.repo.ArkPortraitAsset(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("素材不存在")
	}
	if err != nil {
		return err
	}
	group, err := s.adminArkGroup(asset.GroupID)
	if err != nil {
		return err
	}
	if err := s.deleteArkPortraitAsset(ctx, asset, group); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "ark_asset.delete", "ark_portrait_asset", asset.ID, "删除方舟素材", map[string]any{"group": group.ID, "arkAssetId": asset.ArkAssetID, "uploader": asset.UserID})
}

// AdminArkReviewQueue 返回待审核（默认）或已驳回的用户上传。
func (s *Service) AdminArkReviewQueue(actor *model.User, status string, page int, pageSize int) (*AdminArkReviewPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	status = firstNonEmpty(strings.TrimSpace(status), arkPortraitAssetPendingReview)
	if status != arkPortraitAssetPendingReview && status != arkPortraitAssetRejected {
		return nil, BadAuthRequest("审核状态无效")
	}
	page, pageSize = normalizeAdminPage(page, pageSize)
	items, total, err := s.repo.ArkPortraitReviewQueue(status, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	groupIDs := make([]string, 0, len(items))
	userIDs := make([]string, 0, len(items))
	for _, item := range items {
		groupIDs = append(groupIDs, item.GroupID)
		userIDs = append(userIDs, item.UserID)
	}
	groups, err := s.repo.ArkPortraitGroupsByIDs(uniqueStrings(groupIDs))
	if err != nil {
		return nil, err
	}
	users, err := s.repo.UsersByIDs(uniqueStrings(userIDs))
	if err != nil {
		return nil, err
	}
	views, err := s.arkAssetViewsForUser("", items)
	if err != nil {
		return nil, err
	}
	for index := range views {
		views[index].Uploader = arkUserSummary(users, items[index].UserID)
		if group, ok := groups[items[index].GroupID]; ok {
			views[index].Group = &ArkPortraitGroupRef{ID: group.ID, Name: group.Name, Kind: group.Kind, Scope: group.Scope}
		}
	}
	return &AdminArkReviewPage{Items: views, Total: total, Page: page, PageSize: pageSize}, nil
}

// AdminApproveArkAssets 通过待审核素材并提交方舟；单条失败保留为待审核并返回原因，不影响其他条目。
func (s *Service) AdminApproveArkAssets(ctx context.Context, actor *model.User, ids []string) (*AdminArkReviewResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids, err := arkReviewIDs(ids)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	items, err := s.repo.ArkPortraitAssetsByIDs(ids)
	if err != nil {
		return nil, err
	}
	result := &AdminArkReviewResult{Succeeded: []string{}, Failed: []AdminArkReviewFailed{}}
	found := make(map[string]bool, len(items))
	for index := range items {
		asset := &items[index]
		found[asset.ID] = true
		if err := s.approveArkAsset(ctx, actor, setting, asset); err != nil {
			result.Failed = append(result.Failed, AdminArkReviewFailed{ID: asset.ID, Error: err.Error()})
			continue
		}
		result.Succeeded = append(result.Succeeded, asset.ID)
	}
	for _, id := range ids {
		if !found[id] {
			result.Failed = append(result.Failed, AdminArkReviewFailed{ID: id, Error: "素材不存在"})
		}
	}
	if err := s.appendAdminAudit(actor, "ark_asset.approve", "ark_portrait_asset", strings.Join(result.Succeeded, ","), "通过方舟素材上传", map[string]any{"succeeded": len(result.Succeeded), "failed": len(result.Failed)}); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) approveArkAsset(ctx context.Context, actor *model.User, setting arkPrivateAssetSettingValue, asset *model.ArkPortraitAsset) error {
	if asset.Status != arkPortraitAssetPendingReview {
		return errors.New("该素材已处理，请刷新列表")
	}
	group, err := s.adminArkGroup(asset.GroupID)
	if err != nil {
		return err
	}
	resource, err := s.repo.ResourceForUser(asset.UserID, asset.ResourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("上传者已删除素材文件")
	}
	if err != nil {
		return err
	}
	if !arkPortraitGroupAvailable(*group, setting) {
		return errors.New("素材组所在的方舟项目已更换，无法提交")
	}
	if arkGroupExpired(*group, time.Now()) {
		return errors.New("真人素材组授权已过期")
	}
	if err := s.submitArkPortraitAsset(ctx, setting, *group, asset, resource); err != nil {
		return err
	}
	now := time.Now()
	asset.ReviewedBy, asset.ReviewedAt = actor.ID, &now
	return s.repo.SaveArkPortraitAsset(asset)
}

// AdminRejectArkAssets 驳回待审核素材；原因会展示给上传者。
func (s *Service) AdminRejectArkAssets(actor *model.User, ids []string, reason string) (*AdminArkReviewResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids, err := arkReviewIDs(ids)
	if err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len([]rune(reason)) > 200 {
		return nil, BadAuthRequest("请填写 1-200 个字的驳回原因")
	}
	items, err := s.repo.ArkPortraitAssetsByIDs(ids)
	if err != nil {
		return nil, err
	}
	result := &AdminArkReviewResult{Succeeded: []string{}, Failed: []AdminArkReviewFailed{}}
	now := time.Now()
	for index := range items {
		asset := &items[index]
		if asset.Status != arkPortraitAssetPendingReview {
			result.Failed = append(result.Failed, AdminArkReviewFailed{ID: asset.ID, Error: "该素材已处理，请刷新列表"})
			continue
		}
		asset.Status, asset.Error, asset.ReviewedBy, asset.ReviewedAt = arkPortraitAssetRejected, reason, actor.ID, &now
		if err := s.repo.SaveArkPortraitAsset(asset); err != nil {
			return nil, err
		}
		result.Succeeded = append(result.Succeeded, asset.ID)
	}
	if err := s.appendAdminAudit(actor, "ark_asset.reject", "ark_portrait_asset", strings.Join(result.Succeeded, ","), "驳回方舟素材上传", map[string]any{"reason": reason, "count": len(result.Succeeded)}); err != nil {
		return nil, err
	}
	return result, nil
}

func arkReviewIDs(ids []string) ([]string, error) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 || len(ids) > 100 {
		return nil, BadAuthRequest("每次请选择 1-100 份素材")
	}
	return ids, nil
}

func (s *Service) adminArkGroup(id string) (*model.ArkPortraitGroup, error) {
	group, err := s.repo.ArkPortraitGroup(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材组不存在")
	}
	return group, err
}

// validArkGrantUsers 去重并确认授权用户都存在。
func (s *Service) validArkGrantUsers(ids []string) ([]string, error) {
	ids = uniqueStrings(ids)
	if len(ids) > maxArkGrantUsers {
		return nil, BadAuthRequest("单个素材组最多逐个授权 500 位用户，更多用户请选择「全部用户」")
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	if len(users) != len(ids) {
		return nil, BadAuthRequest("授权用户中有不存在的账号，请刷新后重新选择")
	}
	return ids, nil
}
