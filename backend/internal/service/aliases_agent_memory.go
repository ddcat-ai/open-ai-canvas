package service

import "yingce/backend/internal/app"

// 长期记忆文件与技能推荐的 HTTP 入参/出参。
type AgentMemoryDocumentView = app.AgentMemoryDocumentView
type AgentMemoryDocumentAdminView = app.AgentMemoryDocumentAdminView
type AgentMemoryDocRevisionView = app.AgentMemoryDocRevisionView
type AgentMemoryDocChange = app.AgentMemoryDocChange
type AgentMemoryEntryInput = app.AgentMemoryEntryInput
type AgentMemoryDocUpdateRequest = app.AgentMemoryDocUpdateRequest
type AgentMemoryDocSettingsRequest = app.AgentMemoryDocSettingsRequest
type AgentMemoryDocDecisionRequest = app.AgentMemoryDocDecisionRequest

type SkillRecommendationList = app.SkillRecommendationList
type SkillRecommendationIndustry = app.SkillRecommendationIndustry
type SkillRecommendationItem = app.SkillRecommendationItem
type SkillRecommendationInstallRequest = app.SkillRecommendationInstallRequest
type SkillRecommendationInstallResult = app.SkillRecommendationInstallResult
