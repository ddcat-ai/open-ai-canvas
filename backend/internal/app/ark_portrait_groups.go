package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// ArkGroupInput 是创建或修改素材组时的名称与说明。
type ArkGroupInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func normalizeArkGroupInput(input ArkGroupInput) (ArkGroupInput, error) {
	input.Name, input.Description = strings.TrimSpace(input.Name), strings.TrimSpace(input.Description)
	if input.Name == "" || len([]rune(input.Name)) > 40 {
		return input, BadAuthRequest("请填写 1-40 个字的素材组名称")
	}
	if len([]rune(input.Description)) > 200 {
		return input, BadAuthRequest("素材组说明最多 200 个字")
	}
	return input, nil
}

// CreateArkVirtualGroup 为用户创建虚拟人像素材组：先冻结费用，方舟建组成功后结算，失败自动退回。
func (s *Service) CreateArkVirtualGroup(ctx context.Context, actor *model.User, input ArkGroupInput) (*ArkPortraitGroupView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	input, err := normalizeArkGroupInput(input)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	if !setting.VirtualEnabled {
		return nil, Forbidden("管理员尚未开放虚拟素材组")
	}
	count, err := s.repo.CountArkPortraitUserGroups(actor.ID, arkGroupKindVirtual)
	if err != nil {
		return nil, err
	}
	if count >= int64(setting.VirtualGroupLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("每个账号最多创建 %d 个虚拟素材组", setting.VirtualGroupLimit))
	}
	price, err := s.arkGroupCharge(setting, arkGroupKindVirtual)
	if err != nil {
		return nil, err
	}
	group := &model.ArkPortraitGroup{
		ID: newID(), UserID: actor.ID, Kind: arkGroupKindVirtual, Scope: arkGroupScopeUser, Name: input.Name, Description: input.Description,
		Site: setting.Site, Region: setting.Region, ProjectName: setting.ProjectName, Source: arkGroupSourceCreated,
	}
	if price > 0 {
		order := arkGroupBillingOrder(actor.ID, "group:"+group.ID, arkGroupKindVirtual, price)
		if err := s.repo.ReserveBillingOrder(order); err != nil {
			if errors.Is(err, repository.ErrInsufficientCredits) {
				return nil, insufficientArkCredits(price)
			}
			return nil, err
		}
		group.BillingOrderID = order.ID
	}
	refund := func(note string, cause error) (*ArkPortraitGroupView, error) {
		if group.BillingOrderID != "" {
			if err := s.repo.RefundArkGroupBillingOrder(group.BillingOrderID, note); err != nil {
				return nil, errors.Join(cause, err)
			}
		}
		return nil, cause
	}
	groupID, err := s.createArkAssetGroupUpstream(ctx, setting, input)
	if err != nil {
		return refund("创建虚拟素材组失败，冻结积分已退回", err)
	}
	group.GroupID = groupID
	registered, err := s.repo.CreateArkPortraitGroupWithCharge(group, arkGroupSettleNote(arkGroupKindVirtual, input.Name))
	if err != nil {
		return refund("登记虚拟素材组失败，冻结积分已退回", err)
	}
	view := arkPortraitGroupView(*registered, setting, time.Now())
	view.Owned = true
	return &view, nil
}

// createArkAssetGroupUpstream 在方舟创建 AIGC 素材组（虚拟人像与版权 IP 共用）。
func (s *Service) createArkAssetGroupUpstream(ctx context.Context, setting arkPrivateAssetSettingValue, input ArkGroupInput) (string, error) {
	payload := map[string]interface{}{"Name": input.Name, "GroupType": arkPrivateAssetGroupType, "ProjectName": setting.ProjectName}
	if input.Description != "" {
		payload["Description"] = input.Description
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "CreateAssetGroup", payload)
	if err != nil {
		return "", WrapAppError(http.StatusBadGateway, "创建方舟素材组失败："+safeArkPortraitError(err), err)
	}
	groupID := arkPrivateAssetResponseField(response, "GroupId", "GroupID", "group_id", "Id", "ID", "id")
	if !arkPortraitGroupIDPattern.MatchString(groupID) {
		return "", NewAppError(http.StatusBadGateway, "方舟未返回有效的素材组 ID")
	}
	return groupID, nil
}

