package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	promptCustomizationInherit = "inherit"
	promptCustomizationAppend  = "append"
	promptCustomizationRewrite = "rewrite"
)

var promptPlaceholderPattern = regexp.MustCompile(`\{\{[^{}]+\}\}`)

type PromptTemplateVariable struct {
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
}

type PromptOperationDefinition struct {
	Operation     string                   `json:"operation"`
	Label         string                   `json:"label"`
	Category      string                   `json:"category"`
	Description   string                   `json:"description"`
	OutputType    string                   `json:"outputType"`
	SchemaKey     string                   `json:"schemaKey,omitempty"`
	Variables     []PromptTemplateVariable `json:"variables"`
	OutputContract string                 `json:"outputContract"`
	DefaultContent string                 `json:"-"`
}

type PromptTemplateRequest struct {
	Operation string `json:"operation"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	Enabled   *bool  `json:"enabled"`
}

type UserPromptCustomizationRequest struct {
	Mode    string `json:"mode"`
	Content string `json:"content"`
}

type UserPromptPreference struct {
	Definition    PromptOperationDefinition       `json:"definition"`
	Template      *model.PromptTemplate           `json:"template"`
	Customization *model.UserPromptCustomization `json:"customization,omitempty"`
	Outdated      bool                            `json:"outdated"`
}

type CompiledPrompt struct {
	Content              string
	TemplateID           string
	TemplateVersion      int
	CustomizationID      string
	CustomizationUpdated string
}

func promptDefinitions() []PromptOperationDefinition {
	definitions := defaultPromptDefinitions()
	for index := range definitions {
		definitions[index].OutputContract = promptOutputContract(definitions[index].Operation)
	}
	return definitions
}

func promptDefinition(operation string) (PromptOperationDefinition, bool) {
	for _, definition := range promptDefinitions() {
		if definition.Operation == operation {
			return definition, true
		}
	}
	return PromptOperationDefinition{}, false
}

func (s *Service) EnsureDefaultPromptTemplates() error {
	for _, definition := range promptDefinitions() {
		count, err := s.repo.PromptTemplateCount(definition.Operation)
		if err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := s.repo.SavePromptTemplate(&model.PromptTemplate{
			ID: newID(), Operation: definition.Operation, Name: "默认" + definition.Label + "模板", Version: 1,
			Content: definition.DefaultContent, OutputType: definition.OutputType, Enabled: true,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) AdminPromptTemplates(actor *model.User) ([]model.PromptTemplate, []PromptOperationDefinition, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, nil, err
	}
	templates, err := s.repo.PromptTemplates()
	if err != nil {
		return nil, nil, err
	}
	return templates, promptDefinitions(), nil
}

func (s *Service) CreatePromptTemplate(actor *model.User, req PromptTemplateRequest) (*model.PromptTemplate, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	definition, ok := promptDefinition(strings.TrimSpace(req.Operation))
	if !ok {
		return nil, BadAuthRequest("不支持的提示词模板类型")
	}
	name, content, err := validatePromptTemplateContent(definition, req.Name, req.Content)
	if err != nil {
		return nil, err
	}
	version, err := s.repo.NextPromptTemplateVersion(definition.Operation)
	if err != nil {
		return nil, err
	}
	template := &model.PromptTemplate{
		ID: newID(), Operation: definition.Operation, Name: name, Version: version, Content: content,
		OutputType: definition.OutputType, Enabled: req.Enabled != nil && *req.Enabled, CreatedBy: actor.ID,
	}
	if err := s.repo.SavePromptTemplate(template); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "prompt_template.create", "prompt_template", template.ID, "创建提示词模板版本", map[string]any{"operation": template.Operation, "version": template.Version, "enabled": template.Enabled}); err != nil {
		return nil, err
	}
	return template, nil
}

func (s *Service) UpdatePromptTemplate(actor *model.User, id string, req PromptTemplateRequest) (*model.PromptTemplate, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	template, err := s.repo.PromptTemplate(id)
	if err != nil {
		return nil, err
	}
	definition, ok := promptDefinition(template.Operation)
	if !ok {
		return nil, BadAuthRequest("提示词模板类型已经失效")
	}
	if template.Enabled && (strings.TrimSpace(req.Content) != strings.TrimSpace(template.Content) || strings.TrimSpace(req.Name) != template.Name) {
		return nil, BadAuthRequest("启用中的版本不可直接修改，请基于它新建版本")
	}
	if req.Enabled != nil && !*req.Enabled && template.Enabled {
		return nil, BadAuthRequest("启用中的版本不能直接停用，请先启用同类型的其他版本")
	}
	name, content, err := validatePromptTemplateContent(definition, req.Name, req.Content)
	if err != nil {
		return nil, err
	}
	template.Name = name
	template.Content = content
	if req.Enabled != nil {
		template.Enabled = *req.Enabled
	}
	if err := s.repo.SavePromptTemplate(template); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "prompt_template.update", "prompt_template", template.ID, "更新提示词模板版本", map[string]any{"operation": template.Operation, "version": template.Version, "enabled": template.Enabled}); err != nil {
		return nil, err
	}
	return template, nil
}

func (s *Service) DeletePromptTemplate(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	template, err := s.repo.PromptTemplate(id)
	if err != nil {
		return err
	}
	if template.Enabled {
		return BadAuthRequest("启用中的版本不能删除，请先启用同类型的其他版本")
	}
	if err := s.repo.DeletePromptTemplate(id); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "prompt_template.delete", "prompt_template", template.ID, "删除提示词模板版本", map[string]any{"operation": template.Operation, "version": template.Version})
}

func (s *Service) UserPromptPreferences(user *model.User) ([]UserPromptPreference, error) {
	if user == nil || user.ID == "" {
		return nil, BadAuthRequest("请先登录")
	}
	customizations, err := s.repo.UserPromptCustomizations(user.ID)
	if err != nil {
		return nil, err
	}
	customizationByOperation := make(map[string]*model.UserPromptCustomization, len(customizations))
	for index := range customizations {
		customization := &customizations[index]
		customizationByOperation[customization.Operation] = customization
	}
	preferences := make([]UserPromptPreference, 0)
	for _, definition := range promptDefinitions() {
		template, err := s.repo.ActivePromptTemplate(definition.Operation)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		customization := customizationByOperation[definition.Operation]
		preference := UserPromptPreference{Definition: definition, Template: template, Customization: customization}
		preference.Outdated = customization != nil && customization.Mode == promptCustomizationRewrite && template != nil && customization.BaseTemplateID != template.ID
		preferences = append(preferences, preference)
	}
	return preferences, nil
}

func (s *Service) UpdateUserPromptCustomization(user *model.User, operation string, req UserPromptCustomizationRequest) (*model.UserPromptCustomization, error) {
	if user == nil || user.ID == "" {
		return nil, BadAuthRequest("请先登录")
	}
	definition, ok := promptDefinition(strings.TrimSpace(operation))
	if !ok {
		return nil, BadAuthRequest("不支持的提示词模板类型")
	}
	mode := strings.TrimSpace(req.Mode)
	if mode != promptCustomizationInherit && mode != promptCustomizationAppend && mode != promptCustomizationRewrite {
		return nil, BadAuthRequest("不支持的提示词定制方式")
	}
	content := strings.TrimSpace(req.Content)
	if mode == promptCustomizationInherit {
		content = ""
	}
	if mode != promptCustomizationInherit && content == "" {
		return nil, BadAuthRequest("请填写个人提示词要求")
	}
	if len([]rune(content)) > 12_000 {
		return nil, BadAuthRequest("个人提示词最多 12000 个字符")
	}
	if err := validatePromptPlaceholders(definition, content); err != nil {
		return nil, err
	}
	active, err := s.repo.ActivePromptTemplate(definition.Operation)
	if err != nil {
		return nil, errors.New("当前模板类型没有启用版本")
	}
	customization, err := s.repo.UserPromptCustomization(user.ID, definition.Operation)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		customization = &model.UserPromptCustomization{ID: newID(), UserID: user.ID, Operation: definition.Operation}
	} else if err != nil {
		return nil, err
	}
	customization.Mode = mode
	customization.Content = content
	customization.BaseTemplateID = active.ID
	if err := s.repo.SaveUserPromptCustomization(customization); err != nil {
		return nil, err
	}
	return customization, nil
}

func (s *Service) ResetUserPromptCustomization(user *model.User, operation string) error {
	if user == nil || user.ID == "" {
		return BadAuthRequest("请先登录")
	}
	if _, ok := promptDefinition(strings.TrimSpace(operation)); !ok {
		return BadAuthRequest("不支持的提示词模板类型")
	}
	return s.repo.DeleteUserPromptCustomization(user.ID, operation)
}

func (s *Service) compilePrompt(userID string, operation string, values map[string]string) (CompiledPrompt, error) {
	definition, ok := promptDefinition(operation)
	if !ok {
		return CompiledPrompt{}, fmt.Errorf("不支持的提示词模板类型：%s", operation)
	}
	template, err := s.repo.ActivePromptTemplate(operation)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		template = &model.PromptTemplate{Operation: operation, Name: "内置默认", Version: 1, Content: definition.DefaultContent, OutputType: definition.OutputType}
	} else if err != nil {
		return CompiledPrompt{}, err
	}
	creative := template.Content
	compiled := CompiledPrompt{TemplateID: template.ID, TemplateVersion: template.Version}
	customization, customizationErr := s.repo.UserPromptCustomization(userID, operation)
	if customizationErr == nil {
		compiled.CustomizationID = customization.ID
		compiled.CustomizationUpdated = customization.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
		switch customization.Mode {
		case promptCustomizationAppend:
			creative += "\n\n【用户个性化创作要求】\n" + customization.Content
		case promptCustomizationRewrite:
			creative = customization.Content
		}
	} else if !errors.Is(customizationErr, gorm.ErrRecordNotFound) {
		return CompiledPrompt{}, customizationErr
	}
	rendered, err := renderPromptTemplate(definition, creative, values)
	if err != nil {
		return CompiledPrompt{}, err
	}
	parts := []string{strings.TrimSpace(rendered)}
	if protected := strings.TrimSpace(protectedPromptContext(operation, values)); protected != "" {
		parts = append(parts, protected)
	}
	compiled.Content = strings.Join(parts, "\n\n")
	return compiled, nil
}

func validatePromptTemplateContent(definition PromptOperationDefinition, name string, content string) (string, string, error) {
	name = strings.TrimSpace(name)
	content = strings.TrimSpace(content)
	if name == "" {
		return "", "", BadAuthRequest("请填写版本名称")
	}
	if content == "" {
		return "", "", BadAuthRequest("请填写提示词模板")
	}
	if len([]rune(content)) > 30_000 {
		return "", "", BadAuthRequest("提示词模板最多 30000 个字符")
	}
	if err := validatePromptPlaceholders(definition, content); err != nil {
		return "", "", err
	}
	return name, content, nil
}

func validatePromptPlaceholders(definition PromptOperationDefinition, content string) error {
	allowed := make(map[string]bool, len(definition.Variables))
	for _, variable := range definition.Variables {
		allowed[variable.Placeholder] = true
	}
	unknown := make([]string, 0)
	for _, placeholder := range promptPlaceholderPattern.FindAllString(content, -1) {
		if !allowed[placeholder] {
			unknown = append(unknown, placeholder)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return BadAuthRequest("模板包含不支持的变量：" + strings.Join(uniqueStrings(unknown), "、"))
}

func renderPromptTemplate(definition PromptOperationDefinition, content string, values map[string]string) (string, error) {
	if err := validatePromptPlaceholders(definition, content); err != nil {
		return "", err
	}
	rendered := content
	for _, variable := range definition.Variables {
		key := strings.TrimSuffix(strings.TrimPrefix(variable.Placeholder, "{{"), "}}")
		rendered = strings.ReplaceAll(rendered, variable.Placeholder, strings.TrimSpace(values[key]))
	}
	return strings.TrimSpace(rendered), nil
}

func validatePromptTemplateResult(operation string, result map[string]interface{}) error {
	definition, ok := promptDefinition(operation)
	if !ok || definition.OutputType != "json" {
		return nil
	}
	text, _ := result["text"].(string)
	jsonText, err := extractJSONText(text)
	if err != nil {
		return fmt.Errorf("%s 返回内容不符合受保护 JSON 契约：%w", definition.Label, err)
	}
	if operation != promptOperationCharacterExtract {
		return nil
	}
	var payload struct {
		Characters *[]map[string]interface{} `json:"characters"`
	}
	if err := json.Unmarshal([]byte(jsonText), &payload); err != nil {
		return fmt.Errorf("角色卡提取返回的 JSON 无法解析：%w", err)
	}
	required := []string{"name", "aliases", "role", "appearance", "clothing", "physique", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"}
	if payload.Characters == nil {
		return errors.New("角色卡提取结果缺少 characters 数组")
	}
	for index, character := range *payload.Characters {
		for _, field := range required {
			if _, exists := character[field]; !exists {
				return fmt.Errorf("角色卡提取结果中第 %d 个角色缺少字段 %s", index+1, field)
			}
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if len(result) == 0 || result[len(result)-1] != value {
			result = append(result, value)
		}
	}
	return result
}
