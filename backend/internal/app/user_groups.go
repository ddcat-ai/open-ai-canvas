// 用户分组：分组 -> 系统渠道 -> 模型的可见范围，以及分组级折扣、模型级倍率和货币兑换积分比例。
//
// 目录、报价、任务准入、系统渠道中转和账单预留都从 userGroupAccess 读取同一份分组快照；
// 目录只是读路径，真正的拦截在任务准入和账单预留，客户端提交隐藏渠道 ID 也会失败关闭。

package app

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	userGroupCacheTTL       = 30 * time.Second
	maxUserGroupRatioBPS    = 1_000_000
	maxPointsPerCurrency    = 1_000_000 * CreditScale
	maxUserGroupOverrides   = 500
	defaultPointsPerCNYSeed = 1 * CreditScale
	defaultPointsPerUSDSeed = 7 * CreditScale
)

var userGroupCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

// userGroupState 是 Service 内的分组缓存；多实例部署下由短 TTL 收敛。
type userGroupState struct {
	mu       sync.RWMutex
	snapshot *userGroupSnapshot
	at       time.Time
}

type userGroupSnapshot struct {
	byCode map[string]*resolvedUserGroup
}

type resolvedUserGroup struct {
	model.UserGroup
	channels  map[string]bool
	overrides map[string]model.UserGroupModelOverride
}

// userGroupAccess 是一次请求的分组上下文。bypassVisibility 只放开渠道可见性（管理员和内部能力探测），
// 价格仍按 group 计算。
type userGroupAccess struct {
	userID           string
	group            *resolvedUserGroup
	bypassVisibility bool
}

// UserGroupView 是管理端分组读模型。
type UserGroupView struct {
	model.UserGroup
	IsDefault      bool                           `json:"isDefault"`
	ChannelIDs     []string                       `json:"channelIds"`
	ModelOverrides []model.UserGroupModelOverride `json:"modelOverrides"`
	UserCount      int64                          `json:"userCount"`
}

// UserGroupRequest 是创建/更新分组的入参。编码创建后不可修改。
type UserGroupRequest struct {
	Code             string                         `json:"code"`
	Name             string                         `json:"name"`
	Description      string                         `json:"description"`
	BadgeLabel       string                         `json:"badgeLabel"`
	BadgeStyle       string                         `json:"badgeStyle"`
	SortOrder        int                            `json:"sortOrder"`
	RatioBasisPoints int64                          `json:"ratioBasisPoints"`
	PointsPerUSD     int64                          `json:"pointsPerUsdMicrocredits"`
	PointsPerCNY     int64                          `json:"pointsPerCnyMicrocredits"`
	AllChannels      bool                           `json:"allChannels"`
	ChannelIDs       []string                       `json:"channelIds"`
	ModelOverrides   []model.UserGroupModelOverride `json:"modelOverrides"`
}

// PublicUserGroup 是用户端会话里的分组展示信息，不含渠道绑定。
type PublicUserGroup struct {
	Code             string `json:"code"`
	Name             string `json:"name"`
	BadgeLabel       string `json:"badgeLabel"`
	BadgeStyle       string `json:"badgeStyle"`
	RatioBasisPoints int64  `json:"ratioBasisPoints"`
}

func normalizeUserGroupCode(code string) string {
	value := strings.ToLower(strings.TrimSpace(code))
	if value == "" {
		return model.DefaultUserGroupCode
	}
	return value
}

// storedUserGroupCode 是写入 users.user_group 的值；默认分组保存为空串，与历史用户一致。
func storedUserGroupCode(code string) string {
	value := normalizeUserGroupCode(code)
	if value == model.DefaultUserGroupCode {
		return ""
	}
	return value
}

func normalizePriceCurrency(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "", "CREDITS":
		return model.PriceCurrencyCredits, nil
	case model.PriceCurrencyUSD:
		return model.PriceCurrencyUSD, nil
	case model.PriceCurrencyCNY:
		return model.PriceCurrencyCNY, nil
	default:
		return "", BadAuthRequest("计价货币只支持积分、USD 或 CNY")
	}
}

