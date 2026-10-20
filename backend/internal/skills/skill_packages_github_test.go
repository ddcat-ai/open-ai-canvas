package skills

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type githubSkillTestTransport func(*http.Request) (*http.Response, error)

func (transport githubSkillTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestFetchGitHubSkillArchiveSlowDownload(t *testing.T) {
	commitSHA := strings.Repeat("a", 40)
	archiveData := skillZip(t, map[string]string{"repo-main/short-drama-director/SKILL.md": "# Test Skill\n\nA test skill.\n"})
	for _, ref := range []string{"", "main"} {
		t.Run("ref="+ref, func(t *testing.T) {
			metadataRequests := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/repos/owner/repo":
					metadataRequests++
					fmt.Fprint(writer, `{"default_branch":"main"}`)
				case "/repos/owner/repo/commits/main":
					if request.Header.Get("Accept") != "application/vnd.github.sha" {
						t.Error("commit request must ask for SHA only")
					}
					fmt.Fprint(writer, commitSHA)
				case "/owner/repo/zip/" + commitSHA:
					writer.WriteHeader(http.StatusOK)
					writer.(http.Flusher).Flush()
					select {
					case <-request.Context().Done():
						return
					case <-time.After(150 * time.Millisecond):
					}
					writer.Write(archiveData)
				default:
					http.NotFound(writer, request)
				}
			}))
			defer server.Close()
			transport := server.Client().Transport
			client := &http.Client{Timeout: 75 * time.Millisecond, Transport: githubSkillTestTransport(func(request *http.Request) (*http.Response, error) {
				deadline, ok := request.Context().Deadline()
				if request.URL.Host == "codeload.github.com" && (!ok || time.Until(deadline) < 110*time.Second) {
					t.Error("archive request must have its own two-minute download budget")
				}
				clone := request.Clone(request.Context())
				clone.URL.Scheme = "http"
				clone.URL.Host = strings.TrimPrefix(server.URL, "http://")
				return transport.RoundTrip(clone)
			})}
			archive, gotSHA, canonicalURL, resolvedRef, err := fetchGitHubSkillArchiveWithClient(context.Background(), githubSkillSpec{Owner: "owner", Repo: "repo", Ref: ref, Subdir: "short-drama-director"}, client)
			if err != nil || gotSHA != commitSHA || canonicalURL != "https://github.com/owner/repo" || resolvedRef != "main" || len(archive.Files["SKILL.md"]) == 0 {
				t.Fatalf("incomplete archive: sha=%q url=%q ref=%q files=%d err=%v", gotSHA, canonicalURL, resolvedRef, len(archive.Files), err)
			}
			if metadataRequests != 1 && ref == "" || metadataRequests != 0 && ref != "" {
				t.Fatalf("unexpected default branch lookups: %d", metadataRequests)
			}
			if client.Timeout != 75*time.Millisecond {
				t.Fatal("download must not change metadata client timeout")
			}
		})
	}
}

func TestFetchGitHubSkillArchiveCancellation(t *testing.T) {
	for _, host := range []string{"api.github.com", "codeload.github.com"} {
		t.Run(host, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			client := &http.Client{Transport: githubSkillTestTransport(func(request *http.Request) (*http.Response, error) {
				if request.URL.Host == host {
					cancel()
					return nil, request.Context().Err()
				}
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(strings.Repeat("a", 40)))}, nil
			})}
			_, _, _, _, err := fetchGitHubSkillArchiveWithClient(ctx, githubSkillSpec{Owner: "owner", Repo: "repo", Ref: "main"}, client)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("got %v; want cancellation", err)
			}
		})
	}
}

