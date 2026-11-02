package skills

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
)

func discoveryTestClient(t *testing.T, tree githubSkillTree) *http.Client {
	t.Helper()
	data, err := json.Marshal(tree)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.String() {
		case "https://api.github.com/repos/owner/repo":
			return githubTestResponse(http.StatusOK, `{"default_branch":"release"}`), nil
		case "https://api.github.com/repos/owner/repo/commits/release":
			return githubTestResponse(http.StatusOK, `{"sha":"resolved-commit"}`), nil
		case "https://api.github.com/repos/owner/repo/git/trees/resolved-commit?recursive=1":
			return githubTestResponse(http.StatusOK, string(data)), nil
		default:
			t.Fatalf("discovery must not download files: %s", request.URL)
			return nil, nil
		}
	})}
}

func TestDiscoverGitHubSkillCollection(t *testing.T) {
	tree := githubSkillTree{Tree: []githubSkillTreeEntry{
		{Path: "skills/writer/SKILL.md", Mode: "100644", Type: "blob", Size: 50},
		{Path: "skills/director/SKILL.md", Mode: "100755", Type: "blob", Size: 50},
		{Path: ".agents/skills/maintainer/SKILL.md", Mode: "100644", Type: "blob", Size: 50},
	}}
	for index := 0; index < 600; index++ {
		tree.Tree = append(tree.Tree, githubSkillTreeEntry{Path: fmt.Sprintf("examples/%d.jpg", index), Mode: "100644", Type: "blob", Size: 30 << 20})
	}
	result, err := discoverGitHubSkillsWithClient(context.Background(), discoveryTestClient(t, tree), githubSkillSpec{Owner: "owner", Repo: "repo"})
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceURL != "https://github.com/owner/repo" || result.SourceRef != "release" || result.SourceCommit != "resolved-commit" {
		t.Fatalf("incorrect source identity: %#v", result)
	}
	if len(result.Skills) != 3 || result.Skills[0].Subdir != ".agents/skills/maintainer" || result.Skills[1].Subdir != "skills/director" || result.Skills[2].Subdir != "skills/writer" {
		t.Fatalf("unexpected ordered candidates: %#v", result.Skills)
	}
	for _, candidate := range result.Skills {
		if candidate.Name != candidate.Subdir {
			t.Fatalf("candidate label must identify its path: %#v", candidate)
		}
	}
}

func TestDiscoverGitHubSkillExactManifestWins(t *testing.T) {
	for _, subdir := range []string{"", "skills/writer"} {
		t.Run(subdir, func(t *testing.T) {
			manifest := "SKILL.md"
			if subdir != "" {
				manifest = subdir + "/SKILL.md"
			}
			tree := githubSkillTree{Tree: []githubSkillTreeEntry{
				{Path: "skills/writer/nested/SKILL.md", Mode: "100644", Type: "blob", Size: 50},
				{Path: manifest, Mode: "100644", Type: "blob", Size: 50},
				{Path: "other/SKILL.md", Mode: "100644", Type: "blob", Size: 50},
				{Path: "examples/bad/SKILL.md", Mode: "120000", Type: "blob", Size: 50},
				{Path: "skills/writer/examples/large/SKILL.md", Mode: "100644", Type: "blob", Size: maxSkillFileBytes + 1},
			}}
			result, err := discoverGitHubSkillsWithClient(context.Background(), discoveryTestClient(t, tree), githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: subdir})
			if err != nil || len(result.Skills) != 1 || result.Skills[0].Subdir != subdir {
				t.Fatalf("exact selection = %#v, error = %v", result, err)
			}
		})
	}
}

