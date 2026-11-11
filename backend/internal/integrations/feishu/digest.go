package feishuintegration

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// SummaryItem is the stable input to a daily feedback digest. The app layer
// maps its UserFeedback rows (or Feishu event rows) into this shape.
type SummaryItem struct {
	ID         string
	Type       string
	Title      string
	Content    string
	SenderName string
	ChatID     string
	CreatedAt  time.Time
}

// DayWindow returns the half-open local-time interval used by a daily digest.
// Converting the boundaries back to UTC before querying the database avoids
// DST and server-local-time assumptions.
func DayWindow(now time.Time, location *time.Location) (start, end time.Time) {
	if location == nil {
		location = time.UTC
	}
	local := now.In(location)
	start = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	return start, start.AddDate(0, 0, 1)
}

// DueAt reports whether a schedule should run in the current local minute.
// The durable scheduler must persist the date/window key; this helper only
// handles calendar arithmetic and intentionally does not claim a job.
func DueAt(now time.Time, location *time.Location, hour, minute int) bool {
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return false
	}
	local := now.In(locationOrUTC(location))
	return local.Hour() == hour && local.Minute() == minute
}

// BuildDigest creates deterministic Markdown-compatible plain text suitable
// for Feishu's text message API. Items are sorted by type, title and ID so
// retries produce the same body. Empty input is represented explicitly,
// making a successful no-feedback run observable to administrators.
func BuildDigest(day time.Time, items []SummaryItem) string {
	day = day.In(locationOrUTC(day.Location()))
	rows := append([]SummaryItem(nil), items...)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Type != rows[j].Type {
			return rows[i].Type < rows[j].Type
		}
		if rows[i].Title != rows[j].Title {
			return rows[i].Title < rows[j].Title
		}
		return rows[i].ID < rows[j].ID
	})

	var b strings.Builder
	fmt.Fprintf(&b, "飞书需求 / Bug 日报（%s）\n", day.Format("2006-01-02"))
	fmt.Fprintf(&b, "共 %d 条\n", len(rows))
	if len(rows) == 0 {
		b.WriteString("\n今天没有新的需求或 Bug。")
		return b.String()
	}
	currentType := ""
	for _, item := range rows {
		typeLabel := feedbackTypeLabel(item.Type)
		if typeLabel != currentType {
			if currentType != "" {
				b.WriteByte('\n')
			}
			currentType = typeLabel
			fmt.Fprintf(&b, "\n%s\n", typeLabel)
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "未命名反馈"
		}
		content := strings.TrimSpace(item.Content)
		if utf8.RuneCountInString(content) > 600 {
			content = string([]rune(content)[:600]) + "…"
		}
		sender := strings.TrimSpace(item.SenderName)
		if sender == "" {
			sender = "飞书用户"
		}
		fmt.Fprintf(&b, "- [%s] %s（%s）", typeLabel, title, sender)
		if content != "" {
			fmt.Fprintf(&b, "：%s", strings.ReplaceAll(content, "\n", " "))
		}
		if !item.CreatedAt.IsZero() {
			fmt.Fprintf(&b, " [%s]", item.CreatedAt.Format("15:04"))
		}
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}

// BuildMarkdownDigest is an explicit alias for callers that store the digest
// as Markdown before sending it through a rich-text channel. The current
// Feishu text transport accepts the same deterministic body.
func BuildMarkdownDigest(day time.Time, items []SummaryItem) string {
	return BuildDigest(day, items)
}

func feedbackTypeLabel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bug", "问题", "缺陷":
		return "Bug"
	case "feature", "需求", "功能":
		return "需求"
	case "improvement", "改进", "优化":
		return "改进"
	default:
		return "其他"
	}
}

func locationOrUTC(location *time.Location) *time.Location {
	if location == nil {
		return time.UTC
	}
	return location
}
