package app

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 这组用例钉死一条上游请求合同：assistant 消息声明的**每一个** tool_call_id，
// 都必须在紧随其后的连续 tool 消息里被回应。
//
// 背景（真实复现，2026-09-19 3001 环境）：DeepSeek（严格 OpenAI 兼容）上，模型一轮里
// 一次发起 4 个 canvas_inspect_image 调用。旧实现每看完一张图就先 append tool 回执、
// 紧接着 append 一条 user 图片消息，历史于是变成
//
//	assistant(tool_calls×4)
//	  → tool(call_00) → user(image)
//	  → tool(call_01) → user(image)
//	  → ...
//
// 下一个请求被上游 400 拒绝：
//
//	An assistant message with 'tool_calls' must be followed by tool messages
//	responding to each 'tool_call_id'. (insufficient tool messages following
//	tool_calls message)
//
// 修法：图片先缓冲，等整批 tool 结果都入历史后合并成**一条** user 消息。

// cloudAgentToolPairingViolation 检查一条消息序列是否满足上游的请求合同，返回第一条违约
// 的可读描述（"" = 满足）。
//
// 合同：每个含 tool_calls 的 assistant 消息，其声明的**每一个** tool_call_id 都必须在
// "下一条非 tool 消息之前"的连续 tool 消息里按声明顺序出现。
func cloudAgentToolPairingViolation(messages []map[string]any) string {
	for index, message := range messages {
		if stringField(message, "role") != "assistant" {
			continue
		}
		declared := make([]string, 0, 4)
		for _, call := range canonicalAgentToolCalls(message["tool_calls"]) {
			if id := stringValue(call["id"]); id != "" {
				declared = append(declared, id)
			}
		}
		if len(declared) == 0 {
			continue
		}
		answered := make([]string, 0, len(declared))
		for _, follow := range messages[index+1:] {
			// 第一条非 tool 消息就是边界：消息之后被插了任何别的东西都算违约，
			// 这正是 user 图片消息插在 tool 结果之间时被上游拒掉的形态。
			if stringField(follow, "role") != "tool" {
				break
			}
			if id := stringField(follow, "tool_call_id"); id != "" {
				answered = append(answered, id)
			}
		}
		if len(answered) < len(declared) {
			return "assistant#" + strconv.Itoa(index) + " declared " + strings.Join(declared, ",") +
				" but only " + strconv.Itoa(len(answered)) + " tool messages follow before the next non-tool message: " +
				strings.Join(answered, ",")
		}
		for position, id := range declared {
			if answered[position] != id {
				return "assistant#" + strconv.Itoa(index) + " tool results are out of order: declared " +
					strings.Join(declared, ",") + ", answered " + strings.Join(answered, ",")
			}
		}
	}
	return ""
}

// assertCloudAgentToolCallPairing 是不可变式断言，用在每条看图路径的用例里。
func assertCloudAgentToolCallPairing(t *testing.T, messages []map[string]any) {
	t.Helper()
	if violation := cloudAgentToolPairingViolation(messages); violation != "" {
		t.Fatalf("%s%s", violation, cloudAgentDebugMessages(messages))
	}
}

