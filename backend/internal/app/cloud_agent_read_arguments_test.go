package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentReadArgumentsRejectBeforeReadingCanvas(t *testing.T) {
	for _, tt := range []struct {
		name, arguments, message string
	}{
		{"unknown field", `{"limit":40}`, "不支持的字段"},
		{"wrong canvas", `{"canvasId":"other-canvas"}`, "不支持的字段"},
		{"string offset", `{"offset":"0"}`, "字段类型不匹配"},
		{"fractional offset", `{"offset":0.5}`, "字段类型不匹配"},
		{"string nodeIds", `{"nodeIds":"node-1"}`, "字段类型不匹配"},
		{"numeric nodeId", `{"nodeIds":[1]}`, "字段类型不匹配"},
		{"empty", ``, "单个 JSON 对象"},
		{"null", `null`, "单个 JSON 对象"},
		{"array", `[]`, "单个 JSON 对象"},
		{"encoded object", `"{}"`, "单个 JSON 对象"},
		{"trailing object", `{} {}`, "单个 JSON 对象"},
		{"incomplete", `{"offset":`, "JSON 格式无效"},
		{"negative offset", `{"offset":-1}`, "非负整数"},
		{"negative storyboard offset", `{"storyboardOffset":-1}`, "非负整数"},
		{"too many nodes", `{"nodeIds":["1","2","3","4","5","6","7","8","9"]}`, "最多包含8个"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			call := cloudAgentCall{ID: "read-1"}
			call.Function.Name = "canvas_get_state"
			call.Function.Arguments = tt.arguments
			// A nil repository ensures malformed arguments never trigger a read.
			_, err := cloudAgentReadTool(nil, "user", &cloudAgentRuntime{}, call)
			var argumentErr *cloudAgentArgumentError
			if !errors.As(err, &argumentErr) || !strings.Contains(cloudAgentSafeToolError(err), tt.message) {
				t.Fatalf("expected correctable %q error, got %v", tt.message, err)
			}
		})
	}
}

func TestCloudAgentReadArgumentFeedbackUsesAdvertisedSchema(t *testing.T) {
	req := agentTestRequest()
	for _, name := range []string{"agent_profile_read", "canvas_list_node_types", "canvas_get_state", "canvas_read_storyboard", "canvas_read_batch_table", "skill_read_file", "task_get"} {
		t.Run(name, func(t *testing.T) {
			state := &cloudAgentRuntime{Request: req, Canonical: canonicalAgentRequest{Tools: cloudAgentTools(req)}}
			call := cloudAgentCall{ID: "read-1"}
			call.Function.Name = name
			call.Function.Arguments = `{"private-value-do-not-echo":"private-value-do-not-echo"}`
			_, err := cloudAgentReadTool(nil, "user", state, call)
			if err == nil {
				t.Fatal("unknown argument was accepted")
			}
			cloudAgentToolResult("run", state, call, nil, err)
			content := state.Canonical.Messages[0]["content"].(string)
			if strings.Contains(content, "private-value-do-not-echo") {
				t.Fatal("validation feedback leaked model-controlled keys or values")
			}
			var result map[string]any
			if err := json.Unmarshal([]byte(content), &result); err != nil {
				t.Fatal(err)
			}
			if result["reason"] != "invalid_tool_arguments" || result["guidance"] == nil {
				t.Fatalf("missing repair feedback: %s", content)
			}
			// Unadvertised tools must not acquire a schema through error feedback.
			if name == "skill_read_file" {
				if result["parameters"] != nil {
					t.Fatal("disabled skill tool acquired a schema")
				}
			} else if result["parameters"] == nil {
				t.Fatal("advertised schema missing from repair feedback")
			}
		})
	}
}

func TestCloudAgentCanvasReadArgumentRepairContinuesRun(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"note","type":"text","content":"saved content"}]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	load := func() (*model.CloudAgentExecution, *cloudAgentRuntime) {
		t.Helper()
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			t.Fatal(err)
		}
		return run, &state
	}
	advance := func() {
		t.Helper()
		if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
			t.Fatal(err)
		}
	}
	for i, args := range []string{`{"limit":40}`, `{}`, `{"nodeIds":["note"]}`} {
		_, state := load()
		if state.ActiveTaskID == "" {
			t.Fatal("model continuation task missing")
		}
		call := cloudAgentCall{ID: "read-call"}
		call.Function.Name, call.Function.Arguments = "canvas_get_state", args
		body, err := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{
			"status": model.TaskStatusSucceeded, "result_json": string(body),
		}).Error; err != nil {
			t.Fatal(err)
		}
		advance() // Persist model output.
		advance() // Execute the read and persist the tool result.
		run, state := load()
		if run.Status == "failed" || state.Approval != nil {
			t.Fatalf("read must not terminate or require approval: %s", run.Status)
		}
		last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
		var result map[string]any
		if err := json.Unmarshal([]byte(last["content"].(string)), &result); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if result["reason"] != "invalid_tool_arguments" || result["exampleArguments"] == nil {
				t.Fatalf("missing repair context: %#v", result)
			}
			schema, ok := result["parameters"].(map[string]any)
			if !ok || schema["additionalProperties"] != false {
				t.Fatalf("lost strict schema after checkpoint: %#v", result)
			}
			properties, _ := schema["properties"].(map[string]any)
			if len(properties) != 7 || properties["offset"] == nil || properties["nodeIds"] == nil || properties["focusNodeIds"] == nil || properties["depth"] == nil || properties["includeRelated"] == nil || properties["storyboardOffset"] == nil || properties["connectionOffset"] == nil {
				t.Fatalf("wrong repair schema: %#v", properties)
			}
		} else if result["error"] != nil || result["snapshotHash"] == nil || !strings.Contains(last["content"].(string), "saved content") {
			t.Fatalf("corrected read did not return saved canvas: %#v", result)
		}
		advance() // Enqueue the next model step with the persisted feedback.
	}
	_, state := load()
	if err := db.Model(&model.Task{}).Where("id = ?", state.ActiveTaskID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"已读取画布"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	advance()
	run, _ := load()
	if run.Status != "completed" {
		t.Fatalf("repaired conversation did not complete: %s", run.Status)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil || stored.PayloadJSON != canvas.PayloadJSON {
		t.Fatalf("read changed canvas: %v", err)
	}
	call := cloudAgentCall{ID: "cross-user"}
	call.Function.Name, call.Function.Arguments = "canvas_get_state", `{}`
	if _, err := cloudAgentReadTool(s.repo, "other-user", state, call); err == nil {
		t.Fatal("corrected parameters bypassed canvas ownership")
	} else {
		var argumentErr *cloudAgentArgumentError
		if errors.As(err, &argumentErr) {
			t.Fatal("ownership failure was misclassified as a repairable argument error")
		}
	}
}
