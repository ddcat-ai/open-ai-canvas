package app

import (
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
)

type (
	PromptTemplateVariable         = prompts.PromptTemplateVariable
	PromptOperationDefinition      = prompts.PromptOperationDefinition
	PromptTemplateRequest          = prompts.PromptTemplateRequest
	UserPromptCustomizationRequest = prompts.UserPromptCustomizationRequest
	UserPromptPreference           = prompts.UserPromptPreference
	CompiledPrompt                 = prompts.CompiledPrompt
	StyleProfileRequest            = prompts.StyleProfileRequest
	StyleProfileFavoriteRequest    = prompts.StyleProfileFavoriteRequest
)

const (
	promptOperationStoryboardPlan       = prompts.OperationStoryboardPlan
	promptOperationStoryboardRepair     = prompts.OperationStoryboardRepair
	promptOperationStoryboardFirstFrame = prompts.OperationStoryboardFirstFrame
	promptOperationStoryboardVideo      = prompts.OperationStoryboardVideo
	promptOperationCharacterExtract     = prompts.OperationCharacterExtract
	promptOperationChapterAssetsExtract = prompts.OperationChapterAssetsExtract
	promptOperationCharacterTurnaround  = prompts.OperationCharacterTurnaround
	promptOperationShortDramaOutline    = prompts.OperationShortDramaOutline
	promptOperationSkillDraft           = prompts.OperationSkillDraft
)

type promptAdminGate struct {
	svc *Service
}

func (g promptAdminGate) RequireAdmin(user *model.User) error {
	if g.svc == nil {
		return nil
	}
	return g.svc.RequireAdmin(user)
}

func (g promptAdminGate) AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if g.svc == nil {
		return nil
	}
	return g.svc.appendAdminAudit(actor, action, targetType, targetID, summary, metadata)
}

func (s *Service) promptDomain() *prompts.Service {
	if s == nil {
		return prompts.New(nil, nil)
	}
	if s.prompts != nil {
		return s.prompts
	}
	return prompts.New(s.repo, promptAdminGate{svc: s})
}

func (s *Service) ListStyleProfiles(userID string) ([]model.StyleProfile, error) {
	return s.promptDomain().ListStyleProfiles(userID)
}

func (s *Service) CreateStyleProfile(userID string, req StyleProfileRequest) (model.StyleProfile, error) {
	return s.promptDomain().CreateStyleProfile(userID, req)
}

func (s *Service) UpdateStyleProfile(userID string, id string, req StyleProfileRequest) (model.StyleProfile, error) {
	return s.promptDomain().UpdateStyleProfile(userID, id, req)
}

func (s *Service) SetStyleProfileFavorite(userID string, id string, favorite bool) error {
	return s.promptDomain().SetStyleProfileFavorite(userID, id, favorite)
}

func (s *Service) TouchStyleProfile(userID string, id string) error {
	return s.promptDomain().TouchStyleProfile(userID, id)
}

func (s *Service) DeleteStyleProfile(userID string, id string) error {
	return s.promptDomain().DeleteStyleProfile(userID, id)
}

func (s *Service) EnsureDefaultPromptTemplates() error {
	return s.promptDomain().EnsureDefaultPromptTemplates()
}

func (s *Service) AdminPromptTemplates(actor *model.User) ([]model.PromptTemplate, []PromptOperationDefinition, error) {
	return s.promptDomain().AdminPromptTemplates(actor)
}

func (s *Service) CreatePromptTemplate(actor *model.User, req PromptTemplateRequest) (*model.PromptTemplate, error) {
	return s.promptDomain().CreatePromptTemplate(actor, req)
}

func (s *Service) UpdatePromptTemplate(actor *model.User, id string, req PromptTemplateRequest) (*model.PromptTemplate, error) {
	return s.promptDomain().UpdatePromptTemplate(actor, id, req)
}

func (s *Service) DeletePromptTemplate(actor *model.User, id string) error {
	return s.promptDomain().DeletePromptTemplate(actor, id)
}

func (s *Service) UserPromptPreferences(user *model.User) ([]UserPromptPreference, error) {
	return s.promptDomain().UserPromptPreferences(user)
}

func (s *Service) UpdateUserPromptCustomization(user *model.User, operation string, req UserPromptCustomizationRequest) (*model.UserPromptCustomization, error) {
	return s.promptDomain().UpdateUserPromptCustomization(user, operation, req)
}

func (s *Service) ResetUserPromptCustomization(user *model.User, operation string) error {
	return s.promptDomain().ResetUserPromptCustomization(user, operation)
}

func (s *Service) compilePrompt(userID string, operation string, values map[string]string) (CompiledPrompt, error) {
	return s.promptDomain().CompilePrompt(userID, operation, values)
}

func validateStyleProfileJSON(value string) (string, error) {
	return prompts.ValidateStyleProfileJSON(value)
}

func extractJSONText(raw string) (string, error) {
	return prompts.ExtractJSONText(raw)
}

func extractPreferredJSONText(raw string, preferKey string) (string, error) {
	return prompts.ExtractPreferredJSONText(raw, preferKey)
}

func promptDefinition(operation string) (PromptOperationDefinition, bool) {
	return prompts.PromptDefinition(operation)
}

func renderPromptTemplate(definition PromptOperationDefinition, content string, values map[string]string) (string, error) {
	return prompts.RenderPromptTemplate(definition, content, values)
}

func validatePromptTemplateResult(operation string, result map[string]interface{}) error {
	return prompts.ValidatePromptTemplateResult(operation, result)
}

func validateStyleProfilePreset(presetID string, profileJSON string) error {
	return prompts.ValidateStyleProfilePreset(presetID, profileJSON)
}

func nonEmptyStyleProfileStrings(values []string) []string {
	return prompts.NonEmptyStyleProfileStrings(values)
}

type styleProfileDocument = prompts.StyleProfileDocument
type styleProfileAsset = prompts.StyleProfileAsset

func storyboardExecutionContract(durationRule string, countRule string) string {
	return prompts.StoryboardExecutionContract(durationRule, countRule)
}