// 反例自检：不变式断言必须真能抓住修复前的消息顺序，否则它只是个空断言。
func TestCloudAgentToolPairingInvariantCatchesInterleavedImages(t *testing.T) {
	const batch = 4
	declared := make([]any, 0, batch)
	inspections := make([]cloudAgentImageInspection, 0, batch)
	nodes := make([]string, 0, batch)
	for index := 0; index < batch; index++ {
		id := "call-" + strconv.Itoa(index)
		declared = append(declared, map[string]any{"id": id, "type": "function", "function": map[string]any{"name": "canvas_inspect_image", "arguments": `{}`}})
		node := "image-" + strconv.Itoa(index)
		nodes = append(nodes, node)
		inspections = append(inspections, cloudAgentPairingInspection(node, "https://example.test/"+node))
	}
	assistant := map[string]any{"role": "assistant", "content": "", "tool_calls": declared}

	// 修复前：每看完一张图立刻 append 一条 user 图片消息，于是插在了后续 tool 结果之前
	// —— assistant(tool_calls×4) 之后只有 1 条 tool 消息就碰到了 user，上游 400
	// insufficient tool messages following tool_calls message。
	buggy := []map[string]any{{"role": "user", "content": "看这四张图"}, assistant}
	for index := 0; index < batch; index++ {
		buggy = append(buggy,
			map[string]any{"role": "tool", "tool_call_id": "call-" + strconv.Itoa(index), "content": `{"nodeId":"` + nodes[index] + `"}`},
			map[string]any{"role": "user", "content": cloudAgentImageContentParts(inspections[index])},
		)
	}
	if violation := cloudAgentToolPairingViolation(buggy); violation == "" {
		t.Fatal("invariant check is vacuous: it accepted the buggy interleaved ordering")
	}

	// 修复后：四条 tool 结果连续排开，四张图合并成一条 user 消息放最后。
	fixed := []map[string]any{{"role": "user", "content": "看这四张图"}, assistant}
	for index := 0; index < batch; index++ {
		fixed = append(fixed, map[string]any{"role": "tool", "tool_call_id": "call-" + strconv.Itoa(index), "content": `{"nodeId":"` + nodes[index] + `"}`})
	}
	fixed = append(fixed, map[string]any{"role": "user", "content": cloudAgentImageContentParts(inspections...)})
	if violation := cloudAgentToolPairingViolation(fixed); violation != "" {
		t.Fatalf("invariant rejected the fixed ordering: %s", violation)
	}
	if got := cloudAgentMessageImagePartCount(fixed[len(fixed)-1]); got != batch {
		t.Fatalf("fixed ordering must carry all %d images in one message, got %d", batch, got)
	}
}

// assertNoImageMessageBeforeToolResult 断言带图片的消息后面不再紧跟 tool 消息：
// 那正是"图片插在工具结果之间"的形态（旧实现：tool → user(图) → tool → …）。
// 与上面的不变式互补：前者管 tool_call_id 的连续性，这条直接咬住图片的位置。
func assertNoImageMessageBeforeToolResult(t *testing.T, messages []map[string]any) {
	t.Helper()
	for index, message := range messages {
		if cloudAgentMessageImagePartCount(message) == 0 || index+1 >= len(messages) {
			continue
		}
		if stringField(messages[index+1], "role") == "tool" {
			t.Fatalf("图片消息 #%d 后面还跟着 tool 结果：图片必须落在整批 tool 结果之后%s", index, cloudAgentDebugMessages(messages))
		}
	}
}

// cloudAgentImageMessageIndexes 返回所有带 image_url 的 user 消息下标。
func cloudAgentImageMessageIndexes(messages []map[string]any) []int {
	indexes := make([]int, 0, 2)
	for index, message := range messages {
		if cloudAgentMessageImagePartCount(message) > 0 {
			indexes = append(indexes, index)
		}
	}
	return indexes
}

// cloudAgentMessageImagePartCount 数一条消息里有几个图片部件。
func cloudAgentMessageImagePartCount(message map[string]any) int {
	parts, ok := message["content"].([]any)
	if !ok {
		return 0
	}
	count := 0
	for _, value := range parts {
		part, _ := value.(map[string]any)
		if stringField(part, "type") == "image_url" {
			count++
		}
	}
	return count
}

func cloudAgentDebugMessages(messages []map[string]any) string {
	var builder strings.Builder
	for index, message := range messages {
		parts, _ := message["content"].([]any)
		builder.WriteString("\n  #")
		builder.WriteString(strconv.Itoa(index))
		builder.WriteString(" role=")
		builder.WriteString(stringField(message, "role"))
		builder.WriteString(" toolCallId=")
		builder.WriteString(stringField(message, "tool_call_id"))
		if len(parts) > 0 {
			kinds := make([]string, 0, len(parts))
			for _, value := range parts {
				part, _ := value.(map[string]any)
				kinds = append(kinds, stringField(part, "type"))
			}
			builder.WriteString(" parts=")
			builder.WriteString(strings.Join(kinds, "+"))
		}
	}
	return builder.String()
}

// cloudAgentPairingCall 造一个工具调用。
func cloudAgentPairingCall(id, name, arguments string) cloudAgentCall {
	var call cloudAgentCall
	call.ID = id
	call.Function.Name = name
	call.Function.Arguments = arguments
	return call
}