// EnsureDefaultUserGroup 在启动时补齐 default 分组；它默认开放全部系统渠道，旧部署升级后目录不变。
func (s *Service) EnsureDefaultUserGroup() error {
	_, err := s.repo.UserGroupByCode(model.DefaultUserGroupCode)
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	group := &model.UserGroup{
		ID: newID(), Code: model.DefaultUserGroupCode, Name: "默认分组", BadgeStyle: model.UserGroupBadgeNone,
		RatioBasisPoints: 10_000, PointsPerUSD: defaultPointsPerUSDSeed, PointsPerCNY: defaultPointsPerCNYSeed,
		AllChannels: true, ModelOverridesJSON: "[]",
	}
	if err := s.repo.SaveUserGroupWithChannels(group, nil, true); err != nil {
		return err
	}
	s.invalidateUserGroups()
	return nil
}

func (s *Service) invalidateUserGroups() {
	s.userGroups.mu.Lock()
	s.userGroups.snapshot = nil
	s.userGroups.mu.Unlock()
}

func (s *Service) userGroupSnapshot() (*userGroupSnapshot, error) {
	s.userGroups.mu.RLock()
	if s.userGroups.snapshot != nil && time.Since(s.userGroups.at) < userGroupCacheTTL {
		snapshot := s.userGroups.snapshot
		s.userGroups.mu.RUnlock()
		return snapshot, nil
	}
	s.userGroups.mu.RUnlock()
	groups, err := s.repo.UserGroups()
	if err != nil {
		return nil, err
	}
	bindings, err := s.repo.UserGroupChannels()
	if err != nil {
		return nil, err
	}
	snapshot := &userGroupSnapshot{byCode: make(map[string]*resolvedUserGroup, len(groups))}
	byID := make(map[string]*resolvedUserGroup, len(groups))
	for _, group := range groups {
		overrides, decodeErr := decodeUserGroupOverrides(group.ModelOverridesJSON)
		if decodeErr != nil {
			return nil, decodeErr
		}
		resolved := &resolvedUserGroup{UserGroup: group, channels: map[string]bool{}, overrides: make(map[string]model.UserGroupModelOverride, len(overrides))}
		for _, item := range overrides {
			resolved.overrides[item.ModelKey] = item
		}
		snapshot.byCode[group.Code] = resolved
		byID[group.ID] = resolved
	}
	for _, binding := range bindings {
		if group := byID[binding.GroupID]; group != nil {
			group.channels[binding.ChannelID] = true
		}
	}
	s.userGroups.mu.Lock()
	s.userGroups.snapshot = snapshot
	s.userGroups.at = time.Now()
	s.userGroups.mu.Unlock()
	return snapshot, nil
}

func decodeUserGroupOverrides(raw string) ([]model.UserGroupModelOverride, error) {
	if strings.TrimSpace(raw) == "" {
		return []model.UserGroupModelOverride{}, nil
	}
	var items []model.UserGroupModelOverride
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, errors.New("用户分组模型倍率配置格式无效")
	}
	if items == nil {
		items = []model.UserGroupModelOverride{}
	}
	return items, nil
}

func (s *Service) resolvedUserGroup(code string) (*resolvedUserGroup, error) {
	snapshot, err := s.userGroupSnapshot()
	if err != nil {
		return nil, err
	}
	normalized := normalizeUserGroupCode(code)
	group := snapshot.byCode[normalized]
	if group == nil && normalized == model.DefaultUserGroupCode {
		// 默认分组是计费基线：启动时已补齐，这里兜住新库或被并发清空的窗口。
		if ensureErr := s.EnsureDefaultUserGroup(); ensureErr != nil {
			if _, lookupErr := s.repo.UserGroupByCode(model.DefaultUserGroupCode); lookupErr != nil {
				return nil, ensureErr
			}
		}
		s.invalidateUserGroups()
		if snapshot, err = s.userGroupSnapshot(); err != nil {
			return nil, err
		}
		group = snapshot.byCode[normalized]
	}
	if group == nil {
		// 分组被删除前必须清空用户，所以这里只会是配置损坏；失败关闭，不回退到默认分组。
		return nil, Forbidden("当前账号分组配置无效，请联系管理员")
	}
	return group, nil
}

