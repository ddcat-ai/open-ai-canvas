package protocol

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// ImageAction describes an operation offered for one completed image task.
// ID is an opaque upstream token. The host must authorize against the parent
// task's saved actions and its own effective pricing before building a request.
type ImageAction struct {
	ID      string
	Kind    string
	Index   int
	Variant string
}

type ManifestImageContinuation struct {
	Create  ManifestOperation `json:"create"`
	Actions any               `json:"actions"`
}

type ImageContinuationAdapter interface {
	BuildImageContinuation(ctx context.Context, request RequestContext, parentTaskID string, action ImageAction) (RequestSpec, error)
}

var imageContinuationTaskID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)

func (a manifestAdapter) BuildImageContinuation(_ context.Context, request RequestContext, parentTaskID string, action ImageAction) (RequestSpec, error) {
	if a.manifest.ImageContinuation == nil {
		return RequestSpec{}, fmt.Errorf("当前协议未声明图片续作")
	}
	if !imageContinuationTaskID.MatchString(parentTaskID) || !action.valid() {
		return RequestSpec{}, fmt.Errorf("无效的图片续作任务或动作")
	}
	return buildManifestOperationWithEnv(a.manifest.ImageContinuation.Create, a.manifest.Auth, request.Request, parentTaskID, map[string]any{
		"action": map[string]any{"id": action.ID, "kind": action.Kind, "index": action.Index, "variant": action.Variant},
	})
}

func manifestImageActions(mapping any, env map[string]any) []ImageAction {
	value, err := evaluateManifestValue(mapping, env)
	if err != nil {
		return nil
	}
	var actions []ImageAction
	seen := make(map[string]bool)
	for _, entry := range manifestArray(value) {
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		id, _ := item["id"].(string)
		action := ImageAction{ID: id, Kind: manifestString(item["kind"]), Index: manifestInt(item["index"]), Variant: manifestString(item["variant"])}
		if !action.valid() || seen[action.ID] {
			continue
		}
		seen[action.ID] = true
		actions = append(actions, action)
		if len(actions) == 32 {
			break
		}
	}
	return actions
}

func (a ImageAction) valid() bool {
	if a.ID == "" || len(a.ID) > 512 || strings.TrimSpace(a.ID) != a.ID || strings.IndexFunc(a.ID, unicode.IsControl) != -1 || a.Index < 0 || a.Index > 32 {
		return false
	}
	switch a.Kind {
	case "select", "variation":
		return a.Variant == ""
	case "upscale":
		return a.Variant == "" || a.Variant == "subtle" || a.Variant == "creative"
	default:
		return false
	}
}