// cloudAgentPairingState 造一个"一批调用刚开始执行"的运行时状态：
// canonical 里只有那条声明了全部调用的 assistant 消息。
func cloudAgentPairingState(calls ...cloudAgentCall) *cloudAgentRuntime {
	state := &cloudAgentRuntime{}
	state.Calls = calls
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "content": "", "tool_calls": calls})
	return state
}

// cloudAgentPairingAssistantMessage 造一条声明了单个工具调用的 assistant 消息。
func cloudAgentPairingAssistantMessage(id string) map[string]any {
	return map[string]any{"role": "assistant", "content": "", "tool_calls": []any{
		map[string]any{"id": id, "type": "function", "function": map[string]any{"name": "canvas_get_state", "arguments": `{}`}},
	}}
}

func cloudAgentPairingInspection(nodeID, url string) cloudAgentImageInspection {
	return cloudAgentImageInspection{
		Receipt:  map[string]any{"nodeId": nodeID, "mimeType": "image/png", "title": nodeID},
		ImageURL: url,
	}
}

// runCloudAgentBatch 复刻 runtime 执行一批调用的两条路径：
//  1. 逐个调用走 cloudAgentToolResult（本批最后一个调用是看图时，它会立刻 flush）；
//  2. 整批结束、开始组装 canonical 之前走 advanceCloudAgent 里的兜底 flush（幂等）。
//
// results 按 call.ID 给结果；error 类型的结果表示该调用以错误收场。
func runCloudAgentBatch(t *testing.T, state *cloudAgentRuntime, results map[string]any) {
	t.Helper()
	for _, call := range state.Calls {
		result, ok := results[call.ID]
		if !ok {
			result = map[string]any{"ok": true}
		}
		if err, isError := result.(error); isError {
			cloudAgentToolResult("run-1", state, call, nil, err)
			continue
		}
		cloudAgentToolResult("run-1", state, call, result, nil)
	}
	cloudAgentFlushPendingImages(state)
}

// 场景 1：一个 assistant 回合带 3 个调用（图、图、非图），两张图都成功。
// 断言 assistant(tool_calls) 之后紧跟 3 条 tool 消息（tool_call_id 与声明顺序一致），
// 图片只在最后一条 tool 之后出现，且**只有一条** user 图片消息、内含 2 张图。
func TestCloudAgentBatchImagesFollowAllToolResults(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		cloudAgentPairingCall("call-1", "canvas_inspect_image", `{"nodeId":"image-b"}`),
		cloudAgentPairingCall("call-2", "canvas_get_state", `{}`),
	)
	results := map[string]any{
		"call-0": cloudAgentPairingInspection("image-a", "https://example.test/a"),
		"call-1": cloudAgentPairingInspection("image-b", "https://example.test/b"),
	}

	// 只执行调用，不走兜底 flush：模拟"批次刚执行完、还没开始组装下一步请求"。
	for index, call := range state.Calls {
		result := results[call.ID]
		if result == nil {
			result = map[string]any{"ok": true}
		}
		cloudAgentToolResult("run-1", state, call, result, nil)
		if index == 1 {
			if len(state.Canonical.Messages) != 3 {
				t.Fatalf("batch is not finished yet: messages must be assistant + 2 tool, got%s", cloudAgentDebugMessages(state.Canonical.Messages))
			}
			if indexes := cloudAgentImageMessageIndexes(state.Canonical.Messages); len(indexes) != 0 {
				t.Fatalf("image message was attached inside the batch: %v", indexes)
			}
			if len(state.PendingImageInspections) != 2 {
				t.Fatalf("both inspections must be buffered, got %d", len(state.PendingImageInspections))
			}
		}
	}
	assertCloudAgentToolCallPairing(t, state.Canonical.Messages)

	// 本批调用都执行完（advanceCloudAgent 的兜底 flush）。
	cloudAgentFlushPendingImages(state)
	messages := state.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)

	if len(messages) != 5 {
		t.Fatalf("expected assistant + 3 tool + 1 user image, got%s", cloudAgentDebugMessages(messages))
	}
	for index, id := range []string{"call-0", "call-1", "call-2"} {
		message := messages[index+1]
		if stringField(message, "role") != "tool" || stringField(message, "tool_call_id") != id {
			t.Fatalf("tool message #%d is not %q: %+v", index, id, message)
		}
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != 4 {
		t.Fatalf("images must ride exactly one user message after the last tool result, got %v", imageIndexes)
	}
	if got := cloudAgentMessageImagePartCount(messages[4]); got != 2 {
		t.Fatalf("merged image message must carry 2 images, got %d", got)
	}
	if nodes := cloudAgentImageMessageNodeIDs(messages[4]); len(nodes) != 2 || nodes[0] != "image-a" || nodes[1] != "image-b" {
		t.Fatalf("merged message must keep both node ids in order: %v", nodes)
	}
	// 逐图"文字回执 + 图片"的成对结构：2 图 = 4 个部件，交替 text/image_url。
	parts, _ := messages[4]["content"].([]any)
	if len(parts) != 4 {
		t.Fatalf("expected 2× (text + image), got %d parts", len(parts))
	}
	for index, want := range []string{"text", "image_url", "text", "image_url"} {
		part, _ := parts[index].(map[string]any)
		if stringField(part, "type") != want {
			t.Fatalf("part #%d must be %s: %+v", index, want, part)
		}
	}
	// 幂等：再 flush 一次不该多出一条消息
	if cloudAgentFlushPendingImages(state) {
		t.Fatal("flush must be idempotent")
	}
	if len(state.Canonical.Messages) != 5 {
		t.Fatalf("flush is not idempotent: %d messages", len(state.Canonical.Messages))
	}
}

