package skills

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

const yingshiSkillID = "yingshi-drama-workshop"
const yingshiPythonTreeSHA256 = "731838b084b3efbfda806378e5a6a2a83a0bf2040f8c627c29b88d32c904ff88"

var pythonScriptCommand = regexp.MustCompile("(?i)^\\s*(?:\\$\\s*)?(?:python(?:3(?:\\.\\d+)?)?|py(?:\\s+-3(?:\\.\\d+)?)?)\\s+[^`\\n]*(?:\\.py\\b|-m\\s+wfkit)")
var machineSpecificPath = regexp.MustCompile(`(?i)(?:[a-z]:\\|\\\\[^\\]+\\|/(?:Users|home|private/Users)/|~/)`)

func TestYingshiBuiltinBundleCompatibility(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	var target *builtinSkillPackage
	for index := range packages {
		if packages[index].skill.ID == yingshiSkillID {
			target = &packages[index]
			break
		}
	}
	if target == nil {
		t.Fatal("影视剧作工坊 built-in package was not loaded")
	}

	for _, path := range []string{
		"SKILL.md",
		"影视剧作工坊-路由/SKILL.md",
		"影视剧作工坊-故事板/SKILL.md",
		"影视剧作工坊-07-分镜头设计/storyboard/10-分镜剧本主SKILL.md",
		"影视剧作工坊-07-分镜头设计/storyboard/11-工作流.md",
		"影视剧作工坊-07-分镜头设计/storyboard/12-质量控制.md",
		"影视剧作工坊-07-分镜头设计/storyboard/13-本地交付.md",
	} {
		if _, ok := target.archive.Files[path]; !ok {
			t.Errorf("built-in package is missing %s", path)
		}
	}

	paths := make([]string, 0, 32)
	for path := range target.archive.Files {
		if strings.HasSuffix(path, ".py") {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	if len(paths) != 32 {
		t.Fatalf("Python file count = %d, want 32", len(paths))
	}
	executableCount := 0
	digest := sha256.New()
	for _, path := range paths {
		if !strings.HasSuffix(path, "/__init__.py") {
			executableCount++
		}
		fileHash := sha256.Sum256(target.archive.Files[path])
		_, _ = fmt.Fprintf(digest, "%s\t%s\n", path, hex.EncodeToString(fileHash[:]))
	}
	if executableCount != 31 {
		t.Fatalf("executable Python file count = %d, want 31", executableCount)
	}
	gotTreeHash := hex.EncodeToString(digest.Sum(nil))
	if gotTreeHash != yingshiPythonTreeSHA256 {
		t.Errorf("Python file tree hash = %s, want %s", gotTreeHash, yingshiPythonTreeSHA256)
	}

	agentDocs := []string{
		"SKILL.md",
		"影视剧作工坊-路由/SKILL.md",
		"影视剧作工坊-故事板/SKILL.md",
		"影视剧作工坊-07-分镜头设计/storyboard/10-分镜剧本主SKILL.md",
		"影视剧作工坊-07-分镜头设计/storyboard/11-工作流.md",
		"影视剧作工坊-07-分镜头设计/storyboard/13-本地交付.md",
		"影视剧作工坊-路由/scripts/README.md",
	}
	for _, path := range agentDocs {
		body := string(target.archive.Files[path])
		if violation := pythonCommandOutsideLocalOnly(body); violation != "" {
			t.Errorf("Agent-facing file %s contains a Python execution command outside a named local-only section: %s", path, violation)
		}
	}
	storyboard := string(target.archive.Files["影视剧作工坊-故事板/SKILL.md"])
	if !strings.Contains(storyboard, "本地用户可选脚本") {
		t.Error("storyboard skill must label its optional scripts as local-user-only")
	}
	if violation := pythonCommandOutsideLocalOnly("## Agent\npython scripts/check.py\n## 本地用户可选脚本\npython scripts/check.py\n"); violation == "" {
		t.Error("Python command scanner did not reject an Agent command outside the local-only section")
	}

	for _, path := range []string{"SKILL.md", "PKG_VERSION.json", "sources.json"} {
		if machineSpecificPath.Match(target.archive.Files[path]) {
			t.Errorf("package metadata %s contains a machine-specific path", path)
		}
	}
	var sourceConfig struct {
		Sources []struct {
			Path string `json:"path"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(target.archive.Files["sources.json"], &sourceConfig); err != nil {
		t.Fatalf("parse sources.json: %v", err)
	}
	if len(sourceConfig.Sources) == 0 {
		t.Fatal("sources.json lost its portable source entries")
	}
	for _, source := range sourceConfig.Sources {
		if source.Path != "" {
			t.Errorf("sources.json path must remain blank in the portable package, got %q", source.Path)
		}
	}
	provenance := target.archive.Files["影视剧作工坊-路由/scripts/wfkit/provenance.py"]
	defaults := regexp.MustCompile(`(?s)DEFAULT_ROOTS\s*=\s*\[[^\]]*\]`).Find(provenance)
	if defaults == nil {
		t.Fatal("provenance.py DEFAULT_ROOTS declaration was not found")
	}
	if strings.TrimSpace(string(defaults)) != "DEFAULT_ROOTS = []" {
		t.Errorf("provenance.py DEFAULT_ROOTS must be empty in the portable package, got %s", defaults)
	}
	if machineSpecificPath.Match(defaults) {
		t.Error("provenance.py DEFAULT_ROOTS contains a machine-specific path")
	}

	root := repositoryRoot(t)
	tools := readYingshiRepoFile(t, root, "backend/internal/app/cloud_agent_tools.go")
	if !strings.Contains(string(tools), `"skill_read_file"`) || !strings.Contains(string(tools), `"skill_search"`) {
		t.Fatal("host tool inventory no longer exposes the documented skill-reading tools")
	}
	if regexp.MustCompile(`(?i)add\(\s*"python(?:_exec|_run)?"`).Match(tools) {
		t.Fatal("host tool inventory unexpectedly exposes a Python executor; review the skill boundary")
	}
	unavailable := readYingshiRepoFile(t, root, "backend/internal/app/cloud_agent_pi_standard_tools_test.go")
	for _, fragment := range []string{"TestPiStandardToolsFailWhenExecutorIsUnavailable", `"write_file"`, `"bash"`, `"shell_command"`} {
		if !strings.Contains(string(unavailable), fragment) {
			t.Errorf("host executor inventory check missing %q", fragment)
		}
	}
	policy := readYingshiRepoFile(t, root, "backend/internal/prompts/agent-system-policy.md")
	if !strings.Contains(string(policy), "不执行 shell") {
		t.Error("host Agent policy no longer documents the shell execution boundary")
	}
}

func pythonCommandOutsideLocalOnly(document string) string {
	localOnly := false
	for _, line := range strings.Split(document, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			lower := strings.ToLower(trimmed)
			localOnly = strings.Contains(trimmed, "本地用户可选脚本") || strings.Contains(lower, "local-only")
			continue
		}
		if !localOnly && pythonScriptCommand.MatchString(line) {
			return trimmed
		}
	}
	return ""
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source for repository-relative tool checks")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "../../.."))
}

func readYingshiRepoFile(t *testing.T, root, path string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
	if err != nil {
		t.Fatalf("read host contract %s: %v", path, err)
	}
	return body
}