// UpdateArkGroup 修改用户自建素材组的本地名称与说明；方舟侧素材组不变。
func (s *Service) UpdateArkGroup(actor *model.User, id string, input ArkGroupInput) (*ArkPortraitGroupView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	input, err := normalizeArkGroupInput(input)
	if err != nil {
		return nil, err
	}
	group, err := s.arkUserGroupForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	group.Name, group.Description = input.Name, input.Description
	if err := s.repo.SaveArkPortraitGroup(group); err != nil {
		return nil, err
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	view := arkPortraitGroupView(*group, setting, time.Now())
	view.Owned = true
	return &view, nil
}

// DeleteArkGroup 删除用户自建素材组；已付费用不退还。
func (s *Service) DeleteArkGroup(ctx context.Context, actor *model.User, id string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	group, err := s.arkUserGroupForUser(actor.ID, id)
	if err != nil {
		return err
	}
	return s.deleteArkGroup(ctx, group)
}

// deleteArkGroup 先删除方舟侧素材组（受方舟授权状态限制，可能失败），成功后才删除本地记录并取消素材库认证。
func (s *Service) deleteArkGroup(ctx context.Context, group *model.ArkPortraitGroup) error {
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return err
	}
	if arkPortraitGroupAvailable(*group, setting) {
		if _, err := callArkPrivateAssetAPI(ctx, setting, "DeleteAssetGroup", map[string]interface{}{"Id": group.GroupID, "ProjectName": group.ProjectName}); err != nil && !arkPortraitNotFound(err) {
			return BadAuthRequest("删除方舟素材组失败：" + safeArkPortraitError(err))
		}
	}
	members, err := s.repo.ArkPortraitAssetsForGroups([]string{group.ID}, nil)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteArkPortraitGroupCascade(group.ID); err != nil {
		return err
	}
	for _, member := range members {
		s.uncertifyArkLibraryAssets(member)
	}
	return nil
}

// ArkAssetUploadInput 是加入素材组的一份资源；LibraryAssetID 非空时表示从素材库提交认证。
type ArkAssetUploadInput struct {
	ResourceID     string `json:"resourceId"`
	Name           string `json:"name"`
	LibraryAssetID string `json:"libraryAssetId"`
}

// CreateArkPortraitAsset 把用户自己的图片加入自建素材组。需要平台审核时先进入审核队列，管理员通过后才提交方舟。
func (s *Service) CreateArkPortraitAsset(ctx context.Context, actor *model.User, groupID string, input ArkAssetUploadInput) (*ArkPortraitAssetView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	group, err := s.arkUserGroupForUser(actor.ID, groupID)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	resource, err := s.arkUploadableResource(actor.ID, group, setting, input.ResourceID)
	if err != nil {
		return nil, err
	}
	libraryAssetID := strings.TrimSpace(input.LibraryAssetID)
	if libraryAssetID != "" {
		if err := s.validateArkLibrarySubmission(actor.ID, libraryAssetID, resource.ID); err != nil {
			return nil, err
		}
	}
	asset := &model.ArkPortraitAsset{
		ID: newID(), UserID: actor.ID, GroupID: group.ID, ResourceID: resource.ID, AssetType: "Image",
		Name: truncateRunes(firstNonEmpty(strings.TrimSpace(input.Name), "portrait-"+resource.ID), 120), Status: arkPortraitAssetPendingReview,
		LibraryAssetID: libraryAssetID,
	}
	if !setting.reviewRequired(group.Kind) {
		if err := s.submitArkPortraitAsset(ctx, setting, *group, asset, resource); err != nil {
			return nil, err
		}
	}
	if err := s.repo.CreateArkPortraitAsset(asset); err != nil {
		return nil, err
	}
	view := arkPortraitAssetView(*asset)
	view.LibraryAssetID = asset.LibraryAssetID
	view.MimeType, view.Width, view.Height, view.Bytes = resource.MimeType, resource.Width, resource.Height, resource.Size
	return &view, nil
}