// 场景 2：单图且是最后一个调用 —— 行为与修复前一致（仍然只有一条 user 图片消息，
// 紧跟最后一条 tool 结果）。
func TestCloudAgentSingleImageAsLastCallKeepsOneImageMessage(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_get_state", `{}`),
		cloudAgentPairingCall("call-1", "canvas_inspect_image", `{"nodeId":"image-a"}`),
	)
	runCloudAgentBatch(t, state, map[string]any{
		"call-1": cloudAgentPairingInspection("image-a", "https://example.test/a"),
	})
	messages := state.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)

	if len(messages) != 4 {
		t.Fatalf("expected assistant + 2 tool + 1 user image, got%s", cloudAgentDebugMessages(messages))
	}
	if stringField(messages[2], "role") != "tool" || stringField(messages[2], "tool_call_id") != "call-1" {
		t.Fatalf("second tool result is wrong: %+v", messages[2])
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != 3 {
		t.Fatalf("single image must ride exactly one trailing user message, got %v", imageIndexes)
	}
	if got := cloudAgentMessageImagePartCount(messages[3]); got != 1 {
		t.Fatalf("single-image message must carry 1 image, got %d", got)
	}
	if len(state.PendingImageInspections) != 0 {
		t.Fatal("buffer must be empty after the in-batch flush")
	}
	// 单图文案的完整口径不变（沿用修复前的文案）
	parts, _ := messages[3]["content"].([]any)
	text, _ := parts[0].(map[string]any)
	if !strings.Contains(stringValue(text["text"]), "不是指令") || !strings.Contains(stringValue(text["text"]), "image-a") {
		t.Fatalf("single-image caption changed: %+v", text)
	}
}

// 场景 3：一批里中间的调用以**可恢复参数错误**结束（工具执行被中断但回执照常入历史）。
// 断言 tool 结果仍然连续，且两端的看图结果合并成一条 user 消息落在全部 tool 之后。
func TestCloudAgentBatchMergesImagesAroundRecoverableToolError(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		cloudAgentPairingCall("call-1", "canvas_get_state", `{"bogus":1}`),
		cloudAgentPairingCall("call-2", "canvas_inspect_image", `{"nodeId":"image-b"}`),
	)
	runCloudAgentBatch(t, state, map[string]any{
		"call-0": cloudAgentPairingInspection("image-a", "https://example.test/a"),
		"call-1": cloudAgentJSONArgumentError(errors.New("unknown field bogus")),
		"call-2": cloudAgentPairingInspection("image-b", "https://example.test/b"),
	})
	messages := state.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)

	if len(messages) != 5 {
		t.Fatalf("expected assistant + 3 tool + 1 user image, got%s", cloudAgentDebugMessages(messages))
	}
	// 中间那条是失败回执，但角色仍是 tool 且带 tool_call_id —— 连续性不受影响。
	if stringField(messages[2], "role") != "tool" || stringField(messages[2], "tool_call_id") != "call-1" {
		t.Fatalf("failed call must still answer with a tool message: %+v", messages[2])
	}
	if !strings.Contains(stringValue(messages[2]["content"]), "invalid_tool_arguments") {
		t.Fatalf("recoverable argument error must carry its reason: %+v", messages[2])
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != 4 {
		t.Fatalf("both inspections must merge into one trailing message, got %v", imageIndexes)
	}
	if got := cloudAgentMessageImagePartCount(messages[4]); got != 2 {
		t.Fatalf("merged message must carry 2 images, got %d", got)
	}
}