func TestInstallAndSyncGitHubSkillIntegration(t *testing.T) {
	rawURL := os.Getenv("CANVAS_TEST_GITHUB_SKILL_URL")
	if rawURL == "" {
		t.Skip("CANVAS_TEST_GITHUB_SKILL_URL is not set")
	}
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	service := New(repository.New(db), t.TempDir(), nil)
	installed, err := service.InstallGitHubSkill("test-user", SkillGitHubInstallRequest{URL: rawURL, Ref: os.Getenv("CANVAS_TEST_GITHUB_SKILL_REF"), Subdir: os.Getenv("CANVAS_TEST_GITHUB_SKILL_SUBDIR"), Tag: "creative", IsPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := service.SkillPackageBundle("test-user", installed.SkillID)
	if err != nil || len(bundle.Files) != installed.FileCount || installed.FileCount == 0 {
		t.Fatalf("incomplete persisted bundle: skill=%+v err=%v", installed, err)
	}
	synced, err := service.SyncGitHubSkill("test-user", installed.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	if synced.SyncStatus != "synced" || synced.SourceCommit == "" || synced.SourceRef == "" {
		t.Fatalf("incomplete sync: %+v", synced)
	}
	if synced.SourceCommit == installed.SourceCommit {
		assertSkillVersionCount(t, db, installed.SkillID, 1)
	}
	t.Logf("installed and synced %s ref=%s sha=%s files=%d", rawURL, synced.SourceRef, synced.SourceCommit, installed.FileCount)
}

func TestGitHubCommitSHA(t *testing.T) {
	commitSHA := "55f38919023ca6b2478f9fbaafd46128720a56bc"
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{name: "sha", body: commitSHA},
		{name: "newline", body: commitSHA + "\r\n"},
		{name: "uppercase", body: strings.ToUpper(commitSHA)},
		{name: "empty", body: "", wantErr: true},
		{name: "short", body: commitSHA[:39], wantErr: true},
		{name: "long", body: commitSHA + "0", wantErr: true},
		{name: "invalid hex", body: strings.Repeat("z", 40), wantErr: true},
		{name: "json", body: `{"sha":"` + commitSHA + `"}`, wantErr: true},
		{name: "oversized", body: commitSHA + strings.Repeat(" ", 100), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if got := request.Header.Get("Accept"); got != "application/vnd.github.sha" {
					t.Errorf("Accept = %q", got)
				}
				if got := request.Header.Get("User-Agent"); got != outbound.DefaultOutboundUserAgent {
					t.Errorf("User-Agent = %q", got)
				}
				fmt.Fprint(writer, test.body)
			}))
			defer server.Close()
			got, err := githubCommitSHA(context.Background(), server.Client(), server.URL)
			if test.wantErr {
				if err == nil || got != "" {
					t.Fatalf("got %q, %v; want empty SHA and error", got, err)
				}
				return
			}
			if err != nil || got != commitSHA {
				t.Fatalf("got %q, %v; want %q", got, err, commitSHA)
			}
		})
	}
}

func TestGitHubCommitSHAAvoidsLargeCommitDetails(t *testing.T) {
	commitSHA := "55f38919023ca6b2478f9fbaafd46128720a56bc"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/repos/owner/repo/commits/main" {
			t.Errorf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Accept") == "application/vnd.github.sha" {
			fmt.Fprint(writer, commitSHA)
			return
		}
		fmt.Fprintf(writer, `{"sha":%q,"files":[{"patch":%q}]}`, commitSHA, strings.Repeat("x", 2<<20))
	}))
	defer server.Close()
	got, err := githubCommitSHA(context.Background(), server.Client(), server.URL+"/repos/owner/repo/commits/main")
	if err != nil || got != commitSHA {
		t.Fatalf("got %q, %v; want %q without downloading commit details", got, err, commitSHA)
	}
}

func TestGitHubCommitSHAHTTPError(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusForbidden, http.StatusBadGateway} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.WriteHeader(status)
			}))
			defer server.Close()
			got, err := githubCommitSHA(context.Background(), server.Client(), server.URL)
			if err == nil || got != "" || !strings.Contains(err.Error(), fmt.Sprintf("HTTP %d", status)) {
				t.Fatalf("got %q, %v; want HTTP %d error", got, err, status)
			}
		})
	}
}

func TestGitHubCommitSHACancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := githubCommitSHA(ctx, http.DefaultClient, "https://api.github.com/repos/owner/repo/commits/main")
	if got != "" || !errors.Is(err, context.Canceled) {
		t.Fatalf("got %q, %v; want context cancellation", got, err)
	}
}

func TestFetchGitHubSkillArchiveIntegration(t *testing.T) {
	rawURL := os.Getenv("CANVAS_TEST_GITHUB_SKILL_URL")
	if rawURL == "" {
		t.Skip("CANVAS_TEST_GITHUB_SKILL_URL is not set")
	}
	spec, err := parseGitHubSkillURL(rawURL, os.Getenv("CANVAS_TEST_GITHUB_SKILL_REF"), os.Getenv("CANVAS_TEST_GITHUB_SKILL_SUBDIR"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	archive, commitSHA, canonicalURL, resolvedRef, err := fetchGitHubSkillArchive(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(commitSHA) != 40 || canonicalURL == "" || resolvedRef == "" || len(archive.Files["SKILL.md"]) == 0 {
		t.Fatalf("incomplete archive: sha=%q url=%q ref=%q files=%d", commitSHA, canonicalURL, resolvedRef, len(archive.Files))
	}
	t.Logf("fetched %s ref=%s sha=%s files=%d", canonicalURL, resolvedRef, commitSHA, len(archive.Files))
}
