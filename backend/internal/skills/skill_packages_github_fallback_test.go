package skills

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestFetchGitHubSkillUsesOfficialContentsFallback(t *testing.T) {
	for _, failure := range []string{"transport", "server"} {
		t.Run(failure, func(t *testing.T) {
			rawRequests, contentsRequests := 0, 0
			client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if strings.Contains(request.URL.Path, "/git/trees/") {
					return githubTestResponse(http.StatusOK, `{"tree":[{"path":"photo/SKILL.md","type":"blob","mode":"100644","size":30},{"path":"photo/reference notes.md","type":"blob","mode":"100644","size":6}]}`), nil
				}
				if request.URL.Hostname() == "raw.githubusercontent.com" {
					rawRequests++
					if failure == "server" {
						return githubTestResponse(http.StatusServiceUnavailable, "unavailable"), nil
					}
					return nil, errors.New("connection reset")
				}
				contentsRequests++
				if request.URL.Hostname() != "api.github.com" || request.URL.Query().Get("ref") != "immutable-commit" || request.Header.Get("Accept") != "application/vnd.github.raw+json" {
					t.Fatalf("fallback must request raw bytes from the same commit: %s %#v", request.URL, request.Header)
				}
				switch request.URL.EscapedPath() {
				case "/repos/owner/repo/contents/photo/SKILL.md":
					return githubTestResponse(http.StatusOK, "# Photo\n\nCreate photos.\n"), nil
				case "/repos/owner/repo/contents/photo/reference%20notes.md":
					return githubTestResponse(http.StatusOK, "camera"), nil
				default:
					t.Fatalf("unexpected fallback path: %s", request.URL)
					return nil, nil
				}
			})}
			archive, err := fetchGitHubSkillSubdir(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "photo"}, "immutable-commit")
			if err != nil || archive.Metadata.Name != "Photo" || string(archive.Files["reference notes.md"]) != "camera" {
				t.Fatalf("fallback archive = %#v, error = %v", archive, err)
			}
			if rawRequests != 1 || contentsRequests != 2 {
				t.Fatalf("raw=%d, contents=%d; fallback should remain selected for subsequent files", rawRequests, contentsRequests)
			}
		})
	}
}

func TestFetchGitHubSkillDoesNotFallbackOn404OrCancellation(t *testing.T) {
	for _, failure := range []string{"not-found", "canceled", "deadline"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			rawRequests := 0
			client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if strings.Contains(request.URL.Path, "/git/trees/") {
					return githubTestResponse(http.StatusOK, `{"tree":[{"path":"photo/SKILL.md","type":"blob","mode":"100644","size":30}]}`), nil
				}
				if request.URL.Hostname() != "raw.githubusercontent.com" {
					t.Fatalf("must not fallback after %s: %s", failure, request.URL)
				}
				rawRequests++
				switch failure {
				case "canceled":
					cancel()
					return nil, context.Canceled
				case "deadline":
					return nil, context.DeadlineExceeded
				default:
					return githubTestResponse(http.StatusNotFound, "not found"), nil
				}
			})}
			_, err := fetchGitHubSkillSubdir(ctx, client, githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "photo"}, "immutable-commit")
			if err == nil || rawRequests != 1 {
				t.Fatalf("failure=%s requests=%d error=%v", failure, rawRequests, err)
			}
			if failure == "canceled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation identity lost: %v", err)
			}
			if failure == "deadline" && !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("deadline identity lost: %v", err)
			}
		})
	}
}

func TestFetchGitHubSkillContentsFallbackIsBoundedAndChecksPayload(t *testing.T) {
	for _, test := range []struct {
		name    string
		status  int
		payload string
		want    string
	}{
		{"API failure", http.StatusServiceUnavailable, "unavailable", "HTTP 503"},
		{"oversized file", http.StatusOK, strings.Repeat("x", maxSkillFileBytes+1), "8MB"},
	} {
		t.Run(test.name, func(t *testing.T) {
			rawRequests, contentsRequests := 0, 0
			client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if strings.Contains(request.URL.Path, "/git/trees/") {
					return githubTestResponse(http.StatusOK, `{"tree":[{"path":"photo/SKILL.md","type":"blob","mode":"100644","size":30}]}`), nil
				}
				if request.URL.Hostname() == "raw.githubusercontent.com" {
					rawRequests++
					return nil, errors.New("connection reset")
				}
				contentsRequests++
				return githubTestResponse(test.status, test.payload), nil
			})}
			_, err := fetchGitHubSkillSubdir(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "photo"}, "immutable-commit")
			if err == nil || !strings.Contains(err.Error(), test.want) || rawRequests != 1 || contentsRequests != 1 {
				t.Fatalf("raw=%d contents=%d error=%v, want %q after one fallback", rawRequests, contentsRequests, err, test.want)
			}
		})
	}
}

func TestFetchGitHubSkillContentsFallbackChecksTotalPayload(t *testing.T) {
	payload := strings.Repeat("x", 7<<20)
	client := &http.Client{Transport: githubRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if strings.Contains(request.URL.Path, "/git/trees/") {
			return githubTestResponse(http.StatusOK, `{"tree":[{"path":"photo/SKILL.md","type":"blob","mode":"100644","size":1},{"path":"photo/one.txt","type":"blob","mode":"100644","size":1},{"path":"photo/two.txt","type":"blob","mode":"100644","size":1}]}`), nil
		}
		if request.URL.Hostname() == "raw.githubusercontent.com" {
			return nil, errors.New("connection reset")
		}
		return githubTestResponse(http.StatusOK, payload), nil
	})}
	_, err := fetchGitHubSkillSubdir(context.Background(), client, githubSkillSpec{Owner: "owner", Repo: "repo", Subdir: "photo"}, "immutable-commit")
	if err == nil || !strings.Contains(err.Error(), "20MB") {
		t.Fatalf("error = %v, want aggregate downloaded payload limit", err)
	}
}
