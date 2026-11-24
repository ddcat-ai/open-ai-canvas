package jianying

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"testing"
)

func TestNormalizeDraftRootAcrossPlatforms(t *testing.T) {
	for input, expected := range map[string]string{
		" /Users/电影作者/Movies/Drafts/ ":      "/Users/电影作者/Movies/Drafts",
		`C:\Users\Editor\User Data\Drafts\`: `C:\Users\Editor\User Data\Drafts`,
		`D:/Projects/中文 草稿/`:                `D:\Projects\中文 草稿`,
		`\\server\share\Drafts\`:            `\\server\share\Drafts`,
		`//server/share/Drafts/`:            `\\server\share\Drafts`,
	} {
		got, err := NormalizeRoot(input)
		if err != nil || got != expected {
			t.Fatalf("root %q => %q, %v", input, got, err)
		}
	}
	for _, input := range []string{"", "/", `C:\`, "relative/drafts", "~/Movies", "/Users/你的用户名/Movies", "/Users/editor/../Drafts", `C:\A\..\B`, `C:\A\bad.`, `C:\A\CON`, `C:\A\x:y`, `C:\A\x?y`, `\\server\share`, "/Users/xx\x01/drafts", "/Users/xx\x7f/drafts", strings.Repeat("中", 401)} {
		if _, err := NormalizeRoot(input); err == nil {
			t.Errorf("invalid root accepted: %q", input)
		}
	}
}

func TestBuildDraftMaterialPathsIDsAndCaptions(t *testing.T) {
	for _, root := range []string{"/Users/editor/Drafts", `C:/Users/Editor/Drafts`, `\\server\share\Drafts`} {
		draft := Draft{Name: "第1集-唯一草稿", Root: root, Width: 1080, Height: 1920, Clips: []Clip{{FileName: "01-开场.mp4", DurationUs: 2_500_000}, {FileName: "02-结尾.mov", DurationUs: 1_250_000}}, Captions: []Caption{{Text: "开场", StartUs: 0, DurationUs: 1_000_000}, {Text: "末尾", StartUs: 3_500_000, DurationUs: 2_000_000}, {Text: "越界", StartUs: 4_000_000, DurationUs: 1_000_000}}}
		contentRaw, metaRaw, err := Build(draft)
		if err != nil {
			t.Fatal(err)
		}
		var content struct {
			ID        string `json:"id"`
			Duration  int64  `json:"duration"`
			Materials struct {
				Videos []struct {
					ID, Path string
					Duration int64
				} `json:"videos"`
			} `json:"materials"`
			Tracks []struct {
				Type     string `json:"type"`
				Segments []struct {
					MaterialID string                          `json:"material_id"`
					Target     struct{ Start, Duration int64 } `json:"target_timerange"`
				} `json:"segments"`
			} `json:"tracks"`
		}
		var meta struct {
			ID   string `json:"draft_id"`
			Path string `json:"draft_fold_path"`
		}
		if err := json.Unmarshal(contentRaw, &content); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(metaRaw, &meta); err != nil {
			t.Fatal(err)
		}
		if content.ID != meta.ID || !regexp.MustCompile(`^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$`).MatchString(content.ID) {
			t.Fatalf("invalid/different draft IDs: %s %s", content.ID, meta.ID)
		}
		if content.Duration != 3_750_000 || len(content.Tracks) != 2 || len(content.Tracks[1].Segments) != 2 {
			t.Fatalf("unexpected draft: %s", contentRaw)
		}
		draft.Root, _ = NormalizeRoot(root)
		if meta.Path != draft.FolderPath() {
			t.Fatal("folder path differs from target")
		}
		var cursor int64
		for i, clip := range draft.Clips {
			material := content.Materials.Videos[i]
			segment := content.Tracks[0].Segments[i]
			if material.Path != draft.MaterialPath(clip.FileName) || segment.MaterialID != material.ID || segment.Target.Start != cursor || segment.Target.Duration != clip.DurationUs {
				t.Fatal("video path/id/range mismatch")
			}
			cursor += clip.DurationUs
		}
		last := content.Tracks[1].Segments[1].Target
		if last.Start+last.Duration != content.Duration {
			t.Fatal("subtitle extends past media")
		}
	}
}

func TestBuildDraftRejectsUnsafeMaterialAndDuration(t *testing.T) {
	base := Draft{Name: "draft", Root: "/Users/editor/Drafts", Width: 1920, Height: 1080, Clips: []Clip{{FileName: "video.mp4", DurationUs: 1000}}}
	for _, name := range []string{"../video.mp4", `a\video.mp4`, "/video.mp4", "CON.mp4"} {
		draft := base
		draft.Clips = []Clip{{FileName: name, DurationUs: 1000}}
		if _, _, err := Build(draft); err == nil {
			t.Fatalf("unsafe material accepted: %s", name)
		}
	}
	base.Clips = []Clip{{FileName: "v.mp4", DurationUs: 1000}, {FileName: "V.mp4", DurationUs: 1000}}
	if _, _, err := Build(base); err == nil {
		t.Fatal("case-insensitive filename collision accepted")
	}
	base.Clips = []Clip{{FileName: "v.mp4", DurationUs: math.MaxInt64}, {FileName: "v2.mp4", DurationUs: 1}}
	if _, _, err := Build(base); err == nil {
		t.Fatal("overflow accepted")
	}
}

func TestSRTSkipsInvalidRanges(t *testing.T) {
	got := SRT([]Caption{{Text: "有效", StartUs: 1234000, DurationUs: 1000000}, {Text: "负数", StartUs: -1, DurationUs: 1000000}, {Text: "溢出", StartUs: math.MaxInt64 - 2, DurationUs: 5}})
	if got != "1\n00:00:01,234 --> 00:00:02,234\n有效\n\n" {
		t.Fatal(got)
	}
}
