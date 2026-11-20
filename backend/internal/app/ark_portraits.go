// 方舟素材库：真人 / 虚拟 / 版权 IP 三类素材组，全部建在管理员配置的平台方舟账号下。
//   - 真人：本人完成 H5 活体认证后由方舟生成 LivenessFace 素材组，带授权到期时间。
//   - 虚拟：直接创建 AIGC 素材组。
//   - 版权 IP：只能由管理员创建或登记，再授权给用户只读使用。
//
// 用户自建的组（scope=user）只属于本人；管理员建的平台组（scope=platform）按「全部用户 / 指定用户」授权。
// 用户上传的素材按配置先经平台审核，管理员通过后才提交方舟；方舟审核通过后写入素材库「方舟认证」分类。
//
// 安全边界：
//   - 回调地址只带一次性随机 state，不带登录态；BytedToken 加密保存且只在服务端换取 GroupId。
//   - 任务引用他人个人组、未授权平台组或已过期真人组的素材 ID 时拒绝执行（validateArkPortraitReferences）。
//   - 登记方舟控制台已有的素材组只允许管理员操作，避免普通用户认领同账号下他人的组。
//   - 用户自建素材组的费用先冻结后结算：真人认证成功、虚拟组创建成功才扣费，失败、过期或取消自动退回。

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
	"yingce/backend/internal/repository"
)

const (
	arkGroupKindReal    = "real"
	arkGroupKindVirtual = "virtual"
	arkGroupKindIP      = "ip"

	arkGroupScopeUser     = "user"
	arkGroupScopePlatform = "platform"

	arkGroupSourceLiveness = "liveness"
	arkGroupSourceCreated  = "created"
	arkGroupSourceManual   = "manual"

	arkPortraitGroupType          = "LivenessFace"
	arkPortraitSessionTTL         = 30 * time.Minute
	arkPortraitSuccessCode        = "10000"
	arkPortraitSessionPending     = "pending"
	arkPortraitSessionVerified    = "verified"
	arkPortraitSessionFailed      = "failed"
	arkPortraitSessionExpired     = "expired"
	arkPortraitSessionCancelled   = "cancelled"
	arkPortraitAssetPendingReview = "pending_review"
	arkPortraitAssetRejected      = "rejected"
	arkPortraitAssetProcessing    = "processing"
	arkPortraitAssetActive        = "active"
	arkPortraitAssetFailed        = "failed"
	maxArkPortraitSessionsPerHour = 20
	maxArkPortraitAssetsPerGroup  = 200
	arkPortraitExpiringWindow     = 30 * 24 * time.Hour
	arkPortraitResultPath         = "/ark-portrait/result"
)

var (
	arkPortraitGroupIDPattern = regexp.MustCompile(`^group-[A-Za-z0-9-]{1,100}$`)
	arkPortraitStatePattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
)

type ArkAssetConfigView struct {
	RealEnabled                   bool  `json:"realEnabled"`
	VirtualEnabled                bool  `json:"virtualEnabled"`
	RealGroupLimit                int   `json:"realGroupLimit"`
	VirtualGroupLimit             int   `json:"virtualGroupLimit"`
	BillingEnabled                bool  `json:"billingEnabled"`
	RealGroupPriceMicrocredits    int64 `json:"realGroupPriceMicrocredits"`
	VirtualGroupPriceMicrocredits int64 `json:"virtualGroupPriceMicrocredits"`
	RealReviewRequired            bool  `json:"realReviewRequired"`
	VirtualReviewRequired         bool  `json:"virtualReviewRequired"`
	RealAuthorizationDays         int   `json:"realAuthorizationDays"`
}

type ArkAssetUsageView struct {
	Real    int64 `json:"real"`
	Virtual int64 `json:"virtual"`
}

type ArkPortraitOverview struct {
	Enabled  bool                     `json:"enabled"`
	Site     string                   `json:"site,omitempty"`
	Config   ArkAssetConfigView       `json:"config"`
	Usage    ArkAssetUsageView        `json:"usage"`
	Groups   []ArkPortraitGroupView   `json:"groups"`
	Sessions []ArkPortraitSessionView `json:"sessions"`
}