func TestDiscoverGitHubSkillsRejectsUnsafeCandidates(t *testing.T) {
	for _, test := range []struct {
		name string
		tree githubSkillTree
		want string
	}{
		{"truncated", githubSkillTree{Truncated: true}, "无法完整读取"},
		{"missing", githubSkillTree{}, "未找到 SKILL.md"},
		{"traversal", githubSkillTree{Tree: []githubSkillTreeEntry{{Path: "../SKILL.md", Type: "blob", Mode: "100644"}}}, "越界"},
		{"normalized traversal", githubSkillTree{Tree: []githubSkillTreeEntry{{Path: "skills/a/../SKILL.md", Type: "blob", Mode: "100644"}}}, "路径无效"},
		{"symlink", githubSkillTree{Tree: []githubSkillTreeEntry{{Path: "skills/a/SKILL.md", Type: "blob", Mode: "120000"}}}, "软链接"},
		{"oversize", githubSkillTree{Tree: []githubSkillTreeEntry{{Path: "SKILL.md", Type: "blob", Mode: "100644", Size: maxSkillFileBytes + 1}}}, "8MB"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := discoverGitHubSkillsWithClient(context.Background(), discoveryTestClient(t, test.tree), githubSkillSpec{Owner: "owner", Repo: "repo"})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestDiscoverGitHubSkillsRequiresUserAndSafeURL(t *testing.T) {
	svc := &Service{}
	_, err := svc.DiscoverGitHubSkills(context.Background(), " ", SkillGitHubDiscoverRequest{URL: "https://github.com/owner/repo"})
	if appErr, ok := err.(*kernel.AppError); !ok || appErr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated error = %#v", err)
	}
	for _, address := range []string{"http://github.com/owner/repo", "https://localhost/owner/repo", "https://user@github.com/owner/repo"} {
		if _, err := svc.DiscoverGitHubSkills(context.Background(), "user", SkillGitHubDiscoverRequest{URL: address}); err == nil {
			t.Fatalf("accepted invalid URL %q", address)
		}
	}
}

func TestDiscoverGitHubSkillsLimitsCandidateCount(t *testing.T) {
	tree := githubSkillTree{}
	for index := 0; index <= maxSkillPackageFiles; index++ {
		tree.Tree = append(tree.Tree, githubSkillTreeEntry{Path: fmt.Sprintf("skills/%d/SKILL.md", index), Type: "blob", Mode: "100644", Size: 50})
	}
	_, err := discoverGitHubSkillsWithClient(context.Background(), discoveryTestClient(t, tree), githubSkillSpec{Owner: "owner", Repo: "repo"})
	if err == nil || !strings.Contains(err.Error(), "技能过多") {
		t.Fatalf("error = %v, want candidate limit", err)
	}
}

func TestFetchGitHubSkillCollectionSubdirRequiresSelection(t *testing.T) {
	tree := githubSkillTree{Tree: []githubSkillTreeEntry{
		{Path: "skills/director/SKILL.md", Type: "blob", Mode: "100644", Size: 50},
		{Path: "skills/writer/SKILL.md", Type: "blob", Mode: "100644", Size: 50},
	}}
	for index := 0; index < 600; index++ {
		tree.Tree = append(tree.Tree, githubSkillTreeEntry{Path: fmt.Sprintf("skills/assets/%d.md", index), Type: "blob", Mode: "100644", Size: 50})
	}
	_, err := fetchGitHubSkillSubdir(context.Background(), discoveryTestClient(t, tree), githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "skills"}, "resolved-commit")
	if err == nil || !strings.Contains(err.Error(), "请指定技能子目录") {
		t.Fatalf("error = %v, want directory selection before count limit", err)
	}
}

type githubZipTestEntry struct {
	name string
	data []byte
	mode os.FileMode
}

func githubZipTestData(t *testing.T, entries []githubZipTestEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		if entry.mode != 0 {
			header.SetMode(entry.mode)
		} else {
			header.SetMode(0o644)
		}
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestFetchGitHubSkillSmallCompressedZipSkipsExamples(t *testing.T) {
	entries := []githubZipTestEntry{
		{name: "repo-main/SKILL.md", data: []byte("# Creative\n\nCreate scenes.\n")},
		{name: "repo-main/scripts/generate.py", data: []byte("print('hello')")},
		{name: "repo-main/example/large.jpg", data: bytes.Repeat([]byte("x"), maxSkillPackageBytes+1)},
	}
	for index := 0; index < 600; index++ {
		entries = append(entries, githubZipTestEntry{name: fmt.Sprintf("repo-main/examples/%d.md", index), data: []byte("example")})
	}
	data := githubZipTestData(t, entries)
	if len(data) >= maxSkillPackageBytes {
		t.Fatal("fixture must exercise small compressed ZIP path")
	}
	client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://codeload.github.com/owner/repo/zip/commit" {
			t.Fatalf("unexpected download: %s", request.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header)}, nil
	})}
	archive, err := fetchGitHubSkillZip(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo"}, "commit")
	if err != nil || len(archive.Files) != 2 || len(archive.Files["scripts/generate.py"]) == 0 {
		t.Fatalf("filtered archive = %#v, error = %v", archive, err)
	}
	if _, err := archiveFromZip(data, ""); err == nil {
		t.Fatal("uploaded ZIP must retain its original limits")
	}
}

