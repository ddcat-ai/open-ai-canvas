// Package architecture enforces Agent dependency and protocol boundaries using
// Go syntax trees. It has no dependency on app, service, or a linter plugin.
package architecture

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Finding struct {
	ID     string `json:"id"`
	Rule   string `json:"rule"`
	Value  int    `json:"value"`
	Limit  int    `json:"limit"`
	Detail string `json:"detail"`
}

type Allowance struct {
	ID     string `json:"id"`
	Max    int    `json:"max"`
	Reason string `json:"reason"`
}

type Baseline struct {
	Version    int         `json:"version"`
	Allowances []Allowance `json:"allowances"`
}

type source struct {
	path    string
	pkg     string
	file    *ast.File
	imports map[string]string
	body    []byte
}

type typeDecl struct {
	expr ast.Expr
	src  *source
}

type scanner struct {
	files []*source
	types map[string]typeDecl
	fset  *token.FileSet
}

func DecodeBaseline(body []byte) (Baseline, error) {
	var baseline Baseline
	if err := json.Unmarshal(body, &baseline); err != nil {
		return baseline, err
	}
	if baseline.Version != 1 {
		return baseline, fmt.Errorf("baseline version must be 1")
	}
	seen := make(map[string]bool)
	for _, row := range baseline.Allowances {
		if row.ID == "" || row.Max < 1 || strings.TrimSpace(row.Reason) == "" || seen[row.ID] {
			return baseline, fmt.Errorf("invalid or duplicate baseline allowance %q", row.ID)
		}
		seen[row.ID] = true
	}
	return baseline, nil
}

// Check never writes or expands the baseline. Reductions must lower/remove an
// existing allowance; additions and increased values fail the check.
func Check(backendRoot string, baseline Baseline) ([]Finding, error) {
	metrics, err := Scan(backendRoot)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]Allowance)
	for _, row := range baseline.Allowances {
		allowed[row.ID] = row
	}
	findings := []Finding{}
	for _, metric := range metrics {
		row, ok := allowed[metric.ID]
		delete(allowed, metric.ID)
		if !ok {
			findings = append(findings, metric)
			continue
		}
		if metric.Rule == "dependency" {
			findings = append(findings, metric)
			continue
		}
		if metric.Value > row.Max {
			metric.Limit = row.Max
			findings = append(findings, metric)
		}
		if metric.Value < row.Max {
			findings = append(findings, Finding{ID: metric.ID, Rule: "stale_baseline", Value: metric.Value, Limit: row.Max, Detail: "lower the existing baseline to the improved value; do not restore old debt"})
		}
	}
	for id, row := range allowed {
		findings = append(findings, Finding{ID: id, Rule: "stale_baseline", Limit: row.Max, Detail: "remove resolved baseline allowance"})
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].ID < findings[j].ID })
	return findings, nil
}

func Scan(backendRoot string) ([]Finding, error) {
	s, err := loadSources(backendRoot)
	if err != nil {
		return nil, err
	}
	out := []Finding{}
	for _, src := range s.files {
		out = append(out, s.fileFindings(src)...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func loadSources(root string) (*scanner, error) {
	body, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return nil, err
	}
	module := ""
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(line, "module ") {
			module = strings.TrimSpace(strings.TrimPrefix(line, "module "))
			break
		}
	}
	if module == "" {
		return nil, fmt.Errorf("go.mod module declaration missing")
	}
	s := &scanner{fset: token.NewFileSet(), types: map[string]typeDecl{}}
	agentRoot := filepath.Join(root, "internal", "agent")
	err = filepath.WalkDir(agentRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		file, parseErr := parser.ParseFile(s.fset, path, content, 0)
		if parseErr != nil {
			return parseErr
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		src := &source{path: filepath.ToSlash(rel), pkg: module + "/" + filepath.ToSlash(filepath.Dir(rel)), file: file, body: content, imports: map[string]string{}}
		for _, spec := range file.Imports {
			imported, _ := strconv.Unquote(spec.Path.Value)
			name := filepath.Base(imported)
			if spec.Name != nil {
				name = spec.Name.Name
			}
			src.imports[name] = imported
		}
		s.files = append(s.files, src)
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, src := range s.files {
		for _, decl := range src.file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				if typed, ok := spec.(*ast.TypeSpec); ok {
					s.types[src.pkg+"."+typed.Name.Name] = typeDecl{expr: typed.Type, src: src}
				}
			}
		}
	}
	return s, nil
}

func (s *scanner) fileFindings(src *source) []Finding {
	findings := []Finding{}
	for _, spec := range src.file.Imports {
		path, _ := strconv.Unquote(spec.Path.Value)
		if strings.Contains(path, "/internal/app") && pathBoundary(path, "/internal/app") || strings.Contains(path, "/internal/service") && pathBoundary(path, "/internal/service") {
			findings = append(findings, Finding{ID: src.path + ":import:" + path, Rule: "dependency", Value: 1, Detail: "Agent domain packages must not import app/service"})
		}
	}
	lines := len(strings.Split(strings.TrimSuffix(string(src.body), "\n"), "\n"))
	if lines > 600 {
		findings = append(findings, Finding{ID: src.path + ":file_lines", Rule: "file_lines", Value: lines, Limit: 600, Detail: "production Go file exceeds 600 lines"})
	}
	for _, decl := range src.file.Decls {
		switch typed := decl.(type) {
		case *ast.FuncDecl:
			findings = append(findings, s.functionFindings(src, typed)...)
		case *ast.GenDecl:
			findings = append(findings, s.exportedTypeFindings(src, typed)...)
		}
	}
	return findings
}

func pathBoundary(path, component string) bool {
	_, tail, ok := strings.Cut(path, component)
	return ok && (tail == "" || strings.HasPrefix(tail, "/"))
}