type ArkUserSummary struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type ArkPortraitGroupView struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description"`
	Kind         string                 `json:"kind"`
	Scope        string                 `json:"scope"`
	Source       string                 `json:"source"`
	GroupID      string                 `json:"groupId"`
	Owned        bool                   `json:"owned"`
	Available    bool                   `json:"available"`
	AuthorizedAt *time.Time             `json:"authorizedAt,omitempty"`
	ExpiresAt    *time.Time             `json:"expiresAt,omitempty"`
	ExpiryStatus string                 `json:"expiryStatus"`
	CreatedAt    time.Time              `json:"createdAt"`
	Assets       []ArkPortraitAssetView `json:"assets"`
	// 以下字段只在管理员接口返回。
	Owner       *ArkUserSummary  `json:"owner,omitempty"`
	GrantAll    bool             `json:"grantAll"`
	GrantUsers  []ArkUserSummary `json:"grantUsers,omitempty"`
	AssetCounts map[string]int64 `json:"assetCounts,omitempty"`
}

type ArkPortraitGroupRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Scope string `json:"scope"`
}

type ArkPortraitAssetView struct {
	ID             string     `json:"id"`
	GroupID        string     `json:"groupId"`
	ResourceID     string     `json:"resourceId"`
	ArkAssetID     string     `json:"arkAssetId"`
	AssetType      string     `json:"assetType"`
	Name           string     `json:"name"`
	Status         string     `json:"status"`
	Error          string     `json:"error,omitempty"`
	LibraryAssetID string     `json:"libraryAssetId,omitempty"`
	InLibrary      bool       `json:"inLibrary"`
	MimeType       string     `json:"mimeType,omitempty"`
	Width          int        `json:"width,omitempty"`
	Height         int        `json:"height,omitempty"`
	Bytes          int64      `json:"bytes,omitempty"`
	ReviewedAt     *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	// 管理员审核队列附带上传者与所属素材组。
	Uploader *ArkUserSummary      `json:"uploader,omitempty"`
	Group    *ArkPortraitGroupRef `json:"group,omitempty"`
}

type ArkPortraitSessionView struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Scope                string    `json:"scope"`
	Status               string    `json:"status"`
	H5Link               string    `json:"h5Link,omitempty"`
	GroupID              string    `json:"groupId,omitempty"`
	Error                string    `json:"error,omitempty"`
	ReservedMicrocredits int64     `json:"reservedMicrocredits"`
	ExpiresAt            time.Time `json:"expiresAt"`
}

// arkCredentialSetting 读取凭据完整的方舟配置；所有调用方舟控制面的操作都从这里取配置。
func (s *Service) arkCredentialSetting() (arkPrivateAssetSettingValue, error) {
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return setting, err
	}
	if !setting.credentialsReady() {
		return setting, BadAuthRequest("方舟素材库尚未配置完整，请联系管理员填写 Region、ProjectName 与 IAM AK/SK")
	}
	return setting, nil
}

func arkPortraitGroupAvailable(group model.ArkPortraitGroup, setting arkPrivateAssetSettingValue) bool {
	return group.Site == setting.Site && group.Region == setting.Region && group.ProjectName == setting.ProjectName
}

func arkGroupExpired(group model.ArkPortraitGroup, now time.Time) bool {
	return group.ExpiresAt != nil && !group.ExpiresAt.After(now)
}

func arkGroupExpiryStatus(group model.ArkPortraitGroup, now time.Time) string {
	switch {
	case group.ExpiresAt == nil:
		return "none"
	case !group.ExpiresAt.After(now):
		return "expired"
	case group.ExpiresAt.Before(now.Add(arkPortraitExpiringWindow)):
		return "expiring"
	default:
		return "valid"
	}
}

func arkGroupKindLabel(kind string) string {
	switch kind {
	case arkGroupKindVirtual:
		return "虚拟人像"
	case arkGroupKindIP:
		return "版权 IP"
	default:
		return "真人人像"
	}
}

