package service

import (
	"strings"
	"testing"
)

func TestDecodeWhisperVerboseJSON(t *testing.T) {
	payload := []byte(`{
		"task": "transcribe",
		"language": "zh",
		"duration": 6.12,
		"text": " 大家好  ",
		"segments": [
			{"id": 0, "start": 0.0, "end": 2.015, "text": " 大家好 "},
			{"id": 1, "start": 2.5, "end": 6.12, "text": "   "},
			{"id": 2, "start": 4.12, "end": 6.121, "text": "今天天气不错"}
		]
	}`)
	segments, language, err := decodeWhisperVerboseJSON(payload)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if language != "zh" {
		t.Fatalf("language = %q, want zh", language)
	}
	// 空文本段被过滤，毫秒取整（0.0→0，2.5→2500）。
	if len(segments) != 2 {
		t.Fatalf("segments = %d, want 2 (blank segment filtered)", len(segments))
	}
	if segments[0].StartMs != 0 || segments[0].EndMs != 2015 {
		t.Fatalf("seg0 = %d-%d, want 0-2015", segments[0].StartMs, segments[0].EndMs)
	}
	if segments[0].Text != "大家好" {
		t.Fatalf("seg0 text = %q, want 大家好 (trimmed)", segments[0].Text)
	}
	if segments[1].StartMs != 4120 || segments[1].EndMs != 6121 {
		t.Fatalf("seg1 = %d-%d, want 4120-6121", segments[1].StartMs, segments[1].EndMs)
	}
}

func TestDecodeWhisperVerboseJSONInvalid(t *testing.T) {
	if _, _, err := decodeWhisperVerboseJSON([]byte(`{not json`)); err == nil {
		t.Fatal("decode invalid payload: want error")
	}
	// 空段落由 decode 正常返回空切片，守卫在 transcribe 层（避免写出空字幕）。
	segments, _, err := decodeWhisperVerboseJSON([]byte(`{"text":"","segments":[]}`))
	if err != nil {
		t.Fatalf("decode empty segments: unexpected error %v", err)
	}
	if len(segments) != 0 {
		t.Fatalf("decode empty segments: got %d, want 0", len(segments))
	}
}

func TestFormatSRTTimestamp(t *testing.T) {
	cases := []struct {
		ms   int64
		want string
	}{
		{0, "00:00:00,000"},
		{2015, "00:00:02,015"},
		{61001, "00:01:01,001"},
		{3661001, "01:01:01,001"},
		{-5, "00:00:00,000"},
	}
	for _, c := range cases {
		if got := formatSRTTimestamp(c.ms); got != c.want {
			t.Fatalf("formatSRTTimestamp(%d) = %q, want %q", c.ms, got, c.want)
		}
	}
}

func TestBuildTimelineSRT(t *testing.T) {
	segments := []timelineTranscriptionSegment{
		{StartMs: 0, EndMs: 2015, Text: "大家好"},
		{StartMs: 2500, EndMs: 6121, Text: "今天天气不错"},
	}
	srt := buildTimelineSRT(segments)
	want := "1\n00:00:00,000 --> 00:00:02,015\n大家好\n\n2\n00:00:02,500 --> 00:00:06,121\n今天天气不错\n\n"
	if srt != want {
		t.Fatalf("srt mismatch:\n got %q\nwant %q", srt, want)
	}
}

func TestExtForMimeAndTranscribable(t *testing.T) {
	transcribable := []string{"video/mp4", "audio/wav", "audio/mpeg", "video/webm", "audio/flac", "video/quicktime", "audio/aac", "audio/ogg"}
	for _, mime := range transcribable {
		if !isTranscribableMime(mime) {
			t.Fatalf("isTranscribableMime(%q) = false, want true", mime)
		}
		if strings.TrimPrefix(extForMime(mime), ".") == "bin" {
			t.Fatalf("extForMime(%q) fell back to .bin", mime)
		}
	}
	for _, mime := range []string{"image/png", "text/plain", ""} {
		if isTranscribableMime(mime) {
			t.Fatalf("isTranscribableMime(%q) = true, want false", mime)
		}
	}
}