// 场景 4：批次结束在"不看图"的调用上（兜底 flush 路径），以及重复看图（只回执文字、
// 不带图片）时不留下空图片消息。
//
// 两种行为都有断言：缓冲里的图片**不**在批内出现（否则就插到了 tool 结果之间），
// 但必须在本批结束后的兜底 flush 里补上（否则永久丢失，而 tool 回执已经在历史里）。
func TestCloudAgentBufferedImagesFlushAtBatchEndAndSurviveCheckpoint(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		// 同一张图第二次看：只回执文字，不再附图（ImageURL 为空）。
		cloudAgentPairingCall("call-1", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		cloudAgentPairingCall("call-2", "canvas_get_state", `{}`),
	)
	runCloudAgentBatch(t, state, map[string]any{
		"call-0": cloudAgentPairingInspection("image-a", "https://example.test/a"),
		"call-1": cloudAgentImageInspection{Receipt: map[string]any{"nodeId": "image-a", "repeat": true}},
	})
	messages := state.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)

	if len(messages) != 5 {
		t.Fatalf("expected assistant + 3 tool + 1 user image, got%s", cloudAgentDebugMessages(messages))
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != 4 {
		t.Fatalf("buffered image must be flushed after all tool results, got %v", imageIndexes)
	}
	if got := cloudAgentMessageImagePartCount(messages[4]); got != 1 {
		t.Fatalf("repeat inspection must not add a second image, got %d", got)
	}
	if len(state.PendingImageInspections) != 0 {
		t.Fatal("buffer must be drained by the fallback flush")
	}
}

// 缓冲必须进检查点：一次 advanceCloudAgent 只执行一个工具调用，整批调用跨越多次转移，
// 每次转移都从 StateJSON 重新解码（cloudAgentDecode）。这也是它不能标 `json:"-"` 的原因
// ——进程内字段在下一个调用到来时必然是空的，缓冲就白缓冲了。
// 本用例走真实的保存/解码路径（cloudAgentSave + cloudAgentDecode）把这点钉死。
func TestCloudAgentPendingImagesSurviveCheckpointRoundTrip(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		cloudAgentPairingCall("call-1", "canvas_get_state", `{}`),
	)
	// 合并树（上游为底）的解码会校验事件身份 `event.EventID == "<runID>:<seq>"`。
	// 本用例只需要"保存/解码"这条路径，不需要真实运行身份：用空 runID 让事件身份与
	// 下面那个裸 run（ID 为空）一致，从而绕开运行期请求校验（它只在 run 有 ID 时执行）。
	cloudAgentToolResult("", state, state.Calls[0], cloudAgentPairingInspection("image-a", "https://example.test/a"), nil)
	cloudAgentToolResult("", state, state.Calls[1], map[string]any{"ok": true}, nil)
	if len(state.PendingImageInspections) != 1 {
		t.Fatalf("expected one buffered inspection, got %d", len(state.PendingImageInspections))
	}

	run := &model.CloudAgentExecution{}
	if err := cloudAgentSave(run, state); err != nil {
		t.Fatalf("cloudAgentSave failed: %v", err)
	}
	if !strings.Contains(run.StateJSON, "pendingImageInspections") {
		t.Fatalf("buffer is not part of the checkpoint: %s", run.StateJSON)
	}
	decoded, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatalf("cloudAgentDecode failed: %v", err)
	}
	if len(decoded.PendingImageInspections) != 1 {
		t.Fatalf("buffer did not survive the checkpoint round trip: %d", len(decoded.PendingImageInspections))
	}
	if decoded.PendingImageInspections[0].ImageURL != "https://example.test/a" {
		t.Fatalf("buffered image url was lost: %+v", decoded.PendingImageInspections[0])
	}
	// 下一个调用的转移里 flush，图片落在已经入历史的两条 tool 结果之后。
	cloudAgentFlushPendingImages(&decoded)
	assertCloudAgentToolCallPairing(t, decoded.Canonical.Messages)
	imageIndexes := cloudAgentImageMessageIndexes(decoded.Canonical.Messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != len(decoded.Canonical.Messages)-1 {
		t.Fatalf("flushed image must be the last message, got %v", imageIndexes)
	}
}