func validArkGroupKind(kind string) bool {
	return kind == arkGroupKindReal || kind == arkGroupKindVirtual || kind == arkGroupKindIP
}

// arkGroupCharge 返回用户自建该类素材组要支付的积分；平台积分功能关闭或未开启收费时为 0。
func (s *Service) arkGroupCharge(setting arkPrivateAssetSettingValue, kind string) (int64, error) {
	price := setting.groupPrice(kind)
	if price <= 0 {
		return 0, nil
	}
	enabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return 0, err
	}
	if !enabled {
		return 0, nil
	}
	return price, nil
}

func (s *Service) arkAssetConfigView(setting arkPrivateAssetSettingValue) (ArkAssetConfigView, error) {
	billing := false
	if setting.BillingEnabled {
		enabled, err := s.FeatureEnabled(FeatureCredits)
		if err != nil {
			return ArkAssetConfigView{}, err
		}
		billing = enabled
	}
	return ArkAssetConfigView{
		RealEnabled: setting.RealEnabled, VirtualEnabled: setting.VirtualEnabled,
		RealGroupLimit: setting.RealGroupLimit, VirtualGroupLimit: setting.VirtualGroupLimit,
		BillingEnabled: billing, RealGroupPriceMicrocredits: setting.RealGroupPriceMicrocredits, VirtualGroupPriceMicrocredits: setting.VirtualGroupPriceMicrocredits,
		RealReviewRequired: setting.RealReviewRequired, VirtualReviewRequired: setting.VirtualReviewRequired,
		RealAuthorizationDays: setting.RealAuthorizationDays,
	}, nil
}

func arkGroupBillingOrder(userID string, key string, kind string, amount int64) *model.BillingOrder {
	return &model.BillingOrder{
		ID: newID(), UserID: userID, IdempotencyKey: "ark-group:" + key,
		Model: "方舟" + strings.ReplaceAll(arkGroupKindLabel(kind), " ", "") + "素材组", Capability: "ark_asset", Scene: model.BillingSceneArkAssetGroup,
		BillingMode: "fixed_request", UnitPriceMicrocredits: amount, MultiplierBasisPoints: 10000, Quantity: 1,
		AmountMicrocredits: amount, ReservedAmountMicrocredits: amount, Status: model.BillingStatusReserved,
	}
}

func arkGroupSettleNote(kind string, name string) string {
	return arkGroupKindLabel(kind) + " · " + name
}

func insufficientArkCredits(amount int64) error {
	return BadAuthRequest(fmt.Sprintf("积分不足：创建该素材组需要 %s 积分，请充值后重试", formatArkCredits(amount)))
}

