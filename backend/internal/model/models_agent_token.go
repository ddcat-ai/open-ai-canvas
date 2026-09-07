package model

import "time"

// AgentToken 是 Agent Runtime（canvas-agent）访问影策生产 API 的服务凭据。
//
// 定位：**安全基础设施，不是业务事实源**（D-057A 裁决）。它不承载任何生产语义，
// 只回答"这个请求是谁、能碰哪些接口"。
//
// 安全约束（裁决硬要求）：
//   - 数据库只存 hash(token)，明文不落库，签发响应里只出现一次；
//   - 令牌绑定具体 user，不绑定角色，不给 admin scope；
//   - 与 x-canvas-agent-token（runtime 内部信任凭据）完全分离：不复用、不共享 scope、不互换用途；
//   - 支持 scope / expires_at / revoked_at / last_used_at。
type AgentToken struct {
	ID          string     `json:"id" gorm:"primaryKey;size:36"`
	UserID      string     `json:"userId" gorm:"index;size:36"`
	Name        string     `json:"name" gorm:"size:80"`
	TokenHash   string     `json:"-" gorm:"uniqueIndex;size:64"`
	TokenPrefix string     `json:"tokenPrefix" gorm:"index;size:16"`
	ScopesJSON  string     `json:"-" gorm:"column:scope_json;size:512"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	RevokedAt   *time.Time `json:"revokedAt"`
	LastUsedAt  *time.Time `json:"lastUsedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// TableName 固定表名，避免 gorm 复数化规则漂移。
func (AgentToken) TableName() string { return "agent_tokens" }
