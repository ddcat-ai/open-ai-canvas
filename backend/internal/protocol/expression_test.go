package protocol

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
)

func TestEvaluateManifestSplitToFloatDivide(t *testing.T) {
	env := map[string]any{"request": map[string]any{"aspectRatio": "1280x720"}}
	parts, err := evaluateManifestValue(map[string]any{"$split": []any{map[string]any{"$ref": "request.aspectRatio"}, "x"}}, env)
	if err != nil {
		t.Fatal(err)
	}
	items, ok := parts.([]any)
	if !ok || len(items) != 2 || items[0] != "1280" || items[1] != "720" {
		t.Fatalf("split = %#v", parts)
	}
	width, err := evaluateManifestValue(map[string]any{"$toFloat": map[string]any{"$at": []any{parts, 0}}}, env)
	if err != nil {
		t.Fatal(err)
	}
	height, err := evaluateManifestValue(map[string]any{"$toFloat": map[string]any{"$at": []any{parts, 1}}}, env)
	if err != nil {
		t.Fatal(err)
	}
	ratio, err := evaluateManifestValue(map[string]any{"$divide": []any{width, height}}, env)
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestFloat(ratio); got < 1.77 || got > 1.78 {
		t.Fatalf("ratio = %v", got)
	}
}

func TestEvaluateManifestDivideRejectsZero(t *testing.T) {
	_, err := evaluateManifestValue(map[string]any{"$divide": []any{10, 0}}, map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "denominator") {
		t.Fatalf("error = %v", err)
	}
}

func TestEvaluateManifestToFloatLeavesInvalidInputEmpty(t *testing.T) {
	value, err := evaluateManifestValue(map[string]any{
		"$coalesce": []any{
			map[string]any{"$toFloat": "not-a-number"},
			1,
		},
	}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if got := manifestFloat(value); got != 1 {
		t.Fatalf("coalesced float = %v", got)
	}
}

func TestBinaryPayloadCreateResultAudio(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"audio-bin","version":"1.0.0","name":"Audio Bin","author":"Test","documentation":"# Audio",
		"contributes":{"providers":[{
			"id":"openai-audio","label":"OpenAI Audio","capabilities":["audio"],"scopes":["canvas"],
			"create":{"method":"POST","path":"/v1/audio/speech","body":{"model":{"$ref":"request.model"},"input":{"$ref":"request.prompt"}}},
			"response":{"binaryPayload":true,"resultKind":"audio","status":"succeeded"}
		}]}
	}`)
	adapter, err := LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("ID3fake-mp3-bytes")
	result, err := adapter.ParseCreate(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 {
		t.Fatalf("result = %#v", result)
	}
	audio := result.Result.Audios[0]
	if !strings.HasPrefix(audio.DataURL, "data:") || !strings.Contains(audio.DataURL, base64.StdEncoding.EncodeToString(payload)) {
		t.Fatalf("audio dataUrl = %q", audio.DataURL)
	}
}

func TestBinaryPayloadCreateResultRejectsEmpty(t *testing.T) {
	_, err := binaryPayloadCreateResult("audio", nil)
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("error = %v", err)
	}
}