func formatArkCredits(amount int64) string {
	whole := amount / CreditScale
	fraction := amount % CreditScale
	if fraction == 0 {
		return fmt.Sprintf("%d", whole)
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%d.%06d", whole, fraction), "0"), ".")
}

func (s *Service) ArkPortraitOverview(ctx context.Context, actor *model.User) (*ArkPortraitOverview, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	config, err := s.arkAssetConfigView(setting)
	if err != nil {
		return nil, err
	}
	overview := &ArkPortraitOverview{Config: config, Groups: []ArkPortraitGroupView{}, Sessions: []ArkPortraitSessionView{}}
	if !setting.credentialsReady() {
		return overview, nil
	}
	own, err := s.repo.ArkPortraitUserGroups(actor.ID)
	if err != nil {
		return nil, err
	}
	granted, err := s.repo.ArkPortraitGrantedGroups(actor.ID)
	if err != nil {
		return nil, err
	}
	overview.Enabled = setting.RealEnabled || setting.VirtualEnabled || len(own) > 0 || len(granted) > 0
	if !overview.Enabled {
		return overview, nil
	}
	overview.Site = setting.Site
	now := time.Now()
	views, err := s.arkGroupViewsForUser(actor.ID, own, granted, setting, now)
	if err != nil {
		return nil, err
	}
	overview.Groups = views
	for _, group := range own {
		if group.Kind == arkGroupKindVirtual {
			overview.Usage.Virtual++
		} else if group.Kind == arkGroupKindReal {
			overview.Usage.Real++
		}
	}
	activeSessions, err := s.repo.CountActiveArkPortraitUserSessions(actor.ID, now)
	if err != nil {
		return nil, err
	}
	overview.Usage.Real += activeSessions
	pending, err := s.repo.PendingArkPortraitSessions(actor.ID, arkGroupScopeUser, now, 10)
	if err != nil {
		return nil, err
	}
	overview.Sessions, err = s.arkSessionViews(pending)
	if err != nil {
		return nil, err
	}
	return overview, nil
}

// arkGroupViewsForUser 组装用户可见的素材组：自建组返回全部状态的素材，授权组只返回已通过的素材。
func (s *Service) arkGroupViewsForUser(userID string, own []model.ArkPortraitGroup, granted []model.ArkPortraitGroup, setting arkPrivateAssetSettingValue, now time.Time) ([]ArkPortraitGroupView, error) {
	ownIDs := make([]string, 0, len(own))
	for _, group := range own {
		ownIDs = append(ownIDs, group.ID)
	}
	grantedIDs := make([]string, 0, len(granted))
	for _, group := range granted {
		grantedIDs = append(grantedIDs, group.ID)
	}
	ownAssets, err := s.repo.ArkPortraitAssetsForGroups(ownIDs, nil)
	if err != nil {
		return nil, err
	}
	grantedAssets, err := s.repo.ArkPortraitAssetsForGroups(grantedIDs, []string{arkPortraitAssetActive})
	if err != nil {
		return nil, err
	}
	all := append(append([]model.ArkPortraitAsset{}, ownAssets...), grantedAssets...)
	assetViews, err := s.arkAssetViewsForUser(userID, all)
	if err != nil {
		return nil, err
	}
	byGroup := make(map[string][]ArkPortraitAssetView, len(own)+len(granted))
	for _, view := range assetViews {
		byGroup[view.GroupID] = append(byGroup[view.GroupID], view)
	}
	views := make([]ArkPortraitGroupView, 0, len(own)+len(granted))
	for _, group := range append(append([]model.ArkPortraitGroup{}, own...), granted...) {
		view := arkPortraitGroupView(group, setting, now)
		view.Owned = group.Scope == arkGroupScopeUser && group.UserID == userID
		if items := byGroup[group.ID]; items != nil {
			view.Assets = items
		}
		views = append(views, view)
	}
	return views, nil
}

// arkAssetViewsForUser 附带资源尺寸，并标记各素材是否已在当前用户的素材库中。
func (s *Service) arkAssetViewsForUser(userID string, assets []model.ArkPortraitAsset) ([]ArkPortraitAssetView, error) {
	resourceIDs := make([]string, 0, len(assets))
	libraryIDs := make([]string, 0, len(assets))
	for _, asset := range assets {
		resourceIDs = append(resourceIDs, asset.ResourceID)
		if id := arkLibraryAssetIDForUser(asset, userID); id != "" {
			libraryIDs = append(libraryIDs, id)
		}
	}
	resources, err := s.repo.ResourcesByIDs(resourceIDs)
	if err != nil {
		return nil, err
	}
	resourceByID := make(map[string]model.Resource, len(resources))
	for _, resource := range resources {
		resourceByID[resource.ID] = resource
	}
	libraryAssets, err := s.repo.AssetsForUserIDs(userID, libraryIDs)
	if err != nil {
		return nil, err
	}
	inLibrary := make(map[string]bool, len(libraryAssets))
	for _, asset := range libraryAssets {
		if asset.Status != model.AssetVersionStatusArchived {
			inLibrary[asset.ID] = true
		}
	}
	views := make([]ArkPortraitAssetView, 0, len(assets))
	for _, asset := range assets {
		view := arkPortraitAssetView(asset)
		if resource, ok := resourceByID[asset.ResourceID]; ok {
			view.MimeType, view.Width, view.Height, view.Bytes = resource.MimeType, resource.Width, resource.Height, resource.Size
		}
		libraryID := arkLibraryAssetIDForUser(asset, userID)
		if inLibrary[libraryID] {
			view.LibraryAssetID = libraryID
			view.InLibrary = true
		} else if asset.UserID == userID {
			view.LibraryAssetID = asset.LibraryAssetID
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) arkSessionViews(sessions []model.ArkPortraitSession) ([]ArkPortraitSessionView, error) {
	orderIDs := make([]string, 0, len(sessions))
	for _, session := range sessions {
		if session.BillingOrderID != "" {
			orderIDs = append(orderIDs, session.BillingOrderID)
		}
	}
	orders, err := s.repo.BillingOrdersByIDs(orderIDs)
	if err != nil {
		return nil, err
	}
	views := make([]ArkPortraitSessionView, 0, len(sessions))
	for _, session := range sessions {
		view := arkPortraitSessionView(session)
		if order, ok := orders[session.BillingOrderID]; ok && order.Status == model.BillingStatusReserved {
			view.ReservedMicrocredits = order.AmountMicrocredits
		}
		views = append(views, view)
	}
	return views, nil
}

// CreateArkPortraitSession 为用户自建真人素材组生成 H5 认证链接。lang 为界面语言，映射到 H5 支持的 zh / en / zh-Hant。
func (s *Service) CreateArkPortraitSession(ctx context.Context, actor *model.User, name, lang string) (*ArkPortraitSessionView, error) {
	return s.createArkPortraitSession(ctx, actor, name, "", lang, arkGroupScopeUser)
}

func (s *Service) createArkPortraitSession(ctx context.Context, actor *model.User, name, description, lang, scope string) (*ArkPortraitSessionView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if name == "" || len([]rune(name)) > 40 {
		return nil, BadAuthRequest("请填写 1-40 个字的真人名称，便于区分不同素材组")
	}
	if len([]rune(description)) > 200 {
		return nil, BadAuthRequest("素材组说明最多 200 个字")
	}
	setting, err := s.arkCredentialSetting()
	if err != nil {
		return nil, err
	}
	if scope == arkGroupScopeUser && !setting.RealEnabled {
		return nil, Forbidden("管理员尚未开放真人素材组")
	}
	callbackBase, err := arkPortraitCallbackBase(setting)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	recent, err := s.repo.CountRecentArkPortraitSessions(actor.ID, now.Add(-time.Hour))
	if err != nil {
		return nil, err
	}
	if recent >= maxArkPortraitSessionsPerHour {
		return nil, RateLimited("真人认证发起过于频繁，请一小时后再试")
	}
	var order *model.BillingOrder
	session := &model.ArkPortraitSession{
		ID: newID(), UserID: actor.ID, Scope: scope, State: randomToken(), Name: name, Description: description,
		Site: setting.Site, Region: setting.Region, ProjectName: setting.ProjectName,
		Status: arkPortraitSessionPending, ExpiresAt: now.Add(arkPortraitSessionTTL),
	}
	if !arkPortraitStatePattern.MatchString(session.State) {
		return nil, errors.New("生成真人认证凭据失败")
	}
	if scope == arkGroupScopeUser {
		groups, err := s.repo.CountArkPortraitUserGroups(actor.ID, arkGroupKindReal)
		if err != nil {
			return nil, err
		}
		sessions, err := s.repo.CountActiveArkPortraitUserSessions(actor.ID, now)
		if err != nil {
			return nil, err
		}
		if groups+sessions >= int64(setting.RealGroupLimit) {
			return nil, BadAuthRequest(fmt.Sprintf("每个账号最多创建 %d 个真人素材组（含认证中的会话）", setting.RealGroupLimit))
		}
		price, err := s.arkGroupCharge(setting, arkGroupKindReal)
		if err != nil {
			return nil, err
		}
		if price > 0 {
			order = arkGroupBillingOrder(actor.ID, "session:"+session.ID, arkGroupKindReal, price)
			session.BillingOrderID = order.ID
		}
	}
	// 先登记会话并冻结费用，再调用方舟；方舟失败时退回冻结积分并把会话标记失败。
	if err := s.repo.CreateArkPortraitSessionWithReservation(session, order); err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) && order != nil {
			return nil, insufficientArkCredits(order.AmountMicrocredits)
		}
		return nil, err
	}
	fail := func(message string, cause error) (*ArkPortraitSessionView, error) {
		if _, finishErr := s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionFailed, "", message, "发起真人认证失败，冻结积分已退回"); finishErr != nil {
			return nil, errors.Join(cause, finishErr)
		}
		return nil, WrapAppError(http.StatusBadGateway, message, cause)
	}
	response, err := callArkPrivateAssetAPI(ctx, setting, "CreateVisualValidateSession", map[string]interface{}{
		"CallbackURL": callbackBase + "/api/ark-portraits/callback/" + session.State,
		"ProjectName": setting.ProjectName,
	})
	if err != nil {
		return fail("发起方舟真人认证失败："+safeArkPortraitError(err), err)
	}
	bytedToken := arkPrivateAssetResponseField(response, "BytedToken")
	h5Link, linkErr := arkPortraitH5Link(arkPrivateAssetResponseField(response, "H5Link"), lang)
	if bytedToken == "" || linkErr != nil {
		return fail("方舟未返回有效的真人认证链接", errors.New("invalid visual validate session"))
	}
	tokenCipher, err := s.encryptSettingSecret(bytedToken)
	if err != nil {
		return fail("保存真人认证凭据失败", err)
	}
	if err := s.repo.SetArkPortraitSessionToken(session.ID, tokenCipher); err != nil {
		return fail("保存真人认证凭据失败", err)
	}
	view := arkPortraitSessionView(*session)
	if order != nil {
		view.ReservedMicrocredits = order.AmountMicrocredits
	}
	// H5 链接内含方舟签发的临时凭据，只在发起时返回给本人，不落库。
	view.H5Link = h5Link
	return &view, nil
}

