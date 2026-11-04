// 方舟私域真人人像素材库：管理员只配置 IAM 凭据、站点、Region 和 ProjectName，
// 用户各自完成 H5 真人认证，每次认证得到一个只属于自己的 LivenessFace 素材组，
// 再向组内上传同一人的素材，审核通过后以 asset://<id> 在视频生成中引用。
//
// 安全边界：
//   - 回调地址只带一次性随机 state，不带登录态；BytedToken 加密保存且只在服务端换取 GroupId。
//   - 组与素材按用户隔离；任务引用他人已登记的真人素材 ID 时拒绝执行（validateArkPortraitReferences）。
//   - 手动绑定控制台创建的素材组只允许管理员操作，避免普通用户认领同账号下他人的组。

package app

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const (
	arkPortraitGroupType          = "LivenessFace"
	arkPortraitSessionTTL         = 30 * time.Minute
	arkPortraitSuccessCode        = "10000"
	arkPortraitSessionPending     = "pending"
	arkPortraitSessionVerified    = "verified"
	arkPortraitSessionFailed      = "failed"
	arkPortraitSessionExpired     = "expired"
	arkPortraitAssetProcessing    = "processing"
	arkPortraitAssetActive        = "active"
	arkPortraitAssetFailed        = "failed"
	maxArkPortraitSessionsPerHour = 20
	maxArkPortraitGroupsPerUser   = 50
	maxArkPortraitAssetsPerGroup  = 200
	maxArkPortraitRefreshPerList  = 10
)

var (
	arkPortraitGroupIDPattern = regexp.MustCompile(`^group-[A-Za-z0-9-]{1,100}$`)
	arkPortraitStatePattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
)

type ArkPortraitOverview struct {
	Enabled  bool                     `json:"enabled"`
	Site     string                   `json:"site,omitempty"`
	Groups   []ArkPortraitGroupView   `json:"groups"`
	Sessions []ArkPortraitSessionView `json:"sessions"`
}

type ArkPortraitGroupView struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	GroupID   string                 `json:"groupId"`
	Source    string                 `json:"source"`
	Available bool                   `json:"available"`
	CreatedAt time.Time              `json:"createdAt"`
	Assets    []ArkPortraitAssetView `json:"assets"`
}

