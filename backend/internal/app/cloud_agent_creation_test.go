package app

import (
	"encoding/json"
	"testing"
)

func creationAgentRequest() CloudAgentRequest {
	req := CloudAgentRequest{
		Surface: "creation", Prompt: "做一张产品主图", Model: "text-test",
		ChannelID: "channel", ChannelModelKey: "text-test",
		PermissionMode: "read_only", IdempotencyKey: "creation-test-key",
	}
	req.Budget.MaxCredits = 1
	return req
}

func TestCreationAgentEmptyContextScopePreservesIdempotency(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.ContextScope = []string{}
	req.ContextSelection = CloudAgentContextSelection{Surface: "creation"}
	first, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range [][]string{{}, nil} {
		req.ContextScope = scope
		replay, err := s.CreateCloudAgentRun("user", req, "")
		if err != nil || replay.ID != first.ID {
			t.Fatalf("empty creation scope changed idempotency: scope=%#v run=%+v err=%v", scope, replay, err)
		}
	}
	req.Prompt = "另一个真实不同的生成请求"
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("changed prompt was accepted under the same idempotency key")
	}
}

func TestCreationAgentRejectsUnverifiedAttachment(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	for _, attachment := range []string{
		`{"resourceId":"someone-else","storageKey":"resource:someone-else","kind":"image","role":"person","name":"人物"}`,
		`{"resourceId":"source","storageKey":"https://example.com/p.png","kind":"image","role":"product","name":"商品"}`,
		`{"resourceId":"source","storageKey":"resource:source","kind":"document","role":"product","name":"说明书"}`,
	} {
		base := creationAgentRequest()
		raw, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		var request map[string]json.RawMessage
		if err := json.Unmarshal(raw, &request); err != nil {
			t.Fatal(err)
		}
		request["attachments"] = json.RawMessage("[" + attachment + "]")
		raw, _ = json.Marshal(request)
		var withAttachment CloudAgentRequest
		if err := json.Unmarshal(raw, &withAttachment); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateCloudAgentRun("user", withAttachment, ""); err == nil {
			t.Fatalf("accepted unverified attachment %s", attachment)
		}
	}
}

func TestCreationAgentRejectsUnavailableMediaChoice(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{
		Selection:     CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "text-test"},
		ParameterMode: "auto",
	}}
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("accepted text model as image execution model")
	}
}

func TestCreationSessionRunPageStartsWithNewestAndRestoresPrompts(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	session, err := s.CreateCloudAgentSession("user", CloudAgentSessionRequest{Surface: "creation"})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 3)
	for i, prompt := range []string{"第一轮", "第二轮", "第三轮"} {
		req := creationAgentRequest()
		req.SessionID = session.ID
		req.Prompt = prompt
		req.IdempotencyKey = "creation-page-key-" + prompt
		run, err := s.CreateCloudAgentRun("user", req, "")
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = run.ID
	}
	runs, err := s.CloudAgentSessionRuns("user", session.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[0].ID != ids[2] || runs[0].UserPrompt != "第三轮" || runs[1].ID != ids[1] {
		t.Fatalf("first run page = %+v", runs)
	}
	older, err := s.CloudAgentSessionRuns("user", session.ID, 2, runs[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(older) != 1 || older[0].ID != ids[0] || older[0].UserPrompt != "第一轮" {
		t.Fatalf("older run page = %+v", older)
	}
	if _, err := s.CloudAgentSessionRuns("other", session.ID, 2); err == nil {
		t.Fatal("another user recovered the session")
	}
}

func TestCreationAgentRunDoesNotRequireCanvasOrExposeCanvasTools(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatalf("creation run without canvas: %v", err)
	}
	if run.CanvasID != "" || run.Surface != "creation" {
		t.Fatalf("creation run scope = canvas %q, surface %q", run.CanvasID, run.Surface)
	}
	if run.UserPrompt != req.Prompt {
		t.Fatalf("restored prompt = %q", run.UserPrompt)
	}
	_, state, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range state.Request.ContextScope {
		if tool == "canvas" {
			t.Fatal("creation run inherited canvas context")
		}
	}
	for _, tool := range cloudAgentTools(state.Request) {
		name := tool["function"].(map[string]any)["name"].(string)
		if len(name) >= 7 && name[:7] == "canvas_" {
			t.Fatalf("creation run exposed canvas tool %q", name)
		}
	}
	if _, err := s.CloudAgentRun("other", run.ID); err == nil {
		t.Fatal("another user read the creation run")
	}
}