// HandleArkPortraitCallback 处理 H5 认证页完成后的跳转（无登录态，多在手机上打开），返回结果页地址。
func (s *Service) HandleArkPortraitCallback(ctx context.Context, state string, query url.Values) string {
	result := func(status string, scope string) string {
		target := arkPortraitResultPath + "?status=" + url.QueryEscape(status)
		if scope == arkGroupScopePlatform {
			target += "&scope=platform"
		}
		return target
	}
	state = strings.TrimSpace(state)
	if !arkPortraitStatePattern.MatchString(state) {
		return result("invalid", "")
	}
	session, err := s.repo.ArkPortraitSessionByState(state)
	if err != nil {
		return result("invalid", "")
	}
	if session.Status != arkPortraitSessionPending {
		return result(session.Status, session.Scope)
	}
	if !session.ExpiresAt.After(time.Now()) {
		s.expireArkPortraitSession(session.ID)
		return result(arkPortraitSessionExpired, session.Scope)
	}
	resultCode := strings.TrimSpace(query.Get("resultCode"))
	if resultCode != arkPortraitSuccessCode {
		detail := "真人认证未通过（resultCode=" + truncateRunes(resultCode, 20)
		if sub := strings.TrimSpace(query.Get("algorithmBaseRespCode")); sub != "" {
			detail += "，algorithmBaseRespCode=" + truncateRunes(sub, 20)
		}
		_, _ = s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionFailed, truncateRunes(resultCode, 40), detail+"），请重新发起认证", "真人认证未通过，冻结积分已退回")
		return result(arkPortraitSessionFailed, session.Scope)
	}
	if token := strings.TrimSpace(query.Get("bytedToken")); token != "" {
		stored, err := s.decryptSettingSecret(session.BytedTokenCipher)
		if err != nil || subtle.ConstantTimeCompare([]byte(stored), []byte(token)) != 1 {
			return result("invalid", "")
		}
	}
	if _, err := s.completeArkPortraitSession(ctx, session); err != nil {
		// 保持 pending，用户回到电脑端可点击“我已完成认证”重试换取素材组。
		return result(arkPortraitSessionPending, session.Scope)
	}
	return result(arkPortraitSessionVerified, session.Scope)
}

