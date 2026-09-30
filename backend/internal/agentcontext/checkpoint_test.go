package agentcontext

import (
	"strings"
	"testing"
)

func TestCheckpointRoundTripPreservesPlanningFields(t *testing.T) {
	raw := `{"version":1,"historySummary":"用户要继续第三幕","scriptDesign":"主角在雨夜车站发现循环线索，下一场保持蓝色冷调和左手伤口连续性","operationHistory":["创建分镜节点 storyboard-1"],"pendingTasks":["task-1 仍在运行，先查询"],"currentWork":"第三幕转折镜头","nextStep":"补齐镜头 7 的对白","decisions":["采用非线性叙事"],"constraints":["不能更换主角外观"],"userPreferences":["对白克制"],"compactedTurnCount":8}`
	checkpoint, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	framed, err := Frame(checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	for _, fact := range []string{"雨夜车站", "task-1", "非线性叙事", "对白克制"} {
		if !strings.Contains(framed, fact) {
			t.Fatalf("checkpoint lost %q: %s", fact, framed)
		}
	}
	// 信封必须能被原样解回来，否则压缩完的历史在下一轮就不可读。
	parsed, err := ParseFrame(framed)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.CompactedTurnCount != 8 || parsed.HistorySummary != "用户要继续第三幕" {
		t.Fatalf("frame round trip = %+v", parsed)
	}
}

// 未知字段（尤其是权限字段）必须被拒绝：压缩模型不能借"摘要"扩大授权。
func TestCheckpointRejectsUnknownFields(t *testing.T) {
	_, err := Parse(`{"version":1,"historySummary":"","scriptDesign":"","operationHistory":[],"pendingTasks":[],"currentWork":"","nextStep":"","decisions":[],"constraints":[],"userPreferences":[],"compactedTurnCount":1,"authorization":"auto"}`)
	if err == nil {
		t.Fatal("unknown checkpoint field accepted")
	}
}

func TestCheckpointRejectsBrokenFrames(t *testing.T) {
	if _, err := Parse(`{"version":2,"historySummary":"","scriptDesign":"","operationHistory":[],"pendingTasks":[],"currentWork":"","nextStep":"","decisions":[],"constraints":[],"userPreferences":[],"compactedTurnCount":0}`); err == nil {
		t.Fatal("版本不匹配的检查点被接受")
	}
	if _, err := ParseFrame(`{"version":1,"compactedTurnCount":0}`); err == nil {
		t.Fatal("没有信封的检查点被接受")
	}
	if _, err := Parse(`{"version":1,"compactedTurnCount":0} {}`); err == nil {
		t.Fatal("带尾巴的检查点被接受")
	}
}

// 兜底判据的阈值由调用方传入：条数与字节任一到线即压缩，两个阈值都必须生效。
func TestShouldCompactUsesHistoryAndSizeBudgets(t *testing.T) {
	const maxMessages, maxBytes = 20, 64_000
	if ShouldCompact(maxMessages-1, maxBytes-1, maxMessages, maxBytes) {
		t.Fatal("small history compacted")
	}
	if !ShouldCompact(maxMessages, 1, maxMessages, maxBytes) || !ShouldCompact(1, maxBytes, maxMessages, maxBytes) {
		t.Fatal("threshold did not trigger compaction")
	}
	// 没有阈值（渠道没配能力时上层也不会传 0）时不能误触发。
	if ShouldCompact(1_000, 1<<20, 0, 0) {
		t.Fatal("未配置阈值时不应触发压缩")
	}
}
