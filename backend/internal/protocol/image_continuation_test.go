package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

const imageContinuationFixture = `{
  "apiVersion": "yingce.plugin/v2",
  "id": "image-sequence",
  "name": "Image Sequence",
  "version": "1.0.0",
  "contributes": {"providers": [{
    "id": "image-sequence",
    "label": "Image Sequence",
    "capabilities": ["image"],
    "scopes": ["canvas"],
    "auth": {"type": "bearer", "field": "apiKey"},
    "create": {"method": "POST", "path": "/jobs"},
    "poll": {"method": "GET", "path": "/jobs/{{taskId}}"},
    "response": {"taskIdPaths": ["id"], "statusPaths": ["status"], "resultKind": "image", "resultPaths": ["image"]},
    "imageContinuation": {
      "create": {"method": "POST", "path": "/jobs/{{taskId}}/actions", "body": {"action": {"$ref": "action.id"}}},
      "actions": {"$ref": "response.actions"}
    }
  }]}
}`

func TestDeclarativeImageContinuation(t *testing.T) {
	adapter, err := LoadInstalledPlugin([]byte(imageContinuationFixture), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	poll := PollContext{TaskID: "image-parent"}
	body := `{"id":"image-parent","status":"succeeded","image":"https://example.com/result.png","actions":[
	  {"id":"choose:1","kind":"select","index":1},
	  {"id":"choose:1","kind":"select","index":1},
	  {"id":"vary:1","kind":"variation","index":1},
	  {"id":"upscale:creative","kind":"upscale","variant":"creative"},
	  {"id":"unsupported","kind":"edit"},
	  {"id":"unrecognized","kind":"upscale","variant":"other"},
	  {"id":"bad-position","kind":"select","index":80}
	]}`
	result, err := adapter.ParsePoll(ctx, poll, []byte(body))
	if err != nil || result.Result == nil || len(result.Result.ImageActions) != 3 {
		t.Fatalf("expected validated image actions: %+v %v", result, err)
	}
	action := result.Result.ImageActions[0]
	if action != (ImageAction{ID: "choose:1", Kind: "select", Index: 1}) {
		t.Fatalf("unexpected first action: %+v", action)
	}
	public, err := json.Marshal(result)
	if err != nil || strings.Contains(string(public), action.ID) {
		t.Fatalf("provider token escaped result serialization: %s %v", public, err)
	}
	continuation := adapter.(ImageContinuationAdapter)
	spec, err := continuation.BuildImageContinuation(ctx, RequestContext{}, result.TaskID, action)
	if err != nil || spec.Method != "POST" || spec.Path != "/jobs/image-parent/actions" || spec.Auth.Type != "bearer" {
		t.Fatalf("unexpected request spec: %+v %v", spec, err)
	}
	if requestBody, ok := spec.Body.(map[string]any); !ok || requestBody["action"] != "choose:1" {
		t.Fatalf("wrong action mapping: %+v", spec.Body)
	}
	if _, err := continuation.BuildImageContinuation(ctx, RequestContext{}, "..", action); err == nil {
		t.Fatal("a parent ID must not alter the endpoint path")
	}
	for _, change := range [][2]string{
		{`"status":"succeeded"`, `"status":"pending"`},
		{`"status":"succeeded"`, `"status":"failed"`},
		{`"id":"image-parent"`, `"id":"another-task"`},
		{`"id":"image-parent"`, `"id":""`},
		{`"image":"https://example.com/result.png"`, `"image":""`},
	} {
		res, err := adapter.ParsePoll(ctx, poll, []byte(strings.Replace(body, change[0], change[1], 1)))
		if err != nil || res.Result != nil && len(res.Result.ImageActions) != 0 {
			t.Fatalf("ineligible task exposed actions: %+v %v", res, err)
		}
	}
}

func TestImageContinuationManifestValidatesMethodAndCapability(t *testing.T) {
	for _, fixture := range []string{
		strings.Replace(imageContinuationFixture, `"method": "POST", "path": "/jobs/{{taskId}}/actions"`, `"method": "GET", "path": "/jobs/{{taskId}}/actions"`, 1),
		strings.Replace(imageContinuationFixture, `"capabilities": ["image"]`, `"capabilities": ["video"]`, 1),
	} {
		if _, err := LoadInstalledPlugin([]byte(fixture), nil); err == nil {
			t.Fatal("unsafe continuation manifest was accepted")
		}
	}
}