// ArkPortraitSessionStatus 只读取本地会话状态，供电脑端轮询回调结果；不调用方舟。
func (s *Service) ArkPortraitSessionStatus(actor *model.User, id string) (*ArkPortraitSessionView, error) {
	session, err := s.arkPortraitSessionForUser(actor, id)
	if err != nil {
		return nil, err
	}
	if session.Status == arkPortraitSessionPending && !session.ExpiresAt.After(time.Now()) {
		s.expireArkPortraitSession(session.ID)
		if session, err = s.repo.ArkPortraitSessionForUser(actor.ID, session.ID); err != nil {
			return nil, err
		}
	}
	views, err := s.arkSessionViews([]model.ArkPortraitSession{*session})
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

// CheckArkPortraitSession 是回调未到达（例如在手机上完成认证）时的主动查询入口。
func (s *Service) CheckArkPortraitSession(ctx context.Context, actor *model.User, id string) (*ArkPortraitSessionView, error) {
	session, err := s.arkPortraitSessionForUser(actor, id)
	if err != nil {
		return nil, err
	}
	if session.Status == arkPortraitSessionPending && !session.ExpiresAt.After(time.Now()) {
		s.expireArkPortraitSession(session.ID)
	} else if session.Status == arkPortraitSessionPending {
		if _, err := s.completeArkPortraitSession(ctx, session); err != nil {
			return nil, err
		}
	}
	return s.ArkPortraitSessionStatus(actor, session.ID)
}

// CancelArkPortraitSession 结束仍在等待的认证会话并退回冻结的素材组费用。
func (s *Service) CancelArkPortraitSession(actor *model.User, id string) (*ArkPortraitSessionView, error) {
	session, err := s.arkPortraitSessionForUser(actor, id)
	if err != nil {
		return nil, err
	}
	if session.Status == arkPortraitSessionPending {
		if _, err := s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionCancelled, "", "已取消真人认证", "已取消真人认证，冻结积分已退回"); err != nil {
			return nil, err
		}
	}
	return s.ArkPortraitSessionStatus(actor, session.ID)
}