// userGroupAccessForUser 构造登录用户的分组上下文。管理员可见全部渠道，但价格仍按自己的分组计算。
func (s *Service) userGroupAccessForUser(user *model.User) (*userGroupAccess, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	group, err := s.resolvedUserGroup(user.UserGroup)
	if err != nil {
		return nil, err
	}
	return &userGroupAccess{userID: user.ID, group: group, bypassVisibility: user.Role == model.UserRoleAdmin}, nil
}

// userGroupAccess 按用户 ID 读取分组上下文；账单和任务准入使用它，用户不存在时失败关闭。
func (s *Service) userGroupAccess(userID string) (*userGroupAccess, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	user, err := s.repo.User(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, Unauthorized("账号不存在或已删除")
	}
	if err != nil {
		return nil, err
	}
	return s.userGroupAccessForUser(user)
}

// systemGroupAccess 只用于不面向具体用户的内部能力探测（模型名称、能力画像）；
// 它放开渠道可见性，价格按默认分组计算，不能用于账单。
func (s *Service) systemGroupAccess() (*userGroupAccess, error) {
	group, err := s.resolvedUserGroup(model.DefaultUserGroupCode)
	if err != nil {
		return nil, err
	}
	return &userGroupAccess{group: group, bypassVisibility: true}, nil
}

func (a *userGroupAccess) allowsChannel(channelID string) bool {
	if a == nil || a.group == nil {
		return false
	}
	if a.bypassVisibility || a.group.AllChannels {
		return true
	}
	return a.group.channels[strings.TrimSpace(channelID)]
}

func (a *userGroupAccess) requireChannel(channelID string) error {
	if a.allowsChannel(channelID) {
		return nil
	}
	return ModelCatalogMismatch("当前账号分组无权使用该模型，请刷新后重新选择")
}

func (a *userGroupAccess) groupCode() string {
	if a == nil || a.group == nil {
		return ""
	}
	return a.group.Code
}

// groupPricing 是一次下单使用的分组价格因子。
type groupPricing struct {
	GroupCode        string
	Currency         string
	RateMicrocredits int64
	MultiplierBPS    int64
}

// pricing 返回模型在当前分组下的倍率和货币兑换比例。modelKeys 按优先级匹配分组模型覆盖项。
func (a *userGroupAccess) pricing(currency string, modelKeys ...string) (groupPricing, error) {
	if a == nil || a.group == nil {
		return groupPricing{}, errors.New("缺少用户分组上下文")
	}
	normalizedCurrency, err := normalizePriceCurrency(currency)
	if err != nil {
		return groupPricing{}, err
	}
	group := a.group
	result := groupPricing{GroupCode: group.Code, Currency: normalizedCurrency, MultiplierBPS: group.RatioBasisPoints}
	var override *model.UserGroupModelOverride
	for _, key := range modelKeys {
		if item, ok := group.overrides[strings.TrimSpace(key)]; ok && strings.TrimSpace(key) != "" {
			override = &item
			break
		}
	}
	if override != nil && override.RatioBasisPoints > 0 {
		result.MultiplierBPS = combineMultiplierBPS(group.RatioBasisPoints, override.RatioBasisPoints)
	}
	switch normalizedCurrency {
	case model.PriceCurrencyCredits:
		result.RateMicrocredits = CreditScale
	case model.PriceCurrencyUSD:
		result.RateMicrocredits = group.PointsPerUSD
		if override != nil && override.PointsPerUSD > 0 {
			result.RateMicrocredits = override.PointsPerUSD
		}
	case model.PriceCurrencyCNY:
		result.RateMicrocredits = group.PointsPerCNY
		if override != nil && override.PointsPerCNY > 0 {
			result.RateMicrocredits = override.PointsPerCNY
		}
	}
	if result.RateMicrocredits <= 0 {
		return groupPricing{}, ModelPriceNotConfigured("当前账号分组尚未配置 " + normalizedCurrency + " 兑换积分比例")
	}
	if result.MultiplierBPS <= 0 {
		return groupPricing{}, ModelPriceNotConfigured("当前账号分组倍率无效")
	}
	return result, nil
}