func TestGitHubRootKeepsExamplesWithinLimits(t *testing.T) {
	data := githubZipTestData(t, []githubZipTestEntry{
		{name: "repo-main/SKILL.md", data: []byte("# Director\n\nDirect films.\n")},
		{name: "repo-main/examples/scene.md", data: []byte("a useful reference scene")},
	})
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	archive, err := archiveFromGitHubZip(reader)
	if err != nil || len(archive.Files) != 2 || string(archive.Files["examples/scene.md"]) != "a useful reference scene" {
		t.Fatalf("small root archive lost its examples: %#v, error = %v", archive, err)
	}
}

func TestGitHubRootCollectionRequestsSelectionBeforeCountLimit(t *testing.T) {
	entries := []githubZipTestEntry{
		{name: "repo-main/skills/director/SKILL.md", data: []byte("# Director\n\nDirect films.\n")},
		{name: "repo-main/skills/writer/SKILL.md", data: []byte("# Writer\n\nWrite films.\n")},
	}
	for index := 0; index < 600; index++ {
		entries = append(entries, githubZipTestEntry{name: fmt.Sprintf("repo-main/examples/%d.md", index), data: []byte("example")})
	}
	data := githubZipTestData(t, entries)
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	_, err = archiveFromGitHubZip(reader)
	if err == nil || !strings.Contains(err.Error(), "请指定技能子目录") || strings.Contains(err.Error(), "512") {
		t.Fatalf("error = %v, want directory selection", err)
	}
}

func TestGitHubLegacySingletonSourceRemainsFetchable(t *testing.T) {
	const manifest = "# Director\n\nDirect films.\n"
	for _, sourceSubdir := range []string{"", "skills"} {
		t.Run("source-subdir="+sourceSubdir, func(t *testing.T) {
			entries := []githubZipTestEntry{
				{name: "repo-main/skills/director/SKILL.md", data: []byte(manifest)},
				{name: "repo-main/skills/director/references/camera.md", data: []byte("camera")},
				{name: "repo-main/README.md", data: []byte("repository readme")},
			}
			tree := githubSkillTree{Tree: []githubSkillTreeEntry{
				{Path: "skills/director/SKILL.md", Type: "blob", Mode: "100644", Size: int64(len(manifest))},
				{Path: "skills/director/references/camera.md", Type: "blob", Mode: "100644", Size: 6},
				{Path: "README.md", Type: "blob", Mode: "100644", Size: 17},
			}}
			for index := 0; index < 600; index++ {
				entries = append(entries, githubZipTestEntry{name: fmt.Sprintf("repo-main/skills/assets/%d.md", index), data: []byte("example")})
				tree.Tree = append(tree.Tree, githubSkillTreeEntry{Path: fmt.Sprintf("skills/assets/%d.md", index), Type: "blob", Mode: "100644", Size: 7})
			}
			data := githubZipTestData(t, entries)
			treeJSON, err := json.Marshal(tree)
			if err != nil {
				t.Fatal(err)
			}
			client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				switch request.URL.String() {
				case "https://api.github.com/repos/owner/repo/commits/main":
					return githubTestResponse(http.StatusOK, `{"sha":"resolved-commit"}`), nil
				case "https://codeload.github.com/owner/repo/zip/resolved-commit":
					return githubTestResponse(http.StatusOK, string(data)), nil
				case "https://api.github.com/repos/owner/repo/git/trees/resolved-commit?recursive=1":
					return githubTestResponse(http.StatusOK, string(treeJSON)), nil
				case "https://raw.githubusercontent.com/owner/repo/resolved-commit/skills/director/SKILL.md":
					return githubTestResponse(http.StatusOK, manifest), nil
				case "https://raw.githubusercontent.com/owner/repo/resolved-commit/skills/director/references/camera.md":
					return githubTestResponse(http.StatusOK, "camera"), nil
				default:
					t.Fatalf("unexpected request for legacy source: %s", request.URL)
					return nil, nil
				}
			})}
			archive, commit, sourceURL, ref, err := fetchGitHubSkillArchiveWithClient(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo", Ref: "main", Subdir: sourceSubdir})
			if err != nil || len(archive.Files) != 2 || string(archive.Files["SKILL.md"]) != manifest || string(archive.Files["references/camera.md"]) != "camera" {
				t.Fatalf("legacy archive = %#v, error = %v", archive, err)
			}
			if commit != "resolved-commit" || sourceURL != "https://github.com/owner/repo" || ref != "main" {
				t.Fatalf("legacy source identity = %q, %q, %q", commit, sourceURL, ref)
			}
		})
	}
}