func (s *Service) arkPortraitSessionForUser(actor *model.User, id string) (*model.ArkPortraitSession, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	session, err := s.repo.ArkPortraitSessionForUser(actor.ID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("认证会话不存在")
	}
	return session, err
}

func (s *Service) expireArkPortraitSession(id string) {
	_, _ = s.repo.FinishArkPortraitSession(id, arkPortraitSessionExpired, "", "认证会话已过期", "真人认证未在有效期内完成，冻结积分已退回")
}

func (s *Service) completeArkPortraitSession(ctx context.Context, session *model.ArkPortraitSession) (*model.ArkPortraitGroup, error) {
	setting, err := s.arkCredentialSetting()
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
	if token == "" {
		return nil, NewAppError(http.StatusConflict, "认证会话尚未就绪，请重新发起真人认证")
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
	now := time.Now()
	expiresAt := now.Add(time.Duration(setting.RealAuthorizationDays) * 24 * time.Hour)
	group := &model.ArkPortraitGroup{
		ID: newID(), UserID: session.UserID, Kind: arkGroupKindReal, Scope: firstNonEmpty(session.Scope, arkGroupScopeUser),
		Name: session.Name, Description: session.Description, Site: setting.Site, Region: setting.Region, ProjectName: setting.ProjectName,
		GroupID: groupID, Source: arkGroupSourceLiveness, AuthorizedAt: &now, ExpiresAt: &expiresAt, BillingOrderID: session.BillingOrderID,
	}
	registered, err := s.repo.CompleteArkPortraitSession(session.ID, group, arkGroupSettleNote(arkGroupKindReal, session.Name))
	if errors.Is(err, repository.ErrArkPortraitGroupTaken) {
		_, _ = s.repo.FinishArkPortraitSession(session.ID, arkPortraitSessionFailed, arkPortraitSuccessCode, "该真人素材组已被其他账号登记", "真人素材组已被其他账号登记，冻结积分已退回")
		return nil, NewAppError(http.StatusConflict, "该真人素材组已被其他账号登记")
	}
	if errors.Is(err, repository.ErrArkPortraitSessionClosed) {
		return nil, NewAppError(http.StatusConflict, "认证会话已结束，请重新发起真人认证")
	}
	return registered, err
}

// validateArkPortraitReferences 校验生成任务引用的方舟素材 ID：素材组都在平台的同一方舟账号下，
// 仅靠方舟侧无法区分本系统内的用户。他人个人组、未授权的平台组和已过期的真人组都拒绝；
// 未登记的素材 ID（方舟公共虚拟人像或其他来源）不受限制。
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
	rows, err := s.repo.ArkPortraitAssetAccessRows(ids)
	if err != nil || len(rows) == 0 {
		return err
	}
	platformGroupIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Scope == arkGroupScopePlatform && !row.GrantAll && row.GroupUserID != userID {
			platformGroupIDs = append(platformGroupIDs, row.GroupID)
		}
	}
	granted, err := s.repo.ArkPortraitGrantedGroupIDs(userID, platformGroupIDs)
	if err != nil {
		return err
	}
	rowsByAsset := make(map[string][]repository.ArkPortraitAssetAccess, len(rows))
	for _, row := range rows {
		rowsByAsset[row.ArkAssetID] = append(rowsByAsset[row.ArkAssetID], row)
	}
	now := time.Now()
	for _, id := range ids {
		candidates := rowsByAsset[id]
		if len(candidates) == 0 {
			continue
		}
		allowed, expired := false, false
		for _, row := range candidates {
			permitted := (row.Scope != arkGroupScopePlatform && row.GroupUserID == userID) ||
				(row.Scope == arkGroupScopePlatform && (row.GrantAll || row.GroupUserID == userID || granted[row.GroupID]))
			if !permitted {
				continue
			}
			if row.ExpiresAt != nil && !row.ExpiresAt.After(now) {
				expired = true
				continue
			}
			allowed = true
		}
		if allowed {
			continue
		}
		if expired {
			return Forbidden("参考素材所在的真人素材组授权已过期，请重新认证后再生成")
		}
		return Forbidden("参考素材包含未授权给你的方舟素材，不能用于生成")
	}
	return nil
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