// convertPrice 把百万分之一货币单位的价格换算成微积分并向上取整；积分计价时原样返回。
func (p groupPricing) convertPrice(price int64) (int64, error) {
	if price < 0 {
		return 0, errors.New("模型价格无效")
	}
	if p.RateMicrocredits == CreditScale || price == 0 {
		return price, nil
	}
	product := new(big.Int).Mul(big.NewInt(price), big.NewInt(p.RateMicrocredits))
	scale := big.NewInt(CreditScale)
	product.Add(product, new(big.Int).Sub(scale, big.NewInt(1)))
	product.Quo(product, scale)
	if !product.IsInt64() {
		return 0, errors.New("模型价格换算溢出")
	}
	return product.Int64(), nil
}

// combineMultiplierBPS 连乘多个基点倍率并向上取整，结果至少为 1 个基点。
func combineMultiplierBPS(values ...int64) int64 {
	result := big.NewInt(10_000)
	scale := big.NewInt(10_000)
	for _, value := range values {
		if value <= 0 {
			continue
		}
		result.Mul(result, big.NewInt(value))
		result.Add(result, big.NewInt(9_999))
		result.Quo(result, scale)
	}
	if !result.IsInt64() || result.Int64() > 1<<40 {
		return 1 << 40
	}
	if result.Int64() < 1 {
		return 1
	}
	return result.Int64()
}

// PublicUserGroupFor 返回会话展示用的分组；分组缺失时返回 nil，不阻断登录态读取。
func (s *Service) PublicUserGroupFor(user *model.User) *PublicUserGroup {
	if user == nil {
		return nil
	}
	group, err := s.resolvedUserGroup(user.UserGroup)
	if err != nil {
		return nil
	}
	return &PublicUserGroup{Code: group.Code, Name: group.Name, BadgeLabel: group.BadgeLabel, BadgeStyle: group.BadgeStyle, RatioBasisPoints: group.RatioBasisPoints}
}

// requireExistingUserGroup 校验管理员给用户分配的分组存在，返回写入 users 表的编码。
func (s *Service) requireExistingUserGroup(code string) (string, error) {
	normalized := normalizeUserGroupCode(code)
	if normalized == model.DefaultUserGroupCode {
		if _, err := s.resolvedUserGroup(normalized); err != nil {
			return "", err
		}
		return "", nil
	}
	if _, err := s.repo.UserGroupByCode(normalized); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", BadAuthRequest("用户分组不存在")
		}
		return "", err
	}
	return storedUserGroupCode(normalized), nil
}

func (s *Service) AdminUserGroups(actor *model.User) ([]UserGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	groups, err := s.repo.UserGroups()
	if err != nil {
		return nil, err
	}
	bindings, err := s.repo.UserGroupChannels()
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.UserGroupUserCounts()
	if err != nil {
		return nil, err
	}
	channelsByGroup := make(map[string][]string, len(groups))
	for _, binding := range bindings {
		channelsByGroup[binding.GroupID] = append(channelsByGroup[binding.GroupID], binding.ChannelID)
	}
	result := make([]UserGroupView, 0, len(groups))
	for _, group := range groups {
		overrides, decodeErr := decodeUserGroupOverrides(group.ModelOverridesJSON)
		if decodeErr != nil {
			return nil, decodeErr
		}
		count := counts[group.Code]
		if group.Code == model.DefaultUserGroupCode {
			count += counts[""]
		}
		channelIDs := channelsByGroup[group.ID]
		if channelIDs == nil {
			channelIDs = []string{}
		}
		result = append(result, UserGroupView{UserGroup: group, IsDefault: group.Code == model.DefaultUserGroupCode, ChannelIDs: channelIDs, ModelOverrides: overrides, UserCount: count})
	}
	return result, nil
}