// arkUploadableResource 校验素材组仍可上传，且资源属于上传者、已就绪且是图片。
func (s *Service) arkUploadableResource(userID string, group *model.ArkPortraitGroup, setting arkPrivateAssetSettingValue, resourceID string) (*model.Resource, error) {
	if !arkPortraitGroupAvailable(*group, setting) {
		return nil, NewAppError(http.StatusConflict, "管理员已更换方舟站点、Region 或项目，该素材组已不可用")
	}
	if arkGroupExpired(*group, time.Now()) {
		return nil, BadAuthRequest("该真人素材组授权已过期，请重新认证后再上传")
	}
	count, err := s.repo.CountArkPortraitGroupAssets(group.ID)
	if err != nil {
		return nil, err
	}
	if count >= maxArkPortraitAssetsPerGroup {
		return nil, BadAuthRequest(fmt.Sprintf("每个素材组最多 %d 份素材", maxArkPortraitAssetsPerGroup))
	}
	resource, err := s.Resource(userID, strings.TrimSpace(resourceID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材文件不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("素材文件尚未上传完成")
	}
	if arkPortraitAssetType(resource.MimeType) != "Image" {
		return nil, BadAuthRequest("方舟素材组当前只支持上传图片")
	}
	if resource.Size > arkPortraitMaxImageBytes {
		return nil, BadAuthRequest("方舟素材图片不能超过 30MB")
	}
	return resource, nil
}

// validateArkLibrarySubmission 确认要认证的素材库图片属于用户、引用同一资源，且没有正在进行或已完成的认证。
func (s *Service) validateArkLibrarySubmission(userID string, libraryAssetID string, resourceID string) error {
	record, err := s.repo.AssetForUser(userID, libraryAssetID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("素材库素材不存在")
	}
	if err != nil {
		return err
	}
	if record.Kind != "image" || !strings.Contains(record.PayloadJSON, `"resource:`+resourceID+`"`) {
		return BadAuthRequest("只能提交素材库中已上传到云端的图片")
	}
	if record.Category == model.AssetCategoryArk {
		return BadAuthRequest("该素材已完成方舟认证")
	}
	existing, err := s.repo.ArkPortraitSubmissionForLibraryAsset(userID, libraryAssetID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	// 已通过的认证只对应当时的文件；素材图片换成其他文件后允许重新认证。
	if existing.Status == arkPortraitAssetActive && existing.ResourceID != resourceID {
		return nil
	}
	if existing.Status == arkPortraitAssetActive {
		return BadAuthRequest("该素材已完成方舟认证")
	}
	return BadAuthRequest("该素材已提交方舟认证，请等待审核结果")
}

// submitArkPortraitAsset 调用方舟 CreateAsset 提交素材，成功后进入方舟审核（processing）。
func (s *Service) submitArkPortraitAsset(ctx context.Context, setting arkPrivateAssetSettingValue, group model.ArkPortraitGroup, asset *model.ArkPortraitAsset, resource *model.Resource) error {
	resourceURL, err := s.providerResourceURL(resource, time.Now().Add(time.Hour))
	if err != nil {
		return fmt.Errorf("生成素材临时地址失败：%w", err)
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "CreateAsset", map[string]interface{}{
		"GroupId":     group.GroupID,
		"URL":         resourceURL,
		"AssetType":   asset.AssetType,
		"Name":        asset.Name,
		"ProjectName": group.ProjectName,
	})
	if err != nil {
		return BadAuthRequest("提交方舟素材失败：" + safeArkPortraitError(err))
	}
	arkAssetID := arkPrivateAssetResponseField(response, "Id", "AssetId", "ID")
	if !strings.HasPrefix(arkAssetID, "asset-") {
		return NewAppError(http.StatusBadGateway, "方舟未返回有效的素材 ID")
	}
	asset.ArkAssetID, asset.Status, asset.Error = arkAssetID, arkPortraitAssetProcessing, ""
	return nil
}

// RefreshArkPortraitAsset 主动查询一份自建组素材的方舟审核结果。
func (s *Service) RefreshArkPortraitAsset(ctx context.Context, actor *model.User, id string) (*ArkPortraitAssetView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	asset, group, err := s.arkOwnedAsset(actor.ID, id)
	if err != nil {
		return nil, err
	}
	if asset.Status == arkPortraitAssetProcessing {
		setting, err := s.arkCredentialSetting()
		if err != nil {
			return nil, err
		}
		if !arkPortraitGroupAvailable(*group, setting) {
			return nil, NewAppError(http.StatusConflict, "管理员已更换方舟站点、Region 或项目，该素材组已不可用")
		}
		if err := s.refreshArkPortraitAssetStatus(ctx, setting, asset, *group); err != nil {
			return nil, BadAuthRequest("查询方舟素材状态失败：" + safeArkPortraitError(err))
		}
	}
	views, err := s.arkAssetViewsForUser(actor.ID, []model.ArkPortraitAsset{*asset})
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

// refreshArkPortraitAssetStatus 查询方舟审核结果；通过后写入素材库，失败记录原因。仍在审核时不改动。
func (s *Service) refreshArkPortraitAssetStatus(ctx context.Context, setting arkPrivateAssetSettingValue, asset *model.ArkPortraitAsset, group model.ArkPortraitGroup) error {
	response, err := callArkPrivateAssetAPI(ctx, setting, "GetAsset", map[string]interface{}{"Id": asset.ArkAssetID, "ProjectName": group.ProjectName})
	if err != nil {
		return err
	}
	switch strings.ToLower(arkPrivateAssetResponseField(response, "Status", "status")) {
	case "active":
		asset.Status, asset.Error = arkPortraitAssetActive, ""
		if err := s.repo.SaveArkPortraitAsset(asset); err != nil {
			return err
		}
		return s.syncArkLibraryAfterActive(asset, group)
	case "failed":
		asset.Status = arkPortraitAssetFailed
		asset.Error = truncateRunes(defaultString(arkPrivateAssetResponseField(response, "ErrorMessage", "Message", "message"), arkAssetFailureHint(group.Kind)), 1000)
		return s.repo.SaveArkPortraitAsset(asset)
	default:
		return s.repo.TouchArkPortraitAsset(asset.ID)
	}
}

func arkAssetFailureHint(kind string) string {
	if kind == arkGroupKindReal {
		return "素材未通过方舟面部一致性校验，请上传本人清晰的正面素材"
	}
	return "素材未通过方舟审核，请确认图片不含真人肖像且拥有使用权"
}

// DeleteArkPortraitAsset 删除用户自建组内的一份素材；已提交方舟的先删方舟侧，再删本地记录并取消素材库认证。
func (s *Service) DeleteArkPortraitAsset(ctx context.Context, actor *model.User, id string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	asset, group, err := s.arkOwnedAsset(actor.ID, id)
	if err != nil {
		return err
	}
	return s.deleteArkPortraitAsset(ctx, asset, group)
}

func (s *Service) deleteArkPortraitAsset(ctx context.Context, asset *model.ArkPortraitAsset, group *model.ArkPortraitGroup) error {
	if asset.ArkAssetID != "" {
		setting, err := s.arkCredentialSetting()
		if err != nil {
			return err
		}
		if arkPortraitGroupAvailable(*group, setting) {
			if _, err := callArkPrivateAssetAPI(ctx, setting, "DeleteAsset", map[string]interface{}{"Id": asset.ArkAssetID, "ProjectName": group.ProjectName}); err != nil && !arkPortraitNotFound(err) {
				return BadAuthRequest("删除方舟素材失败：" + safeArkPortraitError(err))
			}
		}
	}
	if err := s.repo.DeleteArkPortraitAsset(asset.ID); err != nil {
		return err
	}
	s.uncertifyArkLibraryAssets(*asset)
	return nil
}

// AddArkPortraitAssetToLibrary 把已通过的方舟图片加入当前用户素材库的「方舟认证」分类，返回素材库素材 ID。
// 平台素材会复制成用户自己的资源；重复加入返回同一素材。
func (s *Service) AddArkPortraitAssetToLibrary(actor *model.User, id string) (string, error) {
	if actor == nil {
		return "", Unauthorized("请先登录")
	}
	asset, group, err := s.arkViewableAsset(actor, id)
	if err != nil {
		return "", err
	}
	if asset.Status != arkPortraitAssetActive || asset.AssetType != "Image" {
		return "", BadAuthRequest("只有已通过方舟审核的图片可以加入素材库")
	}
	if arkGroupExpired(*group, time.Now()) {
		return "", BadAuthRequest("该真人素材组授权已过期，请重新认证")
	}
	if asset.UserID == actor.ID {
		if asset.LibraryAssetID != "" {
			ok, err := s.certifyArkLibraryAsset(actor.ID, asset.LibraryAssetID, *asset, *group, asset.ResourceID)
			if err != nil {
				return "", err
			}
			if ok {
				return asset.LibraryAssetID, nil
			}
		}
		resource, err := s.repo.ResourceForUser(actor.ID, asset.ResourceID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", NotFound("该方舟素材的原图已被删除，无法加入素材库")
		}
		if err != nil {
			return "", err
		}
		libraryID := arkOwnLibraryAssetID(asset.ID)
		if err := s.createArkLibraryAsset(actor.ID, libraryID, resource, *asset, *group); err != nil {
			return "", err
		}
		if asset.LibraryAssetID != libraryID {
			if err := s.repo.SetArkPortraitAssetLibraryAsset(asset.ID, libraryID); err != nil {
				return "", err
			}
		}
		return libraryID, nil
	}
	libraryID := arkSharedLibraryAssetID(asset.ID, actor.ID)
	resource, err := s.copyArkResourceForUser(actor.ID, *asset)
	if err != nil {
		return "", err
	}
	if err := s.createArkLibraryAsset(actor.ID, libraryID, resource, *asset, *group); err != nil {
		return "", err
	}
	return libraryID, nil
}

// PrepareArkPortraitAssetDelivery 返回方舟素材的预览文件。素材上传者、授权用户和管理员可以查看，
// 文件仍按上传者的资源与存储配置读取。
func (s *Service) PrepareArkPortraitAssetDelivery(actor *model.User, id string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	asset, _, err := s.arkViewableAsset(actor, id)
	if err != nil {
		return nil, err
	}
	resource, err := s.repo.ResourceForUser(asset.UserID, asset.ResourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材文件已删除")
	}
	if err != nil {
		return nil, err
	}
	resource.Provider = normalizedResourceProvider(resource.Provider)
	options, err = assets.NormalizeAccessOptions(options, false)
	if err != nil {
		return nil, err
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

func (s *Service) arkUserGroupForUser(userID, id string) (*model.ArkPortraitGroup, error) {
	group, err := s.repo.ArkPortraitUserGroupForUser(userID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材组不存在")
	}
	return group, err
}

// arkOwnedAsset 返回用户自建组内由本人上传的素材。
func (s *Service) arkOwnedAsset(userID, id string) (*model.ArkPortraitAsset, *model.ArkPortraitGroup, error) {
	asset, err := s.repo.ArkPortraitAsset(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && asset.UserID != userID) {
		return nil, nil, NotFound("素材不存在")
	}
	if err != nil {
		return nil, nil, err
	}
	group, err := s.arkUserGroupForUser(userID, asset.GroupID)
	if err != nil {
		return nil, nil, err
	}
	return asset, group, nil
}

// arkViewableAsset 返回当前用户可以查看的素材：自建组的本人素材、授权平台组内已通过的素材，管理员可查看全部。
func (s *Service) arkViewableAsset(actor *model.User, id string) (*model.ArkPortraitAsset, *model.ArkPortraitGroup, error) {
	if actor == nil {
		return nil, nil, Unauthorized("请先登录")
	}
	asset, err := s.repo.ArkPortraitAsset(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, NotFound("素材不存在")
	}
	if err != nil {
		return nil, nil, err
	}
	group, err := s.repo.ArkPortraitGroup(asset.GroupID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, NotFound("素材不存在")
	}
	if err != nil {
		return nil, nil, err
	}
	if s.RequireAdmin(actor) == nil || asset.UserID == actor.ID {
		return asset, group, nil
	}
	if group.Scope == arkGroupScopePlatform && asset.Status == arkPortraitAssetActive {
		granted := group.GrantAll
		if !granted {
			if granted, err = s.repo.ArkPortraitGroupGranted(group.ID, actor.ID); err != nil {
				return nil, nil, err
			}
		}
		if granted {
			return asset, group, nil
		}
	}
	return nil, nil, NotFound("素材不存在")
}