func arkPortraitGroupView(group model.ArkPortraitGroup, setting arkPrivateAssetSettingValue, now time.Time) ArkPortraitGroupView {
	return ArkPortraitGroupView{
		ID: group.ID, Name: group.Name, Description: group.Description, Kind: firstNonEmpty(group.Kind, arkGroupKindReal),
		Scope: firstNonEmpty(group.Scope, arkGroupScopeUser), Source: group.Source, GroupID: group.GroupID,
		Available: arkPortraitGroupAvailable(group, setting), AuthorizedAt: group.AuthorizedAt, ExpiresAt: group.ExpiresAt,
		ExpiryStatus: arkGroupExpiryStatus(group, now), CreatedAt: group.CreatedAt, GrantAll: group.GrantAll,
		Assets: []ArkPortraitAssetView{},
	}
}

func arkPortraitAssetView(asset model.ArkPortraitAsset) ArkPortraitAssetView {
	return ArkPortraitAssetView{
		ID: asset.ID, GroupID: asset.GroupID, ResourceID: asset.ResourceID, ArkAssetID: asset.ArkAssetID,
		AssetType: asset.AssetType, Name: asset.Name, Status: asset.Status, Error: asset.Error,
		ReviewedAt: asset.ReviewedAt, CreatedAt: asset.CreatedAt,
	}
}

func arkPortraitSessionView(session model.ArkPortraitSession) ArkPortraitSessionView {
	return ArkPortraitSessionView{
		ID: session.ID, Name: session.Name, Scope: firstNonEmpty(session.Scope, arkGroupScopeUser), Status: session.Status,
		GroupID: session.GroupID, Error: session.Error, ExpiresAt: session.ExpiresAt,
	}
}
