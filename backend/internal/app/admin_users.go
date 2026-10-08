// 管理端用户管理：列表、创建、更新、删除与批量停用。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

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
	channelIDs := make([]string, 0, len(channels))
	for _, channel := range channels {
		channelIDs = append(channelIDs, channel.ID)
	}
	channelModels, err := s.repo.ChannelModelReferences(channelIDs)
	if err != nil {
		return nil, err
	}
	modelsByChannel := make(map[string][]model.ChannelModel, len(channels))
	for _, item := range channelModels {
		modelsByChannel[item.ChannelID] = append(modelsByChannel[item.ChannelID], item)
	}
	result := &AdminReferenceData{
		Users:    make([]AdminUserReference, 0, len(users)),
		Channels: make([]AdminChannelReference, 0, len(channels)),
	}
	for _, user := range users {
		result.Users = append(result.Users, AdminUserReference{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName})
	}
	for _, channel := range channels {
		items := modelsByChannel[channel.ID]
		models := make([]string, 0, len(items))
		displayNames := make([]string, 0, len(items))
		for _, item := range items {
			if item.Enabled {
				models = append(models, item.ModelKey)
			}
			displayNames = append(displayNames, firstNonEmpty(strings.TrimSpace(item.DisplayName), item.ModelKey))
		}
		result.Channels = append(result.Channels, AdminChannelReference{ID: channel.ID, Name: channel.Name, Enabled: channel.Enabled, Models: uniqueNonEmpty(models), ModelDisplayNames: uniqueNonEmpty(displayNames)})
	}
	return result, nil
}

func (s *Service) CreateAdminUser(actor *model.User, req CreateAdminUserRequest) (*AdminUser, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	username := normalizeUsername(req.Username)
	email := normalizeEmail(req.Email)
	displayName := normalizeDisplayName(req.DisplayName, username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := validatePassword(req.Password); err != nil {
		return nil, err
	}
	if email != "" {
		if err := validateEmail(email); err != nil {
			return nil, err
		}
	}
	if req.Role != model.UserRoleAdmin && req.Role != model.UserRoleUser {
		return nil, BadAuthRequest("\u7528\u6237\u89d2\u8272\u65e0\u6548")
	}
	if req.Status != model.UserStatusActive && req.Status != model.UserStatusDisabled {
		return nil, BadAuthRequest("\u7528\u6237\u72b6\u6001\u65e0\u6548")
	}
	if _, err := s.repo.UserByUsername(username); err == nil {
		return nil, BadAuthRequest("\u7528\u6237\u540d\u5df2\u5b58\u5728")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if email != "" {
		if _, err := s.repo.UserByEmail(email); err == nil {
			return nil, BadAuthRequest("\u90ae\u7bb1\u5df2\u88ab\u6ce8\u518c")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	passwordHash, err := hashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	user := &model.User{
		ID:           newID(),
		Username:     username,
		Email:        email,
		DisplayName:  displayName,
		Role:         req.Role,
		Status:       req.Status,
		PasswordHash: passwordHash,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.repo.Create(user); err != nil {
		return nil, err
	}
	if err := s.ensureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "user.create", "user", user.ID, "\u521b\u5efa\u7528\u6237\u8d26\u53f7", map[string]any{"role": user.Role, "status": user.Status}); err != nil {
		return nil, err
	}
	account, err := s.repo.CreditAccount(user.ID)
	if err != nil {
		return nil, err
	}
	return &AdminUser{
		User:                  *user,
		AvailableMicrocredits: account.AvailableMicrocredits,
		ReservedMicrocredits:  account.ReservedMicrocredits,
	}, nil
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
		if err := s.repo.DeleteUserAuthSessions(user.ID); err != nil {
			return nil, fmt.Errorf("清理旧登录会话失败，密码未更新：%w", err)
		}
	}
	if nextStatus == model.UserStatusDisabled {
		if err := s.repo.DeleteUserAuthSessions(user.ID); err != nil {
			return nil, err
		}
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
	if err := s.repo.DeleteUserTaskTextDeltas(user.ID); err != nil {
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