// 多图合并成一条消息之后，裁剪仍要：移出该消息里的全部图片、保留逐图的文字回执与
// nodeId、并且占位符要逐图带上各自的观察（只写第一张会把整批的观察算到那张图头上）。
func TestCloudAgentPruneMergedImageMessageKeepsPerImageNotes(t *testing.T) {
	imageMessage := map[string]any{"role": "user", "content": cloudAgentImageContentParts(
		cloudAgentPairingInspection("image-a", "https://example.test/a"),
		cloudAgentPairingInspection("image-b", "https://example.test/b"),
	)}
	messages := []map[string]any{{"role": "user", "content": "看看这两张图"}}
	// 第一轮就是那个"一批两次看图、合并成一条 user 消息"的回合。
	messages = append(messages, cloudAgentPairingAssistantMessage("call-0"))
	messages = append(messages,
		map[string]any{"role": "tool", "tool_call_id": "call-0", "content": `{"nodeId":"image-a"}`},
		imageMessage)
	// 后面再排满保留窗口，把它挤出裁剪边界之外（边界只保留最近
	// cloudAgentImageRetentionRounds 个工具轮次）。
	for round := 1; round <= cloudAgentImageRetentionRounds+1; round++ {
		id := "call-" + strconv.Itoa(round)
		messages = append(messages,
			cloudAgentPairingAssistantMessage(id),
			map[string]any{"role": "tool", "tool_call_id": id, "content": `{}`})
	}
	const imageIndex = 3

	request := canonicalAgentRequest{Messages: messages}
	notes := map[string]string{"image-a": "灰底三视图，赛璐璐平涂", "image-b": "蓝天海水，写实厚涂"}
	changed, pruned := cloudAgentPruneInspectedImages(&request, notes)
	if !changed || pruned != 2 {
		t.Fatalf("both images of the merged message must be pruned: changed=%v pruned=%d", changed, pruned)
	}
	prunedMessage := request.Messages[imageIndex]
	if count := cloudAgentMessageImagePartCount(prunedMessage); count != 0 {
		t.Fatalf("images survived pruning: %d", count)
	}
	parts, _ := prunedMessage["content"].([]any)
	if len(parts) != 3 {
		t.Fatalf("expected 2 text receipts + 1 note, got %d parts", len(parts))
	}
	// 两条文字回执都在，且各自带自己的 nodeId
	for index, want := range []string{"image-a", "image-b"} {
		text, _ := parts[index].(map[string]any)
		if !strings.Contains(stringValue(text["text"]), want) {
			t.Fatalf("receipt #%d lost its node id: %+v", index, text)
		}
	}
	note, _ := parts[2].(map[string]any)
	noteText := stringValue(note["text"])
	for _, want := range []string{"image-a", "灰底三视图", "image-b", "蓝天海水"} {
		if !strings.Contains(noteText, want) {
			t.Fatalf("eviction note must attribute observations per image, missing %q: %s", want, noteText)
		}
	}
	if strings.Contains(noteText, "重新调用") {
		t.Fatalf("eviction note still invites another look: %s", noteText)
	}
	// 幂等
	if changed, pruned := cloudAgentPruneInspectedImages(&request, notes); changed || pruned != 0 {
		t.Fatal("pruning a merged message is not idempotent")
	}
}