type ArkPortraitAssetView struct {
	ID         string `json:"id"`
	GroupID    string `json:"groupId"`
	ResourceID string `json:"resourceId"`
	ArkAssetID string `json:"arkAssetId"`
	AssetType  string `json:"assetType"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
	// 资源元数据供前端把已通过的素材加入素材库；资源被删除后为零值。
	MimeType  string    `json:"mimeType,omitempty"`
	Width     int       `json:"width,omitempty"`
	Height    int       `json:"height,omitempty"`
	Bytes     int64     `json:"bytes,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type ArkPortraitSessionView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	H5Link    string    `json:"h5Link,omitempty"`
	GroupID   string    `json:"groupId,omitempty"`
	Error     string    `json:"error,omitempty"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// arkPortraitSetting 读取可用于真人素材库的方舟配置；未开放或缺少凭据时返回明确错误。
func (s *Service) arkPortraitSetting() (arkPrivateAssetSettingValue, error) {
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return setting, err
	}
	if !setting.PortraitEnabled {
		return setting, Forbidden("管理员尚未开放方舟真人素材库")
	}
	if setting.Region == "" || setting.ProjectName == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return setting, BadAuthRequest("方舟真人素材库尚未配置完整，请联系管理员填写 Region、ProjectName 与 IAM AK/SK")
	}
	return setting, nil
}

func arkPortraitGroupAvailable(group model.ArkPortraitGroup, setting arkPrivateAssetSettingValue) bool {
	return group.Site == setting.Site && group.Region == setting.Region && group.ProjectName == setting.ProjectName
}

func (s *Service) ArkPortraitOverview(ctx context.Context, actor *model.User) (*ArkPortraitOverview, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) {
			return &ArkPortraitOverview{Enabled: false, Groups: []ArkPortraitGroupView{}, Sessions: []ArkPortraitSessionView{}}, nil
		}
		return nil, err
	}
	groups, err := s.repo.ArkPortraitGroups(actor.ID)
	if err != nil {
		return nil, err
	}
	assets, err := s.repo.ArkPortraitAssets(actor.ID)
	if err != nil {
		return nil, err
	}
	groupByID := make(map[string]model.ArkPortraitGroup, len(groups))
	for _, group := range groups {
		groupByID[group.ID] = group
	}
	refreshed := 0
	for index := range assets {
		group, ok := groupByID[assets[index].GroupID]
		if !ok || assets[index].Status != arkPortraitAssetProcessing || refreshed >= maxArkPortraitRefreshPerList || !arkPortraitGroupAvailable(group, setting) {
			continue
		}
		refreshed++
		// 列表顺带刷新少量处理中的素材；单条失败不影响列表，用户可稍后再刷新。
		_ = s.refreshArkPortraitAssetStatus(ctx, setting, &assets[index])
	}
	resourceIDs := make([]string, 0, len(assets))
	for _, asset := range assets {
		resourceIDs = append(resourceIDs, asset.ResourceID)
	}
	resources, err := s.repo.ResourcesForUserIDs(actor.ID, resourceIDs)
	if err != nil {
		return nil, err
	}
	resourceByID := make(map[string]model.Resource, len(resources))
	for _, resource := range resources {
		resourceByID[resource.ID] = resource
	}
	views := make([]ArkPortraitGroupView, 0, len(groups))
	assetsByGroup := make(map[string][]ArkPortraitAssetView, len(groups))
	for _, asset := range assets {
		view := arkPortraitAssetView(asset)
		if resource, ok := resourceByID[asset.ResourceID]; ok {
			view.MimeType, view.Width, view.Height, view.Bytes = resource.MimeType, resource.Width, resource.Height, resource.Size
		}
		assetsByGroup[asset.GroupID] = append(assetsByGroup[asset.GroupID], view)
	}
	for _, group := range groups {
		view := arkPortraitGroupView(group, setting)
		if items := assetsByGroup[group.ID]; items != nil {
			view.Assets = items
		}
		views = append(views, view)
	}
	pending, err := s.repo.PendingArkPortraitSessions(actor.ID, time.Now(), 10)
	if err != nil {
		return nil, err
	}
	sessions := make([]ArkPortraitSessionView, 0, len(pending))
	for _, session := range pending {
		sessions = append(sessions, arkPortraitSessionView(session))
	}
	return &ArkPortraitOverview{Enabled: true, Site: setting.Site, Groups: views, Sessions: sessions}, nil
}

// CreateArkPortraitSession 生成 H5 真人认证链接。lang 为界面语言，映射到 H5 支持的 zh / en / zh-Hant。
func (s *Service) CreateArkPortraitSession(ctx context.Context, actor *model.User, name, lang string) (*ArkPortraitSessionView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 {
		return nil, BadAuthRequest("请填写 1-40 个字的真人名称，便于区分不同素材组")
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return nil, err
	}
	callbackBase, err := arkPortraitCallbackBase(setting)
	if err != nil {
		return nil, err
	}
	recent, err := s.repo.CountRecentArkPortraitSessions(actor.ID, time.Now().Add(-time.Hour))
	if err != nil {
		return nil, err
	}
	if recent >= maxArkPortraitSessionsPerHour {
		return nil, RateLimited("真人认证发起过于频繁，请一小时后再试")
	}
	groups, err := s.repo.ArkPortraitGroups(actor.ID)
	if err != nil {
		return nil, err
	}
	if len(groups) >= maxArkPortraitGroupsPerUser {
		return nil, BadAuthRequest(fmt.Sprintf("每个账号最多登记 %d 位真人", maxArkPortraitGroupsPerUser))
	}
	state := randomToken()
	if !arkPortraitStatePattern.MatchString(state) {
		return nil, errors.New("生成真人认证凭据失败")
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "CreateVisualValidateSession", map[string]interface{}{
		"CallbackURL": callbackBase + "/api/ark-portraits/callback/" + state,
		"ProjectName": setting.ProjectName,
	})
	if err != nil {
		return nil, WrapAppError(http.StatusBadGateway, "发起方舟真人认证失败："+safeArkPortraitError(err), err)
	}
	bytedToken := arkPrivateAssetResponseField(response, "BytedToken")
	h5Link, err := arkPortraitH5Link(arkPrivateAssetResponseField(response, "H5Link"), lang)
	if bytedToken == "" || err != nil {
		return nil, NewAppError(http.StatusBadGateway, "方舟未返回有效的真人认证链接")
	}
	tokenCipher, err := s.encryptSettingSecret(bytedToken)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	session := &model.ArkPortraitSession{
		ID: newID(), UserID: actor.ID, State: state, Name: name,
		Site: setting.Site, Region: setting.Region, ProjectName: setting.ProjectName,
		BytedTokenCipher: tokenCipher, Status: arkPortraitSessionPending, ExpiresAt: now.Add(arkPortraitSessionTTL),
	}
	if err := s.repo.CreateArkPortraitSession(session); err != nil {
		return nil, err
	}
	view := arkPortraitSessionView(*session)
	// H5 链接内含方舟签发的临时凭据，只在发起时返回给本人，不落库。
	view.H5Link = h5Link
	return &view, nil
}

// HandleArkPortraitCallback 处理 H5 认证页完成后的跳转（无登录态），返回应重定向到的站内地址。
func (s *Service) HandleArkPortraitCallback(ctx context.Context, state string, query url.Values) string {
	const page = "/assets?arkPortrait="
	state = strings.TrimSpace(state)
	if !arkPortraitStatePattern.MatchString(state) {
		return page + "invalid"
	}
	session, err := s.repo.ArkPortraitSessionByState(state)
	if err != nil {
		return page + "invalid"
	}
	if session.Status != arkPortraitSessionPending {
		return page + session.Status
	}
	if !session.ExpiresAt.After(time.Now()) {
		_, _ = s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionExpired, "", "", "认证会话已过期")
		return page + arkPortraitSessionExpired
	}
	resultCode := strings.TrimSpace(query.Get("resultCode"))
	if resultCode != arkPortraitSuccessCode {
		detail := "真人认证未通过（resultCode=" + truncateRunes(resultCode, 20)
		if sub := strings.TrimSpace(query.Get("algorithmBaseRespCode")); sub != "" {
			detail += "，algorithmBaseRespCode=" + truncateRunes(sub, 20)
		}
		_, _ = s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionFailed, truncateRunes(resultCode, 40), "", detail+"），请重新发起认证")
		return page + arkPortraitSessionFailed
	}
	if token := strings.TrimSpace(query.Get("bytedToken")); token != "" {
		stored, err := s.decryptSettingSecret(session.BytedTokenCipher)
		if err != nil || subtle.ConstantTimeCompare([]byte(stored), []byte(token)) != 1 {
			return page + "invalid"
		}
	}
	if _, err := s.completeArkPortraitSession(ctx, session); err != nil {
		// 保持 pending，用户回到页面后可点击“我已完成认证”重试换取素材组。
		return page + "pending"
	}
	return page + arkPortraitSessionVerified
}

// CheckArkPortraitSession 是回调未到达（例如在手机上完成认证）时的主动查询入口。
func (s *Service) CheckArkPortraitSession(ctx context.Context, actor *model.User, id string) (*ArkPortraitSessionView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	session, err := s.repo.ArkPortraitSessionForUser(actor.ID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("认证会话不存在")
	}
	if err != nil {
		return nil, err
	}
	if session.Status == arkPortraitSessionPending && !session.ExpiresAt.After(time.Now()) {
		_, _ = s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionExpired, "", "", "认证会话已过期")
		session.Status = arkPortraitSessionExpired
	}
	if session.Status == arkPortraitSessionPending {
		if _, err := s.completeArkPortraitSession(ctx, session); err != nil {
			return nil, err
		}
		session, err = s.repo.ArkPortraitSessionForUser(actor.ID, session.ID)
		if err != nil {
			return nil, err
		}
	}
	view := arkPortraitSessionView(*session)
	return &view, nil
}

func (s *Service) completeArkPortraitSession(ctx context.Context, session *model.ArkPortraitSession) (*model.ArkPortraitGroup, error) {
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return nil, err
	}
	if session.Site != setting.Site || session.Region != setting.Region || session.ProjectName != setting.ProjectName {
		return nil, NewAppError(http.StatusConflict, "管理员已更换方舟站点、Region 或项目，请重新发起真人认证")
	}
	token, err := s.decryptSettingSecret(session.BytedTokenCipher)
	if err != nil {
		return nil, err
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "GetVisualValidateResult", map[string]interface{}{
		"BytedToken":  token,
		"ProjectName": session.ProjectName,
	})
	if err != nil {
		return nil, NewAppError(http.StatusConflict, "尚未获取到认证结果："+safeArkPortraitError(err)+"。请在认证页点击“完成”后再试")
	}
	groupID := arkPrivateAssetResponseField(response, "GroupId", "GroupID", "group_id")
	if !arkPortraitGroupIDPattern.MatchString(groupID) {
		return nil, NewAppError(http.StatusBadGateway, "方舟未返回有效的真人素材组 ID")
	}
	group, err := s.registerArkPortraitGroup(session.UserID, session.Name, groupID, "liveness", setting)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionVerified, arkPortraitSuccessCode, groupID, ""); err != nil {
		return nil, err
	}
	return group, nil
}

func (s *Service) registerArkPortraitGroup(userID, name, groupID, source string, setting arkPrivateAssetSettingValue) (*model.ArkPortraitGroup, error) {
	group, created, err := s.repo.CreateArkPortraitGroup(&model.ArkPortraitGroup{
		ID: newID(), UserID: userID, Name: name, Site: setting.Site, Region: setting.Region,
		ProjectName: setting.ProjectName, GroupID: groupID, Source: source,
	})
	if err != nil {
		return nil, err
	}
	if !created && group.UserID != userID {
		return nil, NewAppError(http.StatusConflict, "该真人素材组已被其他账号登记")
	}
	return group, nil
}

// BindArkPortraitGroup 登记在方舟控制台通过扫码授权创建的真人素材组（BytePlus 等未开放 H5 接口时使用）。
func (s *Service) BindArkPortraitGroup(ctx context.Context, actor *model.User, name, groupID string) (*ArkPortraitGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	name, groupID = strings.TrimSpace(name), strings.TrimSpace(groupID)
	if name == "" || len([]rune(name)) > 40 {
		return nil, BadAuthRequest("请填写 1-40 个字的真人名称")
	}
	if !arkPortraitGroupIDPattern.MatchString(groupID) {
		return nil, BadAuthRequest("请填写 group- 开头的方舟素材组 ID")
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return nil, err
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "GetAssetGroup", map[string]interface{}{"Id": groupID, "ProjectName": setting.ProjectName})
	if err != nil {
		return nil, BadAuthRequest("读取方舟素材组失败：" + safeArkPortraitError(err))
	}
	if groupType := arkPrivateAssetResponseField(response, "GroupType"); groupType != "" && !strings.EqualFold(groupType, arkPortraitGroupType) {
		return nil, BadAuthRequest("该素材组不是真人人像（LivenessFace）素材组")
	}
	group, err := s.registerArkPortraitGroup(actor.ID, name, groupID, "manual", setting)
	if err != nil {
		return nil, err
	}
	view := arkPortraitGroupView(*group, setting)
	return &view, nil
}

func (s *Service) RenameArkPortraitGroup(actor *model.User, id, name string) (*ArkPortraitGroupView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 {
		return nil, BadAuthRequest("请填写 1-40 个字的真人名称")
	}
	group, err := s.arkPortraitGroupForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	group.Name = name
	if err := s.repo.SaveArkPortraitGroup(group); err != nil {
		return nil, err
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	view := arkPortraitGroupView(*group, setting)
	return &view, nil
}

// DeleteArkPortraitGroup 先删除方舟侧素材组（受方舟授权状态限制，可能失败），成功后才删除本地记录。
func (s *Service) DeleteArkPortraitGroup(ctx context.Context, actor *model.User, id string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	group, err := s.arkPortraitGroupForUser(actor.ID, id)
	if err != nil {
		return err
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return err
	}
	if arkPortraitGroupAvailable(*group, setting) {
		if _, err := callArkPrivateAssetAPI(ctx, setting, "DeleteAssetGroup", map[string]interface{}{"Id": group.GroupID, "ProjectName": group.ProjectName}); err != nil && !arkPortraitNotFound(err) {
			return BadAuthRequest("删除方舟真人素材组失败：" + safeArkPortraitError(err))
		}
	}
	return s.repo.DeleteArkPortraitGroup(actor.ID, group.ID)
}

// CreateArkPortraitAsset 把用户自己的已上传资源加入真人素材组；方舟比对面部一致性通过后才可用于生成。
func (s *Service) CreateArkPortraitAsset(ctx context.Context, actor *model.User, groupID, resourceID, name string) (*ArkPortraitAssetView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	group, err := s.arkPortraitGroupForUser(actor.ID, groupID)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return nil, err
	}
	if !arkPortraitGroupAvailable(*group, setting) {
		return nil, NewAppError(http.StatusConflict, "管理员已更换方舟站点、Region 或项目，该真人素材组已不可用")
	}
	count, err := s.repo.CountArkPortraitGroupAssets(group.ID)
	if err != nil {
		return nil, err
	}
	if count >= maxArkPortraitAssetsPerGroup {
		return nil, BadAuthRequest(fmt.Sprintf("每位真人最多上传 %d 份素材", maxArkPortraitAssetsPerGroup))
	}
	resource, err := s.Resource(actor.ID, strings.TrimSpace(resourceID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材文件不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("素材文件尚未上传完成")
	}
	assetType := arkPortraitAssetType(resource.MimeType)
	if assetType == "" {
		return nil, BadAuthRequest("真人素材只支持图片、视频或音频文件")
	}
	name = truncateRunes(firstNonEmpty(strings.TrimSpace(name), "portrait-"+resource.ID), 120)
	resourceURL, err := s.providerResourceURL(resource, time.Now().Add(time.Hour))
	if err != nil {
		return nil, fmt.Errorf("生成素材临时地址失败：%w", err)
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "CreateAsset", map[string]interface{}{
		"GroupId":     group.GroupID,
		"URL":         resourceURL,
		"AssetType":   assetType,
		"Name":        name,
		"ProjectName": group.ProjectName,
	})
	if err != nil {
		return nil, BadAuthRequest("上传真人素材失败：" + safeArkPortraitError(err))
	}
	arkAssetID := arkPrivateAssetResponseField(response, "Id", "AssetId", "ID")
	if !strings.HasPrefix(arkAssetID, "asset-") {
		return nil, NewAppError(http.StatusBadGateway, "方舟未返回有效的素材 ID")
	}
	asset := &model.ArkPortraitAsset{
		ID: newID(), UserID: actor.ID, GroupID: group.ID, ResourceID: resource.ID, ArkAssetID: arkAssetID,
		AssetType: assetType, Name: name, Status: arkPortraitAssetProcessing,
	}
	if err := s.repo.CreateArkPortraitAsset(asset); err != nil {
		return nil, err
	}
	view := arkPortraitAssetView(*asset)
	view.MimeType, view.Width, view.Height, view.Bytes = resource.MimeType, resource.Width, resource.Height, resource.Size
	return &view, nil
}

func (s *Service) RefreshArkPortraitAsset(ctx context.Context, actor *model.User, id string) (*ArkPortraitAssetView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	asset, group, err := s.arkPortraitAssetForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return nil, err
	}
	if !arkPortraitGroupAvailable(*group, setting) {
		return nil, NewAppError(http.StatusConflict, "管理员已更换方舟站点、Region 或项目，该真人素材组已不可用")
	}
	if err := s.refreshArkPortraitAssetStatus(ctx, setting, asset); err != nil {
		return nil, BadAuthRequest("查询方舟素材状态失败：" + safeArkPortraitError(err))
	}
	view := arkPortraitAssetView(*asset)
	return &view, nil
}

func (s *Service) DeleteArkPortraitAsset(ctx context.Context, actor *model.User, id string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	asset, group, err := s.arkPortraitAssetForUser(actor.ID, id)
	if err != nil {
		return err
	}
	setting, err := s.arkPortraitSetting()
	if err != nil {
		return err
	}
	if arkPortraitGroupAvailable(*group, setting) {
		if _, err := callArkPrivateAssetAPI(ctx, setting, "DeleteAsset", map[string]interface{}{"Id": asset.ArkAssetID, "ProjectName": group.ProjectName}); err != nil && !arkPortraitNotFound(err) {
			return BadAuthRequest("删除方舟真人素材失败：" + safeArkPortraitError(err))
		}
	}
	return s.repo.DeleteArkPortraitAsset(actor.ID, asset.ID)
}

func (s *Service) refreshArkPortraitAssetStatus(ctx context.Context, setting arkPrivateAssetSettingValue, asset *model.ArkPortraitAsset) error {
	response, err := callArkPrivateAssetAPI(ctx, setting, "GetAsset", map[string]interface{}{"Id": asset.ArkAssetID, "ProjectName": setting.ProjectName})
	if err != nil {
		return err
	}
	switch strings.ToLower(arkPrivateAssetResponseField(response, "Status", "status")) {
	case "active":
		asset.Status, asset.Error = arkPortraitAssetActive, ""
	case "failed":
		asset.Status = arkPortraitAssetFailed
		asset.Error = truncateRunes(defaultString(arkPrivateAssetResponseField(response, "ErrorMessage", "Message", "message"), "素材未通过方舟面部一致性校验，请上传本人清晰的正面素材"), 1000)
	default:
		return nil
	}
	return s.repo.SaveArkPortraitAsset(asset)
}

// validateArkPortraitReferences 拒绝引用他人登记的真人素材：真人素材组都在管理员的同一方舟账号下，
// 仅靠方舟侧无法区分本系统内的用户。未登记的素材 ID（公共数字人或其他来源）不受限制。
func (s *Service) validateArkPortraitReferences(userID string, input *canvasGenerationInput) error {
	if input == nil {
		return nil
	}
	ids := make([]string, 0)
	for _, group := range [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios} {
		for _, reference := range group {
			if id, ok := strings.CutPrefix(strings.TrimSpace(reference.URL), "asset://"); ok && strings.TrimSpace(id) != "" {
				ids = append(ids, strings.TrimSpace(id))
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	owners, err := s.repo.ArkPortraitAssetOwners(ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		for _, owner := range owners[id] {
			if owner != userID {
				return Forbidden("参考素材包含其他账号的真人素材，不能用于生成")
			}
		}
	}
	return nil
}

func (s *Service) arkPortraitGroupForUser(userID, id string) (*model.ArkPortraitGroup, error) {
	group, err := s.repo.ArkPortraitGroupForUser(userID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("真人素材组不存在")
	}
	return group, err
}

func (s *Service) arkPortraitAssetForUser(userID, id string) (*model.ArkPortraitAsset, *model.ArkPortraitGroup, error) {
	asset, err := s.repo.ArkPortraitAssetForUser(userID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, NotFound("真人素材不存在")
	}
	if err != nil {
		return nil, nil, err
	}
	group, err := s.arkPortraitGroupForUser(userID, asset.GroupID)
	if err != nil {
		return nil, nil, err
	}
	return asset, group, nil
}

func arkPortraitCallbackBase(setting arkPrivateAssetSettingValue) (string, error) {
	base := strings.TrimRight(firstNonEmpty(setting.CallbackBaseURL, strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL"))), "/")
	if base == "" {
		return "", BadAuthRequest("管理员尚未配置真人认证回调地址（方舟素材库设置或 CANVAS_PUBLIC_BASE_URL）")
	}
	if err := validatePaymentPublicBaseURL(base); err != nil {
		return "", BadAuthRequest("真人认证回调地址必须是有效的 HTTP(S) 根地址")
	}
	return base, nil
}

// arkPortraitH5Link 校验方舟返回的认证页并按界面语言设置 lng（H5 只支持 zh / en / zh-Hant）。
func arkPortraitH5Link(raw, lang string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("invalid h5 link")
	}
	query := parsed.Query()
	query.Set("lng", arkPortraitH5Language(lang))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func arkPortraitH5Language(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	switch {
	case lang == "zh-hant" || lang == "zh-tw" || lang == "zh-hk":
		return "zh-Hant"
	case lang == "" || strings.HasPrefix(lang, "zh"):
		return "zh"
	default:
		return "en"
	}
}

func arkPortraitAssetType(mimeType string) string {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "Image"
	case strings.HasPrefix(mimeType, "video/"):
		return "Video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "Audio"
	default:
		return ""
	}
}

func arkPortraitNotFound(err error) bool {
	message := err.Error()
	return strings.Contains(message, "NotFound") || strings.Contains(message, "not found")
}

// safeArkPortraitError 只保留方舟返回的错误码与说明，去掉可能包含签名地址的长文本。
func safeArkPortraitError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if index := strings.Index(message, "http"); index >= 0 && strings.Contains(message[index:], "?") {
		message = message[:index]
	}
	return truncateRunes(strings.TrimSpace(message), 300)
}

func arkPortraitGroupView(group model.ArkPortraitGroup, setting arkPrivateAssetSettingValue) ArkPortraitGroupView {
	return ArkPortraitGroupView{
		ID: group.ID, Name: group.Name, GroupID: group.GroupID, Source: group.Source,
		Available: arkPortraitGroupAvailable(group, setting), CreatedAt: group.CreatedAt, Assets: []ArkPortraitAssetView{},
	}
}

func arkPortraitAssetView(asset model.ArkPortraitAsset) ArkPortraitAssetView {
	return ArkPortraitAssetView{
		ID: asset.ID, GroupID: asset.GroupID, ResourceID: asset.ResourceID, ArkAssetID: asset.ArkAssetID,
		AssetType: asset.AssetType, Name: asset.Name, Status: asset.Status, Error: asset.Error, CreatedAt: asset.CreatedAt,
	}
}

func arkPortraitSessionView(session model.ArkPortraitSession) ArkPortraitSessionView {
	return ArkPortraitSessionView{
		ID: session.ID, Name: session.Name, Status: session.Status, GroupID: session.GroupID,
		Error: session.Error, ExpiresAt: session.ExpiresAt,
	}
}
