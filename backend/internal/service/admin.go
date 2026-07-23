package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type UpdateUserRequest struct {
	DisplayName string           `json:"displayName"`
	Email       string           `json:"email"`
	Password    string           `json:"password"`
	Role        model.UserRole   `json:"role"`
	Status      model.UserStatus `json:"status"`
}

type BulkDisableUsersRequest struct {
	UserIDs []string `json:"userIds"`
}

type BulkDisableUsersResult struct {
	Users         []model.User `json:"users"`
	DisabledCount int          `json:"disabledCount"`
}

type AdminListQuery struct {
	Keyword string
	Status  string
	Type    string
	Page    int
	Limit   int
}

type AdminUserPage struct {
	Users []AdminUser `json:"users"`
	Total int64       `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"limit"`
}

type AdminUser struct {
	model.User
	AvailableMicrocredits int64 `json:"availableMicrocredits"`
	ReservedMicrocredits  int64 `json:"reservedMicrocredits"`
}

type AdminChannelPage struct {
	Channels []PublicModelChannel `json:"channels"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	Limit    int                  `json:"limit"`
}

type AdminUserReference struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type AdminChannelReference struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

type AdminReferenceData struct {
	Users    []AdminUserReference    `json:"users"`
	Channels []AdminChannelReference `json:"channels"`
}

type ChannelRequest struct {
	Name                 string   `json:"name"`
	BaseURL              string   `json:"baseUrl"`
	APIKey               string   `json:"apiKey"`
	InterfaceType        string   `json:"interfaceType"`
	ConcurrencyLimit     *int     `json:"concurrencyLimit"`
	UseGlobalConcurrency *bool    `json:"useGlobalConcurrency"`
	Models               []string `json:"models"`
	Enabled              *bool    `json:"enabled"`
}

type PublicModelChannel struct {
	ID               string                     `json:"id"`
	UserID           string                     `json:"userId"`
	Scope            model.ChannelScope         `json:"scope"`
	Enabled          bool                       `json:"enabled"`
	Name             string                     `json:"name"`
	BaseURL          string                     `json:"baseUrl"`
	APIKey           string                     `json:"apiKey"`
	APIFormat        string                     `json:"apiFormat"`
	InterfaceType    model.ChannelInterfaceType `json:"interfaceType"`
	ConcurrencyLimit int                        `json:"concurrencyLimit"`
	Models           []string                   `json:"models"`
	ModelCosts       []PublicChannelModelPrice  `json:"modelCosts"`
	HasAPIKey        bool                       `json:"hasApiKey"`
	CreatedAt        time.Time                  `json:"createdAt"`
	UpdatedAt        time.Time                  `json:"updatedAt"`
}

type PublicChannelModelPrice struct {
	Model                 string `json:"model"`
	Capability            string `json:"capability"`
	BillingMode           string `json:"billingMode"`
	UnitPriceMicrocredits int64  `json:"unitPriceMicrocredits"`
}

func (s *Service) RequireAdmin(user *model.User) error {
	if user == nil {
		return Unauthorized("请先登录")
	}
	if user.Role != model.UserRoleAdmin {
		return Forbidden("需要管理员权限")
	}
	return nil
}

func (s *Service) AdminUsers(actor *model.User, query AdminListQuery) (*AdminUserPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	users, total, err := s.repo.AdminUsers(query.Keyword, model.UserRole(query.Type), model.UserStatus(query.Status), limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(users))
	for _, user := range users {
		userIDs = append(userIDs, user.ID)
	}
	accounts, err := s.repo.CreditAccounts(userIDs)
	if err != nil {
		return nil, err
	}
	accountByUserID := make(map[string]model.CreditAccount, len(accounts))
	for _, account := range accounts {
		accountByUserID[account.UserID] = account
	}
	result := make([]AdminUser, 0, len(users))
	for _, user := range users {
		account := accountByUserID[user.ID]
		result = append(result, AdminUser{User: user, AvailableMicrocredits: account.AvailableMicrocredits, ReservedMicrocredits: account.ReservedMicrocredits})
	}
	return &AdminUserPage{Users: result, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminReferences(actor *model.User) (*AdminReferenceData, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	users, err := s.repo.AdminUserReferences()
	if err != nil {
		return nil, err
	}
	channels, err := s.repo.AdminSystemChannelReferences()
	if err != nil {
		return nil, err
	}
	result := &AdminReferenceData{
		Users:    make([]AdminUserReference, 0, len(users)),
		Channels: make([]AdminChannelReference, 0, len(channels)),
	}
	for _, user := range users {
		result.Users = append(result.Users, AdminUserReference{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName})
	}
	for _, channel := range channels {
		items, itemErr := s.repo.ChannelModels(channel.ID, true)
		if itemErr != nil {
			return nil, itemErr
		}
		models := make([]string, 0, len(items))
		for _, item := range items {
			models = append(models, item.ModelKey)
		}
		result.Channels = append(result.Channels, AdminChannelReference{ID: channel.ID, Name: channel.Name, Models: uniqueNonEmpty(models)})
	}
	return result, nil
}

func (s *Service) UpdateUser(actor *model.User, userID string, req UpdateUserRequest) (*model.User, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	user, err := s.repo.User(userID)
	if err != nil {
		return nil, err
	}
	if actor.ID == user.ID && req.Status == model.UserStatusDisabled {
		return nil, BadAuthRequest("不能禁用当前管理员账号")
	}
	nextRole := user.Role
	if req.Role == model.UserRoleAdmin || req.Role == model.UserRoleUser {
		nextRole = req.Role
	}
	nextStatus := user.Status
	if req.Status == model.UserStatusActive || req.Status == model.UserStatusDisabled {
		nextStatus = req.Status
	}
	if user.Role == model.UserRoleAdmin && nextRole != model.UserRoleAdmin {
		count, err := s.repo.ActiveAdminCountExcluding(user.ID)
		if err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, BadAuthRequest("至少需要保留一个管理员")
		}
	}
	if user.Role == model.UserRoleAdmin && nextStatus != model.UserStatusActive {
		count, err := s.repo.ActiveAdminCountExcluding(user.ID)
		if err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, BadAuthRequest("至少需要保留一个可用管理员")
		}
	}
	if strings.TrimSpace(req.DisplayName) != "" {
		user.DisplayName = normalizeDisplayName(req.DisplayName, user.Username)
	}
	if req.Email != "" {
		email := normalizeEmail(req.Email)
		if err := validateEmail(email); err != nil {
			return nil, err
		}
		existing, err := s.repo.UserByEmail(email)
		if err == nil && existing.ID != user.ID {
			return nil, BadAuthRequest("邮箱已被注册")
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		user.Email = email
	}
	if req.Password != "" {
		if err := validatePassword(req.Password); err != nil {
			return nil, err
		}
		hash, err := hashPassword(req.Password)
		if err != nil {
			return nil, err
		}
		user.PasswordHash = hash
		_ = s.repo.DeleteUserAuthSessions(user.ID)
	}
	user.Role = nextRole
	user.Status = nextStatus
	user.UpdatedAt = time.Now()
	if err := s.repo.Save(user); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "user.update", "user", user.ID, "更新用户账号状态或资料", map[string]any{"role": user.Role, "status": user.Status}); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) DeleteUser(actor *model.User, userID string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if actor.ID == userID {
		return BadAuthRequest("不能删除当前登录的管理员账号")
	}
	user, err := s.repo.User(userID)
	if err != nil {
		return err
	}
	if user.Role == model.UserRoleAdmin {
		count, err := s.repo.ActiveAdminCountExcluding(user.ID)
		if err != nil {
			return err
		}
		if count == 0 {
			return BadAuthRequest("至少需要保留一个管理员")
		}
	}
	if err := s.repo.DeleteUserAuthSessions(user.ID); err != nil {
		return err
	}
	// 有资金流水后必须保留用户主体，删除入口改为停用并清除全部登录态。
	user.Status = model.UserStatusDisabled
	user.UpdatedAt = time.Now()
	if err := s.repo.Save(user); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "user.disable", "user", user.ID, "停用用户并清除登录态", nil)
}

func (s *Service) BulkDisableUsers(actor *model.User, req BulkDisableUsersRequest) (*BulkDisableUsersResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(req.UserIDs))
	userIDs := make([]string, 0, len(req.UserIDs))
	for _, rawID := range req.UserIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return nil, BadAuthRequest("用户 ID 无效")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		userIDs = append(userIDs, id)
	}
	if len(userIDs) == 0 {
		return nil, BadAuthRequest("请选择要停用的用户")
	}
	if len(userIDs) > 100 {
		return nil, BadAuthRequest("单次最多停用 100 个用户")
	}
	metadata, err := json.Marshal(map[string]any{"userIds": userIDs, "count": len(userIDs)})
	if err != nil {
		return nil, err
	}
	now := time.Now()
	events := make([]model.AdminAuditEvent, 0, len(userIDs))
	for _, userID := range userIDs {
		events = append(events, model.AdminAuditEvent{ID: newID(), ActorUserID: actor.ID, Action: "user.bulk_disable", TargetType: "user", TargetID: userID, Summary: "批量停用用户并清除登录态", MetadataJSON: string(metadata), CreatedAt: now})
	}
	users, err := s.repo.BulkDisableUsers(actor.ID, userIDs, events, now)
	if errors.Is(err, repository.ErrBulkUserNotFound) {
		return nil, BadAuthRequest("部分用户不存在，请刷新列表后重试")
	}
	if errors.Is(err, repository.ErrBulkCurrentAdmin) {
		return nil, BadAuthRequest("不能停用当前登录的管理员账号")
	}
	if errors.Is(err, repository.ErrBulkLastActiveAdmin) {
		return nil, BadAuthRequest("批量操作后至少需要保留一个可用管理员")
	}
	if err != nil {
		return nil, err
	}
	return &BulkDisableUsersResult{Users: users, DisabledCount: len(users)}, nil
}

func (s *Service) PublicSystemChannels() ([]PublicModelChannel, error) {
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return nil, err
	}
	result := make([]PublicModelChannel, 0, len(channels))
	for _, channel := range channels {
		items, itemErr := s.repo.ChannelModels(channel.ID, false)
		if itemErr != nil {
			return nil, itemErr
		}
		result = append(result, publicChannel(channel, false, items))
	}
	return result, nil
}

func (s *Service) SystemChannel(id string) (*model.ModelChannel, error) {
	return s.repo.SystemChannel(id)
}

func (s *Service) AdminSystemChannelPage(actor *model.User, query AdminListQuery) (*AdminChannelPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	channels, total, err := s.repo.AdminSystemChannels(query.Keyword, query.Type, query.Status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	result := make([]PublicModelChannel, 0, len(channels))
	for _, channel := range channels {
		items, itemErr := s.repo.ChannelModels(channel.ID, true)
		if itemErr != nil {
			return nil, itemErr
		}
		result = append(result, publicChannel(channel, true, items))
	}
	return &AdminChannelPage{Channels: result, Total: total, Page: page, Limit: limit}, nil
}

func normalizeAdminPage(page int, limit int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return page, limit
}

func (s *Service) CreateSystemChannel(actor *model.User, req ChannelRequest) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := channelFromRequest(req, model.ModelChannel{ID: newID(), UserID: actor.ID, Scope: model.ChannelScopeSystem, Enabled: true})
	if err != nil {
		return nil, err
	}
	if err := s.repo.Create(&channel); err != nil {
		return nil, err
	}
	if err := s.syncInitialChannelModels(&channel, req.Models); err != nil {
		return nil, err
	}
	items, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(channel, true, items)
	return &public, nil
}

func (s *Service) UpdateSystemChannel(actor *model.User, id string, req ChannelRequest) (*PublicModelChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		return nil, err
	}
	req = mergeChannelRequest(req, *channel)
	next, err := channelFromRequest(req, *channel)
	if err != nil {
		return nil, err
	}
	next.ID = channel.ID
	next.UserID = channel.UserID
	next.Scope = model.ChannelScopeSystem
	next.CreatedAt = channel.CreatedAt
	if req.APIKey == "" {
		next.APIKey = channel.APIKey
	}
	if err := s.repo.Save(&next); err != nil {
		return nil, err
	}
	if err := s.syncInitialChannelModels(&next, req.Models); err != nil {
		return nil, err
	}
	items, err := s.repo.ChannelModels(next.ID, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(next, true, items)
	return &public, nil
}

func (s *Service) DeleteSystemChannel(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		return err
	}
	// 历史账单和调用日志需要保留渠道主体，删除入口仅停用。
	channel.Enabled = false
	channel.UpdatedAt = time.Now()
	return s.repo.Save(channel)
}

func (s *Service) LogAPICall(log model.ApiCallLog) error {
	if log.ID == "" {
		log.ID = newID()
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now()
	}
	s.estimateCallCost(&log)
	if log.BillingOrderID != "" && log.ProviderRequestID != "" {
		if err := s.repo.UpdateBillingProviderRequestID(log.BillingOrderID, log.ProviderRequestID); err != nil {
			return err
		}
	}
	if log.TaskID != "" {
		stage := log.RequestKind
		var nextPollAt *time.Time
		if stage == "create" && log.Status == model.ApiCallStatusSucceeded && log.ProviderRequestID != "" {
			stage = "accepted"
			next := time.Now().Add(2 * time.Second)
			nextPollAt = &next
		} else if stage == "poll" {
			next := time.Now().Add(5 * time.Second)
			nextPollAt = &next
		}
		if err := s.repo.UpdateTaskProviderState(log.TaskID, log.ProviderRequestID, stage, nextPollAt); err != nil {
			return err
		}
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(log.UserID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len(log.Path) + len(log.Model) + len(log.ProviderRequestID) + len(log.ErrorCode) + len(log.Error) + len(log.UpstreamURL))
	if err := validateAPICallLogQuotaWithPolicy(usage, incomingBytes, policy.Resource); err != nil {
		return err
	}
	return s.repo.Create(&log)
}

func (s *Service) APICallLogs(actor *model.User, limit int) ([]model.ApiCallLog, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	return s.repo.ApiCallLogs(actor.ID, actor.Role == model.UserRoleAdmin, limit)
}

func channelFromRequest(req ChannelRequest, channel model.ModelChannel) (model.ModelChannel, error) {
	name := strings.TrimSpace(req.Name)
	baseURL := strings.TrimSpace(req.BaseURL)
	interfaceType := model.ChannelInterfaceType(strings.TrimSpace(req.InterfaceType))
	if name == "" {
		return channel, BadAuthRequest("请填写渠道名称")
	}
	if baseURL == "" {
		return channel, BadAuthRequest("请填写 Base URL")
	}
	if !validChannelInterfaceType(interfaceType) {
		return channel, BadAuthRequest("请选择有效的接口类型")
	}
	if _, err := ValidateOutboundURL(baseURL); err != nil {
		return channel, err
	}
	models := uniqueNonEmpty(req.Models)
	modelsJSON, _ := json.Marshal(models)
	channel.Name = name
	channel.BaseURL = strings.TrimRight(baseURL, "/")
	if req.APIKey != "" {
		channel.APIKey = req.APIKey
	}
	// 系统渠道均由后端按已声明的接口类型分发，调用格式固定为 Bearer/OpenAI 兼容鉴权。
	channel.APIFormat = "openai"
	channel.InterfaceType = interfaceType
	if req.UseGlobalConcurrency != nil && *req.UseGlobalConcurrency {
		channel.ConcurrencyLimit = 0
	} else if req.ConcurrencyLimit != nil {
		if *req.ConcurrencyLimit < minChannelConcurrencyLimit || *req.ConcurrencyLimit > maxChannelConcurrencyLimit {
			return channel, BadAuthRequest("最大并发数必须是 1-999 的整数")
		}
		channel.ConcurrencyLimit = *req.ConcurrencyLimit
	} else if req.UseGlobalConcurrency != nil {
		return channel, BadAuthRequest("请填写渠道最大并发数")
	}
	channel.ModelsJSON = string(modelsJSON)
	if req.Enabled != nil {
		channel.Enabled = *req.Enabled
	}
	return channel, nil
}

func mergeChannelRequest(req ChannelRequest, channel model.ModelChannel) ChannelRequest {
	if strings.TrimSpace(req.Name) == "" {
		req.Name = channel.Name
	}
	if strings.TrimSpace(req.BaseURL) == "" {
		req.BaseURL = channel.BaseURL
	}
	if req.Models == nil {
		req.Models = channelModelNames(channel)
	}
	if strings.TrimSpace(req.InterfaceType) == "" {
		req.InterfaceType = string(channel.InterfaceType)
		if req.InterfaceType == "" {
			req.InterfaceType = string(inferChannelInterfaceType(req.Models))
		}
	}
	return req
}

func validChannelInterfaceType(value model.ChannelInterfaceType) bool {
	switch value {
	case model.ChannelInterfaceChatCompletion, model.ChannelInterfaceOpenAIResponse, model.ChannelInterfaceOpenAIImage, model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo:
		return true
	default:
		return false
	}
}

func inferChannelInterfaceType(models []string) model.ChannelInterfaceType {
	for _, name := range models {
		value := strings.ToLower(name)
		if strings.Contains(value, "video") || strings.Contains(value, "seedance") || strings.Contains(value, "sora") || strings.Contains(value, "veo") || strings.Contains(value, "kling") || strings.Contains(value, "wan") || strings.Contains(value, "hailuo") {
			return model.ChannelInterfaceNewAPIVideo
		}
	}
	for _, name := range models {
		value := strings.ToLower(name)
		if strings.Contains(value, "image") || strings.Contains(value, "seedream") || strings.Contains(value, "dall-e") || strings.Contains(value, "flux") || strings.Contains(value, "imagen") {
			return model.ChannelInterfaceOpenAIImage
		}
	}
	return model.ChannelInterfaceChatCompletion
}

func publicChannel(channel model.ModelChannel, admin bool, channelModels []model.ChannelModel) PublicModelChannel {
	models := make([]string, 0, len(channelModels))
	modelCosts := make([]PublicChannelModelPrice, 0, len(channelModels))
	for _, item := range channelModels {
		if !item.Enabled {
			continue
		}
		models = append(models, item.ModelKey)
		if item.Enabled && item.PriceConfigured {
			modelCosts = append(modelCosts, PublicChannelModelPrice{Model: item.ModelKey, Capability: item.Capability, BillingMode: item.BillingMode, UnitPriceMicrocredits: item.UnitPriceMicrocredits})
		}
	}
	if len(models) == 0 {
		_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	}
	apiKey := ""
	baseURL := channel.BaseURL
	if channel.Scope == model.ChannelScopeSystem {
		if !admin {
			apiKey = "system"
			baseURL = "/api/ai/system/" + channel.ID
		}
	} else if admin {
		apiKey = channel.APIKey
	}
	interfaceType := channel.InterfaceType
	if !validChannelInterfaceType(interfaceType) {
		interfaceType = inferChannelInterfaceType(models)
	}
	return PublicModelChannel{
		ID:               channel.ID,
		UserID:           channel.UserID,
		Scope:            channel.Scope,
		Enabled:          channel.Enabled,
		Name:             channel.Name,
		BaseURL:          baseURL,
		APIKey:           apiKey,
		APIFormat:        channel.APIFormat,
		InterfaceType:    interfaceType,
		ConcurrencyLimit: channel.ConcurrencyLimit,
		Models:           models,
		ModelCosts:       modelCosts,
		HasAPIKey:        strings.TrimSpace(channel.APIKey) != "",
		CreatedAt:        channel.CreatedAt,
		UpdatedAt:        channel.UpdatedAt,
	}
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]bool{}
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