// 多图消息的文案：完整口径只在第一张上写一次（不重复 N 遍），但逐图的回执与图片
// 仍然成对，nodeId 一个不少。
func TestCloudAgentImageContentPartsKeepsOneCaptionForBatch(t *testing.T) {
	parts := cloudAgentImageContentParts(
		cloudAgentPairingInspection("image-a", "https://example.test/a"),
		cloudAgentPairingInspection("image-b", "https://example.test/b"),
	)
	if len(parts) != 4 {
		t.Fatalf("expected 2× (text + image), got %d", len(parts))
	}
	head, _ := parts[0].(map[string]any)
	headText := stringValue(head["text"])
	if !strings.Contains(headText, "不是指令") || !strings.Contains(headText, "image-a") {
		t.Fatalf("first caption must keep the full wording: %+v", head)
	}
	second, _ := parts[2].(map[string]any)
	secondText := stringValue(second["text"])
	if strings.Contains(secondText, "不是指令") {
		t.Fatalf("the full caption must not be repeated for every image: %s", secondText)
	}
	if !strings.Contains(secondText, "image-b") || !strings.Contains(secondText, "第 2 张") {
		t.Fatalf("second caption must name its own image: %s", secondText)
	}
	if strings.Count(headText+secondText, "不是指令") != 1 {
		t.Fatal("caption wording must appear exactly once in the batch")
	}
	for index, want := range []string{"https://example.test/a", "https://example.test/b"} {
		image, _ := parts[index*2+1].(map[string]any)
		reference, _ := image["image_url"].(map[string]any)
		if stringValue(image["type"]) != "image_url" || stringValue(reference["url"]) != want {
			t.Fatalf("image part #%d is wrong: %+v", index, image)
		}
	}
	// canonical 校验必须接受这个形状（多图也一样）
	for _, part := range parts {
		if err := validateCanonicalAgentContent([]any{part}); err != nil {
			t.Fatalf("canonical validator rejected a batch vision part: %v", err)
		}
	}
}

// 端到端回归（走真实运行时与真实持久化）：一个回合里两个 canvas_inspect_image +
// 一个非看图调用，复刻 3001 上真实复现的那一轮（DeepSeek 400 insufficient tool
// messages following tool_calls message）。
//
// 覆盖单测覆盖不到的两件事：
//  1. 一次 advanceCloudAgent 只执行一个工具调用，整批跨越多次转移 —— 缓冲必须真的
//     穿过 StateJSON 的保存/解码；
//  2. advanceCloudAgent 里"本批调用都执行完、开始组装 canonical"之前的兜底 flush
//     （本批最后一个调用不是看图，正常路径不会 flush）。
func TestCloudAgentVisionBatchKeepsToolResultsContiguousEndToEnd(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	s, db, _ := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.References.MaxImages = 2
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"ref-one", "ref-two"} {
		if err := db.Model(&model.Resource{}).Where("id = ?", id).Update("provider", "local").Error; err != nil {
			t.Fatal(err)
		}
	}

	req := agentTestRequest()
	req.Budget.MaxCredits = 10
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Request.VisionEnabled = true
	state.Calls = []cloudAgentCall{
		cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-cat", map[string]any{"nodeId": "cat"}),
		cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-hero", map[string]any{"nodeId": "hero"}),
		cloudAgentStoryboardCall(t, "canvas_get_state", "read-state", map[string]any{}),
	}
	// 生产里这条 assistant 消息是模型返回工具调用时写入的（cloud_agent_runtime.go
	// 的 state.Calls = calls 那一步），这里手工补上，好让不变式断言真的覆盖到它。
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "content": "", "tool_calls": state.Calls})
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	// 逐个推进：一次转移执行一个工具调用。
	for step := 0; step < len(state.Calls); step++ {
		if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
			t.Fatalf("advance %d failed: %v", step, err)
		}
		run, err = s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		mid, decodeErr := cloudAgentDecode(run)
		if decodeErr != nil {
			t.Fatalf("decode after advance %d failed: %v", step, decodeErr)
		}
		// 注意：批内中间态**故意**只有部分 tool 结果（一次转移执行一个调用），此时
		// state.CallIndex < len(state.Calls)，advanceCloudAgent 直接返回、不会发请求，
		// 所以不变式只对"整批执行完、真正要发出去的 canonical"成立 —— 下面批次结束处才断言。
		if step < len(state.Calls)-1 && len(cloudAgentImageMessageIndexes(mid.Canonical.Messages)) != 0 {
			t.Fatalf("image message appeared before the batch finished (after advance %d): %s",
				step, cloudAgentDebugMessages(mid.Canonical.Messages))
		}
		if step == len(state.Calls)-1 && len(mid.PendingImageInspections) != 2 {
			t.Fatalf("both buffered inspections must survive the tick boundary, got %d", len(mid.PendingImageInspections))
		}
	}

	// 第四次推进：本批调用都执行完，兜底 flush 把两张图合并成一条 user 消息。
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatalf("batch-end advance failed: %v", err)
	}
	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	final, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if final.ActiveTaskID == "" || run.Status == "failed" {
		t.Fatalf("next model task not queued: %s", run.FailureMessage)
	}
	task, err := s.repo.TaskForUser("user", final.ActiveTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 2 || validateAgentResourcePlaceholders(input) != nil {
		t.Fatalf("next task lost approved image resources: %+v", input.ReferenceImages)
	}
	if strings.Contains(task.InputJSON, "base64,") || strings.Contains(task.InputJSON, "signature=") {
		t.Fatal("persisted image bytes or signed URL")
	}
	messages := final.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)

	if len(final.PendingImageInspections) != 0 {
		t.Fatalf("batch-end flush must drain the buffer, got %d", len(final.PendingImageInspections))
	}
	start := -1
	for index, message := range messages {
		if len(canonicalAgentToolCalls(message["tool_calls"])) == len(state.Calls) {
			start = index
			break
		}
	}
	if start < 0 {
		t.Fatalf("assistant batch with %d tool calls is missing: %s", len(state.Calls), cloudAgentDebugMessages(messages))
	}
	// 3 条 tool 结果连续且顺序与声明一致，紧接着才是唯一那条带 2 张图的 user 消息。
	for offset, id := range []string{"inspect-cat", "inspect-hero", "read-state"} {
		message := messages[start+1+offset]
		if stringField(message, "role") != "tool" || stringField(message, "tool_call_id") != id {
			t.Fatalf("tool message #%d is not %q: %+v", offset, id, message)
		}
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != start+1+len(state.Calls) {
		t.Fatalf("expected exactly one user image message right after the %d tool results, got %v (assistant#%d)%s",
			len(state.Calls), imageIndexes, start, cloudAgentDebugMessages(messages))
	}
	if got := cloudAgentMessageImagePartCount(messages[imageIndexes[0]]); got != 2 {
		t.Fatalf("merged image message must carry 2 images, got %d", got)
	}
	nodes := cloudAgentImageMessageNodeIDs(messages[imageIndexes[0]])
	if len(nodes) != 2 || nodes[0] != "cat" || nodes[1] != "hero" {
		t.Fatalf("merged message must keep both node ids in order: %v", nodes)
	}
}

