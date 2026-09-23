package app

// minimax-t2a 画布插件在插件中心的登记。
//
// 设计意图：官方 `plugin_management.go` 的 `officialApplicationPolicies` 是包级 map，
// 这里用 init() 注入，官方文件不需为插件增加任何条目。
// 未登记时插件会被判为「不存在」，`RequirePluginForUser` 直接拒绝（表现为插件中心灰、接口 403）。
//
// minimax-t2a 是**随包发布的纯前端应用插件**：无后端运行时，属画布常驻能力，
// 因此作用域为 system（默认启用，不提供用户启停）。system 作用域下 CanToggle=false，
// 管理端不会出现切换按钮，也就不会走到官方「系统插件缺少运行时」的报错分支。
func init() {
	if _, exists := officialApplicationPolicies["minimax-t2a"]; exists {
		return
	}
	officialApplicationPolicies["minimax-t2a"] = PluginManagementView{
		Origin:             PluginOriginOfficial,
		Kind:               PluginKindApplication,
		ActivationScope:    PluginScopeSystem,
		ConfigurationScope: PluginConfigurationNone,
	}
}
