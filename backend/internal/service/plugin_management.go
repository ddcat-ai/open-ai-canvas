package service

import (
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const (
	PluginEagleAssetConnector = "eagle-asset-connector"
	PluginPromptOptimizer     = "prompt-optimizer"
	PluginPortraitClearance   = "portrait-clearance"

	PluginOriginOfficial = "official"
	PluginOriginUploaded = "uploaded"

	PluginKindProtocol    = "protocol"
	PluginKindApplication = "application"

	PluginScopeSystem = "system"
	PluginScopeUser   = "user"

	PluginConfigurationNone   = "none"
	PluginConfigurationSystem = "system"
	PluginConfigurationUser   = "user"
)

// PluginManagementView is computed by the host. Uploaded manifests cannot
// choose their own privilege or activation scope.
type PluginManagementView struct {
	Origin             string `json:"origin"`
	Kind               string `json:"kind"`
	ActivationScope    string `json:"activationScope"`
	ConfigurationScope string `json:"configurationScope"`
}

type PluginStateView struct {
	PluginID          string `json:"pluginId"`
	PlatformAvailable bool   `json:"platformAvailable"`
	UserEnabled       bool   `json:"userEnabled"`
	UserConfigured    bool   `json:"userConfigured"`
	EffectiveEnabled  bool   `json:"effectiveEnabled"`
	CanToggle         bool   `json:"canToggle"`
	CanConfigure      bool   `json:"canConfigure"`
	BlockedReason     string `json:"blockedReason,omitempty"`
}

type AdminPluginStateView struct {
	PluginStateView
	EnabledUserCount int64 `json:"enabledUserCount"`
}

var officialApplicationPolicies = map[string]PluginManagementView{
	WorkflowPluginRunningHub: {
		Origin: PluginOriginOfficial, Kind: PluginKindApplication,
		ActivationScope: PluginScopeUser, ConfigurationScope: PluginConfigurationUser,
	},
	WorkflowPluginComfyUI: {
		Origin: PluginOriginOfficial, Kind: PluginKindApplication,
		ActivationScope: PluginScopeUser, ConfigurationScope: PluginConfigurationUser,
	},
	PluginEagleAssetConnector: {
		Origin: PluginOriginOfficial, Kind: PluginKindApplication,
		ActivationScope: PluginScopeUser, ConfigurationScope: PluginConfigurationUser,
	},
	PluginPromptOptimizer: {
		Origin: PluginOriginOfficial, Kind: PluginKindApplication,
		ActivationScope: PluginScopeUser, ConfigurationScope: PluginConfigurationNone,
	},
	PluginPortraitClearance: {
		Origin: PluginOriginOfficial, Kind: PluginKindApplication,
		ActivationScope: PluginScopeUser, ConfigurationScope: PluginConfigurationNone,
	},
}

func pluginManagement(pluginID string, source string) PluginManagementView {
	if strings.TrimSpace(source) == PluginOriginUploaded {
		return PluginManagementView{
			Origin: PluginOriginUploaded, Kind: PluginKindProtocol,
			ActivationScope: PluginScopeSystem, ConfigurationScope: PluginConfigurationSystem,
		}
	}
	if policy, ok := officialApplicationPolicies[strings.TrimSpace(pluginID)]; ok {
		return policy
	}
	return PluginManagementView{
		Origin: PluginOriginOfficial, Kind: PluginKindProtocol,
		ActivationScope: PluginScopeSystem, ConfigurationScope: PluginConfigurationSystem,
	}
}

func knownPluginIDs(items []PluginView) []string {
	seen := make(map[string]struct{}, len(items)+len(officialApplicationPolicies))
	ids := make([]string, 0, len(items)+len(officialApplicationPolicies))
	for id := range officialApplicationPolicies {
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, item := range items {
		if _, exists := seen[item.Manifest.ID]; exists {
			continue
		}
		seen[item.Manifest.ID] = struct{}{}
		ids = append(ids, item.Manifest.ID)
	}
	return ids
}

func runtimePluginByID(items []PluginView, pluginID string) (PluginView, bool) {
	for _, item := range items {
		if item.Manifest.ID == pluginID {
			return item, true
		}
	}
	return PluginView{}, false
}

func (s *Service) PluginStatesForUser(actor *model.User) (map[string]PluginStateView, error) {
	items := s.Plugins()
	result := make(map[string]PluginStateView, len(items)+len(officialApplicationPolicies))
	for _, pluginID := range knownPluginIDs(items) {
		state, err := s.pluginStateForUser(actor, pluginID, items)
		if err != nil {
			return nil, err
		}
		result[pluginID] = state
	}
	return result, nil
}

func (s *Service) pluginStateForUser(actor *model.User, pluginID string, items []PluginView) (PluginStateView, error) {
	runtimePlugin, hasRuntime := runtimePluginByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	} else if _, known := officialApplicationPolicies[pluginID]; !known {
		return PluginStateView{}, fmt.Errorf("插件 %q 不存在", pluginID)
	}
	policy := pluginManagement(pluginID, source)
	platformAvailable := policy.Kind == PluginKindApplication
	if hasRuntime && (policy.ActivationScope == PluginScopeSystem || s.repo == nil) {
		platformAvailable = runtimePlugin.Status == "enabled"
	}
	if s.repo != nil {
		platformState, err := s.repo.PluginPlatformState(pluginID)
		if err != nil {
			return PluginStateView{}, fmt.Errorf("读取插件平台状态：%w", err)
		}
		if platformState != nil {
			platformAvailable = platformState.Available
		}
	}

	userEnabled := false
	userConfigured := false
	if policy.ActivationScope == PluginScopeUser && actor != nil {
		if s.repo != nil {
			userState, err := s.repo.UserPluginState(actor.ID, pluginID)
			if err != nil {
				return PluginStateView{}, fmt.Errorf("读取用户插件状态：%w", err)
			}
			if userState != nil {
				userEnabled, userConfigured = userState.Enabled, true
			}
		}
		// Preserve the old globally-enabled workflow behavior until each user
		// explicitly saves a personal choice. Other official applications were
		// already controlled by each user's local installation state.
		if !userConfigured && hasRuntime && isLegacyWorkflowPlugin(pluginID) {
			userEnabled = runtimePlugin.Status == "enabled"
		}
	}
	effective := platformAvailable
	if policy.ActivationScope == PluginScopeUser {
		effective = platformAvailable && userEnabled
	}
	state := PluginStateView{
		PluginID: pluginID, PlatformAvailable: platformAvailable,
		UserEnabled: userEnabled, UserConfigured: userConfigured,
		EffectiveEnabled: effective,
		CanToggle:        policy.ActivationScope == PluginScopeUser && platformAvailable,
		CanConfigure:     policy.ConfigurationScope == PluginConfigurationUser && platformAvailable,
	}
	if !platformAvailable {
		state.BlockedReason = "管理员已停用该插件"
	} else if policy.ActivationScope == PluginScopeSystem {
		state.BlockedReason = "系统插件由管理员统一管理"
	}
	return state, nil
}

func isLegacyWorkflowPlugin(pluginID string) bool {
	return pluginID == WorkflowPluginRunningHub || pluginID == WorkflowPluginComfyUI
}

func (s *Service) SetUserPluginEnabled(actor *model.User, pluginID string, enabled bool) (PluginStateView, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return PluginStateView{}, Forbidden("请先登录")
	}
	items := s.Plugins()
	current, err := s.pluginStateForUser(actor, pluginID, items)
	if err != nil {
		return PluginStateView{}, err
	}
	runtimePlugin, hasRuntime := runtimePluginByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	}
	if pluginManagement(pluginID, source).ActivationScope != PluginScopeUser {
		return PluginStateView{}, Forbidden("系统插件只能由管理员统一管理")
	}
	if !current.PlatformAvailable {
		return PluginStateView{}, Forbidden("管理员已停用该插件")
	}
	if s.repo == nil {
		return PluginStateView{}, fmt.Errorf("插件状态存储未初始化")
	}
	now := time.Now()
	state := &model.UserPluginState{ID: newID(), UserID: actor.ID, PluginID: pluginID, Enabled: enabled, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.SaveUserPluginState(state); err != nil {
		return PluginStateView{}, fmt.Errorf("保存用户插件状态：%w", err)
	}
	return s.pluginStateForUser(actor, pluginID, items)
}

