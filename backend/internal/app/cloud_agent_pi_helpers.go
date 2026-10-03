package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"

	"infinite-canvas/backend/internal/model"
)

// Skills Configuration Builders

// buildSkillManifests 构建 Skills 清单（传递给 Pi）
func (s *Service) buildSkillManifests(skills []cloudAgentSkill) []map[string]any {
	if len(skills) == 0 {
		return []map[string]any{}
	}

	manifests := make([]map[string]any, 0, len(skills))
	for _, skill := range skills {
		manifest := map[string]any{
			"name":        skill.Name,
			"enabled":     true,
			"description": skill.Description,
			"version":     skill.Version,
			"hash":        skill.Hash,
			"instruction": skill.Instruction,
			"files":       skill.Files,
		}

		manifests = append(manifests, manifest)
	}

	return manifests
}

// Utility Functions

// hashContentSHA256 使用 SHA256 计算内容哈希
func hashContentSHA256(content string) string {
	hash := sha256.Sum256([]byte(content))
	return hex.EncodeToString(hash[:])
}

// truncateString 截断字符串
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// mergeMetadata 合并元数据
func mergeMetadata(base, override map[string]interface{}) map[string]interface{} {
	if base == nil {
		base = make(map[string]interface{})
	}
	if override == nil {
		return base
	}

	result := make(map[string]interface{})
	for k, v := range base {
		result[k] = v
	}
	for k, v := range override {
		result[k] = v
	}

	return result
}

// extractNodeIDs 从节点列表提取 ID
func extractNodeIDs(nodes []model.CanvasNode) []string {
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	return ids
}

// filterNodesByType 按类型过滤节点
func filterNodesByType(nodes []model.CanvasNode, nodeType string) []model.CanvasNode {
	filtered := make([]model.CanvasNode, 0)
	for _, node := range nodes {
		if node.Type == nodeType {
			filtered = append(filtered, node)
		}
	}
	return filtered
}

// findNodeByID 通过 ID 查找节点
func findNodeByID(nodes []model.CanvasNode, nodeID string) *model.CanvasNode {
	for _, node := range nodes {
		if node.ID == nodeID {
			return &node
		}
	}
	return nil
}

// Validation Functions

// validateNodeType 验证节点类型
func validateNodeType(nodeType string) bool {
	validTypes := map[string]bool{
		"text":      true,
		"markdown":  true,
		"code":      true,
		"image":     true,
		"video":     true,
		"audio":     true,
		"link":      true,
		"diagram":   true,
		"mindmap":   true,
		"flowchart": true,
		"task":      true,
		"note":      true,
	}
	return validTypes[nodeType]
}

// validateRelationshipType 验证关系类型
func validateRelationshipType(relType string) bool {
	validTypes := map[string]bool{
		"parent":     true,
		"reference":  true,
		"dependency": true,
		"flow":       true,
		"semantic":   true,
		"custom":     true,
	}
	return validTypes[relType]
}

// Format Functions

// formatBytes 格式化字节数
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// formatDuration 格式化时长
func formatDuration(ms int64) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	if ms < 60000 {
		return fmt.Sprintf("%.1fs", float64(ms)/1000)
	}
	return fmt.Sprintf("%.1fm", float64(ms)/60000)
}

// Debug and Logging Helpers

// logPiAgentStep 记录 Pi Agent 步骤
func logPiAgentStep(runID, step, message string) {
	slog.Debug("agent step", "run", runID, "step", step, "message", message)
}

// logPiAgentError 记录 Pi Agent 错误
func logPiAgentError(runID string, err error) {
	slog.Warn("agent error", "run", runID, "error", err)
}

// logPiAgentMetric 记录 Pi Agent 指标
func logPiAgentMetric(runID, metric string, value interface{}) {
	slog.Debug("agent metric", "run", runID, "metric", metric, "value", value)
}

// Type Conversions

// toStringSlice 转换为字符串切片
func toStringSlice(input interface{}) []string {
	if input == nil {
		return []string{}
	}

	switch v := input.(type) {
	case []string:
		return v
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	default:
		return []string{}
	}
}

// toMapStringAny 转换为 map[string]any
func toMapStringAny(input interface{}) map[string]any {
	if input == nil {
		return make(map[string]any)
	}

	if m, ok := input.(map[string]any); ok {
		return m
	}

	if m, ok := input.(map[string]interface{}); ok {
		return m
	}

	return make(map[string]any)
}

// Safe Accessors

// safeGetString 安全获取字符串
func safeGetString(m map[string]any, key string, defaultValue string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultValue
}

// safeGetInt 安全获取整数
func safeGetInt(m map[string]any, key string, defaultValue int) int {
	if v, ok := m[key].(int); ok {
		return v
	}
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return defaultValue
}

// safeGetBool 安全获取布尔值
func safeGetBool(m map[string]any, key string, defaultValue bool) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return defaultValue
}

// safeGetFloat 安全获取浮点数
func safeGetFloat(m map[string]any, key string, defaultValue float64) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	if v, ok := m[key].(int); ok {
		return float64(v)
	}
	return defaultValue
}
