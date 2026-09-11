package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// NewID 生成唯一标识符。
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// FirstNonEmpty 返回第一个非空字符串。
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// UniqueNonEmpty 去重并过滤空字符串。
func UniqueNonEmpty(values []string) []string {
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

// DefaultString 返回非空值或回退值。
func DefaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// Ptr 返回值的指针。
func Ptr[T any](value T) *T {
	return &value
}

// StringValue 从任意值提取字符串。
func StringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprintf("%v", value)
}

// TruncateRunes 截断字符串到指定 rune 数。
func TruncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

// Megabytes 转换 MB 到字节。
func Megabytes(value int64) int64 { return value << 20 }

// Gigabytes 转换 GB 到字节。
func Gigabytes(value int64) int64 { return value << 30 }