func (s *Service) AdminPluginStates(actor *model.User) (map[string]AdminPluginStateView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	states, err := s.PluginStatesForUser(actor)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.EnabledPluginUserCounts()
	if err != nil {
		return nil, fmt.Errorf("统计插件启用用户数：%w", err)
	}
	result := make(map[string]AdminPluginStateView, len(states))
	for pluginID, state := range states {
		result[pluginID] = AdminPluginStateView{PluginStateView: state, EnabledUserCount: counts[pluginID]}
	}
	return result, nil
}

func (s *Service) SetPluginPlatformAvailability(actor *model.User, pluginID string, available bool) (AdminPluginStateView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return AdminPluginStateView{}, err
	}
	items := s.Plugins()
	runtimePlugin, hasRuntime := runtimePluginByID(items, pluginID)
	source := "bundled"
	if hasRuntime {
		source = runtimePlugin.Source
	} else if _, known := officialApplicationPolicies[pluginID]; !known {
		return AdminPluginStateView{}, fmt.Errorf("插件 %q 不存在", pluginID)
	}
	policy := pluginManagement(pluginID, source)
	previousRuntimeEnabled := false
	runtimeChanged := false
	if policy.ActivationScope == PluginScopeSystem {
		if !hasRuntime {
			return AdminPluginStateView{}, fmt.Errorf("插件 %q 缺少运行时", pluginID)
		}
		previousRuntimeEnabled = runtimePlugin.Status == "enabled"
		if _, err := s.SetPluginEnabled(pluginID, available); err != nil {
			return AdminPluginStateView{}, err
		}
		runtimeChanged = previousRuntimeEnabled != available
	}
	now := time.Now()
	platformState := &model.PluginPlatformState{PluginID: pluginID, Available: available, UpdatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.SavePluginPlatformState(platformState); err != nil {
		if runtimeChanged {
			_, _ = s.SetPluginEnabled(pluginID, previousRuntimeEnabled)
		}
		return AdminPluginStateView{}, fmt.Errorf("保存插件平台状态：%w", err)
	}
	if err := s.appendAdminAudit(actor, "plugin.availability.update", "plugin", pluginID, "更新插件平台可用状态", map[string]any{"available": available, "kind": policy.Kind, "origin": policy.Origin}); err != nil {
		return AdminPluginStateView{}, err
	}
	states, err := s.AdminPluginStates(actor)
	if err != nil {
		return AdminPluginStateView{}, err
	}
	return states[pluginID], nil
}

func (s *Service) RequirePluginForUser(userID string, pluginID string) error {
	state, err := s.pluginStateForUser(&model.User{ID: strings.TrimSpace(userID)}, pluginID, s.Plugins())
	if err != nil {
		return err
	}
	if !state.EffectiveEnabled {
		if state.BlockedReason != "" {
			return Forbidden(state.BlockedReason)
		}
		return Forbidden("插件未启用")
	}
	return nil
}