// 场景 5：一批里"先看图、再 ask_user"——本轮就此结束，不会再走 advanceCloudAgent 的
// 兜底 flush。所以"本批结束"的另一个入口 skipRemainingCloudAgentCalls 自己必须 flush，
// 否则这批的图片会被永久丢掉（tool 回执已经在历史里）。
func TestCloudAgentAskUserBatchFlushesBufferedImages(t *testing.T) {
	state := cloudAgentPairingState(
		cloudAgentPairingCall("call-0", "canvas_inspect_image", `{"nodeId":"image-a"}`),
		cloudAgentPairingCall("call-1", "ask_user", `{}`),
	)
	cloudAgentToolResult("run-1", state, state.Calls[0], cloudAgentPairingInspection("image-a", "https://example.test/a"), nil)
	// ask_user 的收尾顺序（cloud_agent_runtime.go 的 ask_user 分支）：先写自己的回执，
	// 再结束本批剩余调用。
	cloudAgentToolResult("run-1", state, state.Calls[1], map[string]any{"phase": "question"}, nil)
	skipRemainingCloudAgentCalls("run-1", state)

	messages := state.Canonical.Messages
	assertCloudAgentToolCallPairing(t, messages)
	assertNoImageMessageBeforeToolResult(t, messages)
	if len(state.PendingImageInspections) != 0 {
		t.Fatalf("ask_user 结束时缓冲必须被 flush，got %d", len(state.PendingImageInspections))
	}
	imageIndexes := cloudAgentImageMessageIndexes(messages)
	if len(imageIndexes) != 1 || imageIndexes[0] != len(messages)-1 {
		t.Fatalf("合并后的图片消息必须在全部 tool 结果之后，got %v%s", imageIndexes, cloudAgentDebugMessages(messages))
	}
	if got := cloudAgentMessageImagePartCount(messages[imageIndexes[0]]); got != 1 {
		t.Fatalf("expected one image in the flushed message, got %d", got)
	}
}