func TestDiscoverGitHubRootWithTreeLargerThanOneMiB(t *testing.T) {
	tree := githubSkillTree{Tree: []githubSkillTreeEntry{{Path: "SKILL.md", Type: "blob", Mode: "100644", Size: 50}}}
	for index := 0; index < 7000; index++ {
		tree.Tree = append(tree.Tree, githubSkillTreeEntry{Path: fmt.Sprintf("examples/%s/%d.jpg", strings.Repeat("a", 150), index), Type: "blob", Mode: "100644", Size: 50})
	}
	data, err := json.Marshal(tree)
	if err != nil || len(data) <= 1<<20 {
		t.Fatalf("fixture must exceed the old JSON bound: bytes=%d, error=%v", len(data), err)
	}
	result, err := discoverGitHubSkillsWithClient(context.Background(), discoveryTestClient(t, tree), githubSkillSpec{Owner: "owner", Repo: "repo"})
	if err != nil || len(result.Skills) != 1 || result.Skills[0].Subdir != "" {
		t.Fatalf("large-tree discovery = %#v, error = %v", result, err)
	}
}

func TestGitHubZipRetainsPackageSafetyLimits(t *testing.T) {
	base := githubZipTestEntry{name: "repo-main/SKILL.md", data: []byte("# Director\n\nDirect films.\n")}
	tooMany := []githubZipTestEntry{base}
	for index := 0; index < maxSkillPackageFiles; index++ {
		tooMany = append(tooMany, githubZipTestEntry{name: fmt.Sprintf("repo-main/references/%d.md", index), data: []byte("reference")})
	}
	for _, test := range []struct {
		name    string
		entries []githubZipTestEntry
		want    string
	}{
		{"count", tooMany, "512"},
		{"size", []githubZipTestEntry{base, {name: "repo-main/large.txt", data: bytes.Repeat([]byte("x"), maxSkillFileBytes+1)}}, "8MB"},
		{"traversal", []githubZipTestEntry{base, {name: "../escape.txt"}}, "越界"},
		{"outside wrapper", []githubZipTestEntry{base, {name: "other/file.txt"}}, "路径异常"},
		{"symlink", []githubZipTestEntry{base, {name: "repo-main/link", data: []byte("target"), mode: os.ModeSymlink | 0o777}}, "软链接"},
		{"duplicate", []githubZipTestEntry{base, base}, "重复"},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := githubZipTestData(t, test.entries)
			reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			_, err = archiveFromGitHubZip(reader)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}