func (s *Service) CreateUserGroup(actor *model.User, req UserGroupRequest) (*UserGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	code := strings.ToLower(strings.TrimSpace(req.Code))
	if !userGroupCodePattern.MatchString(code) {
		return nil, BadAuthRequest("分组编码只能使用小写字母、数字、下划线或连字符，最多 40 位")
	}
	if _, err := s.repo.UserGroupByCode(code); err == nil {
		return nil, BadAuthRequest("分组编码已存在")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	group := &model.UserGroup{ID: newID(), Code: code}
	channelIDs, err := s.applyUserGroupRequest(group, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveUserGroupWithChannels(group, channelIDs, true); err != nil {
		return nil, err
	}
	s.invalidateUserGroups()
	if err := s.appendAdminAudit(actor, "user_group.create", "user_group", group.ID, "创建用户分组", userGroupAuditMetadata(group, channelIDs)); err != nil {
		return nil, err
	}
	return s.adminUserGroupView(actor, group.ID)
}

func (s *Service) UpdateUserGroup(actor *model.User, id string, req UserGroupRequest) (*UserGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	group, err := s.repo.UserGroup(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("用户分组不存在")
	}
	if err != nil {
		return nil, err
	}
	if code := strings.ToLower(strings.TrimSpace(req.Code)); code != "" && code != group.Code {
		return nil, BadAuthRequest("分组编码创建后不能修改")
	}
	channelIDs, err := s.applyUserGroupRequest(group, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveUserGroupWithChannels(group, channelIDs, false); err != nil {
		return nil, err
	}
	s.invalidateUserGroups()
	if err := s.appendAdminAudit(actor, "user_group.update", "user_group", group.ID, "更新用户分组", userGroupAuditMetadata(group, channelIDs)); err != nil {
		return nil, err
	}
	return s.adminUserGroupView(actor, group.ID)
}

func (s *Service) DeleteUserGroup(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	group, err := s.repo.UserGroup(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("用户分组不存在")
	}
	if err != nil {
		return err
	}
	if group.Code == model.DefaultUserGroupCode {
		return BadAuthRequest("默认分组不能删除")
	}
	if err := s.repo.DeleteUserGroup(group.ID, group.Code); err != nil {
		if errors.Is(err, repository.ErrUserGroupInUse) {
			return BadAuthRequest("分组下仍有用户，请先把用户调整到其他分组")
		}
		return err
	}
	s.invalidateUserGroups()
	return s.appendAdminAudit(actor, "user_group.delete", "user_group", group.ID, "删除用户分组", map[string]any{"code": group.Code})
}

func (s *Service) adminUserGroupView(actor *model.User, id string) (*UserGroupView, error) {
	groups, err := s.AdminUserGroups(actor)
	if err != nil {
		return nil, err
	}
	for index := range groups {
		if groups[index].ID == id {
			return &groups[index], nil
		}
	}
	return nil, NotFound("用户分组不存在")
}

// applyUserGroupRequest 校验并写入可编辑字段，返回去重后的渠道绑定。
func (s *Service) applyUserGroupRequest(group *model.UserGroup, req UserGroupRequest) ([]string, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 80 {
		return nil, BadAuthRequest("分组名称不能为空且不能超过 80 字")
	}
	description := strings.TrimSpace(req.Description)
	if len([]rune(description)) > 500 {
		return nil, BadAuthRequest("分组说明不能超过 500 字")
	}
	badgeLabel := strings.TrimSpace(req.BadgeLabel)
	if len([]rune(badgeLabel)) > 16 {
		return nil, BadAuthRequest("徽章文字不能超过 16 字")
	}
	badgeStyle := strings.ToLower(strings.TrimSpace(req.BadgeStyle))
	switch badgeStyle {
	case "", model.UserGroupBadgeNone:
		badgeStyle = model.UserGroupBadgeNone
	case model.UserGroupBadgeVIP, model.UserGroupBadgeSVIP:
	default:
		return nil, BadAuthRequest("徽章样式无效")
	}
	if req.RatioBasisPoints <= 0 || req.RatioBasisPoints > maxUserGroupRatioBPS {
		return nil, BadAuthRequest("分组倍率必须在 0.0001-100 之间")
	}
	if req.PointsPerUSD < 0 || req.PointsPerUSD > maxPointsPerCurrency || req.PointsPerCNY < 0 || req.PointsPerCNY > maxPointsPerCurrency {
		return nil, BadAuthRequest("货币兑换积分比例必须在 0 至 100 万积分之间")
	}
	overrides, err := normalizeUserGroupOverrides(req.ModelOverrides)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(overrides)
	if err != nil {
		return nil, err
	}
	channelIDs := []string{}
	if !req.AllChannels {
		channelIDs = uniqueNonEmpty(req.ChannelIDs)
		if len(channelIDs) > 0 {
			channels, channelErr := s.repo.SystemChannelsByIDs(channelIDs, true)
			if channelErr != nil {
				return nil, channelErr
			}
			if len(channels) != len(channelIDs) {
				return nil, BadAuthRequest("分组绑定的系统渠道不存在或已删除")
			}
		}
		sort.Strings(channelIDs)
	}
	group.Name = name
	group.Description = description
	group.BadgeLabel = badgeLabel
	group.BadgeStyle = badgeStyle
	group.SortOrder = req.SortOrder
	group.RatioBasisPoints = req.RatioBasisPoints
	group.PointsPerUSD = req.PointsPerUSD
	group.PointsPerCNY = req.PointsPerCNY
	group.AllChannels = req.AllChannels
	group.ModelOverridesJSON = string(encoded)
	return channelIDs, nil
}

func normalizeUserGroupOverrides(items []model.UserGroupModelOverride) ([]model.UserGroupModelOverride, error) {
	if len(items) > maxUserGroupOverrides {
		return nil, BadAuthRequest("单个分组最多配置 500 个模型倍率")
	}
	result := make([]model.UserGroupModelOverride, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		key := strings.TrimPrefix(strings.TrimSpace(item.ModelKey), "models/")
		if key == "" || len([]rune(key)) > 120 {
			return nil, BadAuthRequest("模型倍率的模型标识不能为空且不能超过 120 字")
		}
		if seen[key] {
			return nil, BadAuthRequest("模型 " + key + " 重复配置了倍率")
		}
		seen[key] = true
		if item.RatioBasisPoints < 0 || item.RatioBasisPoints > maxUserGroupRatioBPS {
			return nil, BadAuthRequest("模型 " + key + " 的倍率必须在 0.0001-100 之间")
		}
		if item.PointsPerUSD < 0 || item.PointsPerUSD > maxPointsPerCurrency || item.PointsPerCNY < 0 || item.PointsPerCNY > maxPointsPerCurrency {
			return nil, BadAuthRequest("模型 " + key + " 的货币兑换积分比例无效")
		}
		if item.RatioBasisPoints == 0 && item.PointsPerUSD == 0 && item.PointsPerCNY == 0 {
			continue
		}
		result = append(result, model.UserGroupModelOverride{ModelKey: key, RatioBasisPoints: item.RatioBasisPoints, PointsPerUSD: item.PointsPerUSD, PointsPerCNY: item.PointsPerCNY})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ModelKey < result[j].ModelKey })
	return result, nil
}

func userGroupAuditMetadata(group *model.UserGroup, channelIDs []string) map[string]any {
	return map[string]any{
		"code": group.Code, "ratioBasisPoints": group.RatioBasisPoints,
		"pointsPerUsdMicrocredits": group.PointsPerUSD, "pointsPerCnyMicrocredits": group.PointsPerCNY,
		"allChannels": group.AllChannels, "channelIds": channelIDs, "badgeStyle": group.BadgeStyle,
	}
}

// ModelCatalogForUser 是 HTTP 目录入口：按登录用户的分组过滤渠道并换算价格。
func (s *Service) ModelCatalogForUser(user *model.User, intent *ModelRequestIntent) (*ModelCatalogResponse, error) {
	access, err := s.userGroupAccessForUser(user)
	if err != nil {
		return nil, err
	}
	return s.ModelCatalog(access, intent)
}

// PublicLogicalModelsForUser 是前台模型目录的 HTTP 入口。
func (s *Service) PublicLogicalModelsForUser(user *model.User, intent *ModelRequestIntent) ([]PublicLogicalModel, error) {
	access, err := s.userGroupAccessForUser(user)
	if err != nil {
		return nil, err
	}
	return s.PublicLogicalModels(access, intent)
}

// RequireUserChannelAccess 供系统渠道中转校验分组权限。
func (s *Service) RequireUserChannelAccess(user *model.User, channelID string) error {
	access, err := s.userGroupAccessForUser(user)
	if err != nil {
		return err
	}
	return access.requireChannel(channelID)
}
