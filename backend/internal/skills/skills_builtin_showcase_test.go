package skills

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"strings"
	"testing"
	"testing/fstest"

	"yingce/backend/builtin"
)

func TestBuiltinShowcasePreservesSnakeCaseURL(t *testing.T) {
	const path = "珠宝电商图文视频一站式/SKILL.md"
	t.Run("self-contained", func(t *testing.T) {
		files := fstest.MapFS{
			path: &fstest.MapFile{Data: []byte(`---
name: 测试
description: 描述
metadata:
  showcaseMedia: [{"type":"image","showcase_uri":"fixture/image.png","showcase_url":"https://example.com/image.png"}]
---
正文
`)},
		}
		assertBuiltinShowcasePreservesSnakeCaseURL(t, files, path)
	})

	var files fs.FS = builtin.FS
	// Only absence of the sample from the catalog is optional. Unreadable files
	// and real samples rejected by the loader must still fail.
	if _, err := fs.Stat(files, path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			t.Log("real snake_case sample absent from catalog; self-contained fixture verified")
			return
		}
		t.Fatal(err)
	}
	t.Run("real-builtin", func(t *testing.T) {
		assertBuiltinShowcasePreservesSnakeCaseURL(t, files, path)
	})
}

func assertBuiltinShowcasePreservesSnakeCaseURL(t *testing.T, files fs.FS, path string) {
	t.Helper()
	packages, err := loadBuiltinSkillPackagesFromFS(files, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range packages {
		if item.skill.MarkdownURL != path {
			continue
		}
		metadata, err := parseBuiltinSkillMetadata(item.archive.Files["SKILL.md"])
		if err != nil {
			t.Fatal(err)
		}
		var source []map[string]string
		if err := json.Unmarshal([]byte(metadata.ShowcaseMediaRaw), &source); err != nil {
			t.Fatal(err)
		}
		var got []SkillShowcaseMedia
		if err := json.Unmarshal([]byte(item.skill.ShowcaseMediaJSON), &got); err != nil {
			t.Fatal(err)
		}
		if len(source) == 0 || source[0]["showcase_url"] == "" || len(got) != len(source) {
			t.Fatal("expected nonempty snake_case showcase fixture")
		}
		if got[0].ShowcaseURL != source[0]["showcase_url"] {
			t.Fatalf("builtin showcase URL = %q, want original nonempty snake_case URL", got[0].ShowcaseURL)
		}
		return
	}
	t.Fatal("builtin fixture not found")
}

func TestBuiltinShowcaseFormats(t *testing.T) {
	for _, tc := range []struct {
		name, raw, uri, url, wantError string
		count                          int
	}{
		{"snake", `[{"type":"image","showcase_uri":"uri","showcase_url":"https://example.com/a.png"}]`, "uri", "https://example.com/a.png", "", 1},
		{"camel", `[{"type":"image","showcaseUri":"uri","showcaseUrl":"https://example.com/a.png"}]`, "uri", "https://example.com/a.png", "", 1},
		{"equal", `[{"type":"image","showcase_uri":"uri","showcaseUri":"uri","showcase_url":"url","showcaseUrl":"url"}]`, "uri", "url", "", 1},
		{"conflicting URL", `[{"showcase_url":"a","showcaseUrl":"b"}]`, "", "", "showcase_url 与 showcaseUrl 冲突", 0},
		{"conflicting URI", `[{"showcase_uri":"a","showcaseUri":"b"}]`, "", "", "showcase_uri 与 showcaseUri 冲突", 0},
		{"explicit empty conflicts", `[{"showcase_url":"a","showcaseUrl":""}]`, "", "", "冲突", 0},
		{"missing fields", `[{"type":"image"}]`, "", "", "", 1},
		{"missing metadata", "", "", "", "", 0},
		{"empty array", `[]`, "", "", "", 0},
		{"object", `{}`, "", "", "必须是数组", 0},
		{"string", `"url"`, "", "", "必须是数组", 0},
		{"null", `null`, "", "", "必须是数组", 0},
		{"invalid field", `[{"showcase_url":123}]`, "", "", "cannot unmarshal", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items, err := parseBuiltinShowcaseMedia(tc.raw)
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error = %v, want %s", err, tc.wantError)
				}
				return
			}
			if err != nil || len(items) != tc.count {
				t.Fatalf("items = %#v, error = %v", items, err)
			}
			if len(items) > 0 && (items[0].ShowcaseURI != tc.uri || items[0].ShowcaseURL != tc.url) {
				t.Fatalf("items = %#v", items)
			}
			encoded, err := json.Marshal(items)
			if err != nil || strings.Contains(string(encoded), "showcase_") {
				t.Fatalf("output = %s, error = %v", encoded, err)
			}
			if len(items) > 0 && (!strings.Contains(string(encoded), `"showcaseUri"`) || !strings.Contains(string(encoded), `"showcaseUrl"`)) {
				t.Fatalf("missing camelCase keys: %s", encoded)
			}
		})
	}
}

func TestBuiltinShowcaseSkipsInvalidSkillAndLogsReason(t *testing.T) {
	fixture := func(raw string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte("---\nname: 测试\ndescription: 描述\nmetadata:\n  showcaseMedia: " + raw + "\n---\n正文\n")}
	}
	files := fstest.MapFS{
		"a-conflict/SKILL.md": fixture(`[{"showcase_url":"a","showcaseUrl":"b"}]`),
		"b-invalid/SKILL.md":  fixture(`{}`),
		"c-valid/SKILL.md":    fixture(`[{"type":"image","showcase_url":"https://example.com/a.png"}]`),
	}
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	packages, err := loadBuiltinSkillPackagesFromFS(files, nil)
	if err != nil || len(packages) != 1 || packages[0].skill.ID != "c-valid" {
		t.Fatalf("packages = %#v, error = %v", packages, err)
	}
	for _, want := range []string{"a-conflict", "showcase_url 与 showcaseUrl 冲突", "b-invalid", "必须是数组", "跳过加载"} {
		if !strings.Contains(output.String(), want) {
			t.Errorf("log missing %q: %s", want, output.String())
		}
	}
}
