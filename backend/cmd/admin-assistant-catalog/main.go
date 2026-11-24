// Command admin-assistant-catalog inventories the existing admin HTTP surface.
// It emits a reviewable allowlist; it never dispatches HTTP or executes methods.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"sort"
	"strconv"
	"strings"
)

type operation struct {
	Method     string   `json:"method"`
	Module     string   `json:"module"`
	Write      bool     `json:"write"`
	HighRisk   bool     `json:"highRisk"`
	Parameters []string `json:"parameters"`
	Routes     []string `json:"routes"`
}

func main() {
	fset := token.NewFileSet()
	apps, err := parser.ParseDir(fset, "internal/app", func(i os.FileInfo) bool { return !strings.HasSuffix(i.Name(), "_test.go") }, 0)
	must(err)
	methods := map[string]*ast.FuncDecl{}
	for _, f := range apps["app"].Files {
		for _, d := range f.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Recv == nil {
				continue
			}
			var b bytes.Buffer
			must(printer.Fprint(&b, fset, fn.Recv.List[0].Type))
			if b.String() == "*Service" {
				methods[fn.Name.Name] = fn
			}
		}
	}
	handlers, err := parser.ParseDir(fset, "internal/handler", func(i os.FileInfo) bool {
		return !strings.HasSuffix(i.Name(), "_test.go") && !strings.HasPrefix(i.Name(), "admin_assistant")
	}, 0)
	must(err)
	fileNames := []string{}
	for name := range handlers["handler"].Files {
		fileNames = append(fileNames, name)
	}
	sort.Strings(fileNames)
	handlerFiles := []*ast.File{}
	for _, name := range fileNames {
		handlerFiles = append(handlerFiles, handlers["handler"].Files[name])
	}
	ops := map[string]*operation{}
	// Resolve local Gin groups and handler closures before collecting routes.
	groups := map[*ast.File]map[string]string{}
	closures := map[*ast.File]map[string]ast.Node{}
	helpers := map[string]*ast.FuncDecl{}
	for _, f := range handlerFiles {
		for _, d := range f.Decls {
			if fn, ok := d.(*ast.FuncDecl); ok && fn.Recv == nil {
				helpers[fn.Name.Name] = fn
			}
		}
		groups[f] = map[string]string{}
		closures[f] = map[string]ast.Node{}
		ast.Inspect(f, func(n ast.Node) bool {
			a, ok := n.(*ast.AssignStmt)
			if !ok {
				return true
			}
			for i, rhs := range a.Rhs {
				if i >= len(a.Lhs) {
					continue
				}
				lhs, ok := a.Lhs[i].(*ast.Ident)
				if !ok {
					continue
				}
				if fn, ok := rhs.(*ast.FuncLit); ok {
					closures[f][lhs.Name] = fn
				}
				call, ok := rhs.(*ast.CallExpr)
				if !ok || len(call.Args) == 0 {
					continue
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Group" {
					continue
				}
				lit, ok := call.Args[0].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					continue
				}
				path, e := strconv.Unquote(lit.Value)
				if e == nil {
					groups[f][lhs.Name] = path
				}
			}
			return true
		})
	}
	for _, f := range handlerFiles {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) < 2 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			verb := sel.Sel.Name
			if !strings.Contains(" GET POST PUT PATCH DELETE HEAD ", " "+verb+" ") {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			path, err := strconv.Unquote(lit.Value)
			if err != nil {
				return true
			}
			if receiver, ok := sel.X.(*ast.Ident); ok {
				path = groups[f][receiver.Name] + path
			}
			admin := strings.HasPrefix(path, "/admin/")
			for _, arg := range call.Args[1:] {
				ast.Inspect(arg, func(n ast.Node) bool {
					if s, ok := n.(*ast.SelectorExpr); ok && s.Sel.Name == "RequireAdmin" {
						admin = true
					}
					return true
				})
			}
			if !admin {
				return true
			}
			for _, arg := range call.Args[1:] {
				var node ast.Node = arg
				if id, ok := arg.(*ast.Ident); ok {
					if closure := closures[f][id.Name]; closure != nil {
						node = closure
					}
				}
				visited := map[string]bool{}
				var visit func(ast.Node) bool
				visit = func(n ast.Node) bool {
					c, ok := n.(*ast.CallExpr)
					if !ok {
						return true
					}
					if id, ok := c.Fun.(*ast.Ident); ok && id.Name != "currentUser" && !visited[id.Name] {
						if helper := helpers[id.Name]; helper != nil {
							hasService := false
							for _, a := range c.Args {
								if ident, ok := a.(*ast.Ident); ok && ident.Name == "svc" {
									hasService = true
								}
							}
							if hasService {
								visited[id.Name] = true
								ast.Inspect(helper.Body, visit)
							}
						}
					}
					s, ok := c.Fun.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					id, ok := s.X.(*ast.Ident)
					if !ok || id.Name != "svc" {
						return true
					}
					fn := methods[s.Sel.Name]
					if fn == nil || s.Sel.Name == "RequireAdmin" {
						return true
					}
					op := ops[s.Sel.Name]
					if op == nil {
						op = &operation{Method: s.Sel.Name, Module: strings.Split(strings.TrimPrefix(path, "/admin/"), "/")[0], Parameters: []string{}, Routes: []string{}}
						for _, p := range fn.Type.Params.List {
							var b bytes.Buffer
							must(printer.Fprint(&b, fset, p.Type))
							t := b.String()
							if t == "context.Context" || t == "*model.User" {
								continue
							}
							for _, name := range p.Names {
								op.Parameters = append(op.Parameters, name.Name)
							}
						}
						ops[op.Method] = op
					}
					route := verb + " " + path
					found := false
					for _, r := range op.Routes {
						if r == route {
							found = true
						}
					}
					if !found {
						op.Routes = append(op.Routes, route)
					}
					if verb != "GET" && verb != "HEAD" {
						op.Write = true
					}
					return true
				}
				ast.Inspect(node, visit)
			}
			return true
		})
	}
	// Grouped routes and helper closures do not have a literal /admin prefix.
	// Include every explicitly admin-gated service entrypoint as well.
	for name, fn := range methods {
		if !ast.IsExported(name) || name == "RequireAdmin" || strings.HasPrefix(name, "Assistant") || strings.Contains(name, "Assistant") {
			continue
		}
		admin := false
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if c, ok := n.(*ast.CallExpr); ok {
				if s, ok := c.Fun.(*ast.SelectorExpr); ok && s.Sel.Name == "RequireAdmin" {
					admin = true
				}
			}
			return true
		})
		if !admin {
			continue
		}
		if _, ok := ops[name]; ok {
			continue
		}
		module := "settings"
		lower := strings.ToLower(name)
		for _, m := range []struct{ word, module string }{{"plugin", "plugins"}, {"payment", "payments"}, {"topup", "payments"}, {"mcp", "mcp"}, {"ecommerce", "ecommerce"}, {"skill", "skills"}, {"feedback", "feedbacks"}, {"prompt", "prompt-templates"}, {"model", "channel-models"}, {"channel", "channels"}, {"user", "users"}, {"resource", "resources"}, {"announcement", "announcements"}, {"update", "system-update"}, {"pose", "pose-library"}, {"inspiration", "inspiration-feed"}, {"workbench", "workbench-tools"}} {
			if strings.Contains(lower, m.word) {
				module = m.module
				break
			}
		}
		op := &operation{Method: name, Module: module, Write: true, HighRisk: true, Parameters: []string{}, Routes: []string{}}
		if strings.HasPrefix(name, "Admin") || strings.HasPrefix(name, "List") || strings.HasPrefix(name, "Get") {
			op.Write = false
			for _, word := range []string{"Create", "Update", "Delete", "Set", "Save", "Install", "Start", "Test", "Check", "Clear", "Adjust", "Reconcile", "Import", "Archive", "Cancel", "Disable", "Grant"} {
				if strings.Contains(name, word) {
					op.Write = true
				}
			}
			op.HighRisk = op.Write
		}
		for _, p := range fn.Type.Params.List {
			var b bytes.Buffer
			must(printer.Fprint(&b, fset, p.Type))
			t := b.String()
			if t == "context.Context" || t == "*model.User" {
				continue
			}
			for _, v := range p.Names {
				op.Parameters = append(op.Parameters, v.Name)
			}
		}
		ops[name] = op
	}
	// These shared user/admin methods select admin scope explicitly at runtime.
	for _, name := range []string{"MCPCatalog", "MCPConnections", "SaveMCPConnection", "DeleteMCPConnection", "TestMCPConnection", "SaveMCPTemplate", "DeleteMCPTemplate", "PluginPackage", "Plugins"} {
		if _, ok := ops[name]; ok {
			continue
		}
		fn := methods[name]
		if fn == nil {
			panic("missing method " + name)
		}
		module := "mcp"
		if strings.Contains(name, "Plugin") {
			module = "plugins"
		}
		write := strings.HasPrefix(name, "Save") || strings.HasPrefix(name, "Delete") || strings.HasPrefix(name, "Test")
		op := &operation{Method: name, Module: module, Write: write, HighRisk: write, Parameters: []string{}, Routes: []string{}}
		for _, p := range fn.Type.Params.List {
			var b bytes.Buffer
			must(printer.Fprint(&b, fset, p.Type))
			if b.String() == "context.Context" || b.String() == "*model.User" {
				continue
			}
			for _, v := range p.Names {
				op.Parameters = append(op.Parameters, v.Name)
			}
		}
		ops[name] = op
	}
	list := []*operation{}
	for _, op := range ops {
		if op.Module == "" {
			switch {
			case strings.Contains(op.Method, "Plugin"):
				op.Module = "plugins"
			case strings.Contains(op.Method, "Ecommerce"):
				op.Module = "ecommerce"
			case strings.Contains(op.Method, "Channel"):
				op.Module = "channels"
			default:
				panic("operation requires an explicit module: " + op.Method)
			}
		}
		// Fail closed: new writes require confirmation until deliberately reviewed.
		for _, prefix := range []string{"Create", "Update", "Delete", "Set", "Import", "Install", "Start", "Sync", "Test", "Save", "Ensure", "Clear", "Reset", "Bulk", "Adjust", "Reconcile", "Approve", "Reject", "Cancel", "Archive", "Publish", "Unpublish", "Duplicate", "Upload", "Run", "Review", "Complete"} {
			if strings.HasPrefix(op.Method, prefix) {
				op.Write = true
			}
		}
		for _, name := range []string{"EcommerceKnowledgeEntryPage", "EcommerceOrchestrationSetting", "FeishuFeedbackSettings", "OpenResourceRangeAsAdmin", "PluginPackage", "Plugins", "PrepareUpdateAnnouncementDelivery", "PreviewAdminChannelModels", "AdminChannelOrder", "AdminAppearance", "AdminFeatureAvailability", "RuntimePolicy"} {
			if op.Method == name {
				op.Write = false
			}
		}
		if op.Method == "RuntimePolicy" {
			op.Module = "settings"
		}
		op.HighRisk = op.Write
		for _, prefix := range []string{"CreateSystemChannel", "UpdateSystemChannel", "DuplicateSystemChannel", "AdminEditSkill", "AdminUpdateSkill", "UpdatePromptTemplate", "CreatePromptTemplate", "UpdateAnnouncement", "CreateAnnouncement", "UpdateBannerAnnouncement", "CreateBannerAnnouncement"} {
			if strings.HasPrefix(op.Method, prefix) {
				op.HighRisk = false
			}
		}
		// A read-looking HTTP route may still start work or create state.
		for _, prefix := range []string{"Create", "Update", "Delete", "Set", "Import", "Install", "Start", "Sync", "Test", "Save", "Ensure", "Clear", "Reset", "Bulk", "Adjust", "Reconcile", "Approve", "Reject", "Cancel", "Archive", "Publish", "Unpublish", "Duplicate"} {
			if strings.HasPrefix(op.Method, prefix) {
				op.Write = true
			}
		}
		if op.Write && !op.HighRisk { // ordinary channel edits cannot modify auth/storage/admin permissions
			if strings.Contains(strings.ToLower(op.Method), "delete") {
				op.HighRisk = true
			}
		}
		sort.Strings(op.Routes)
		list = append(list, op)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Method < list[j].Method })
	data, err := json.MarshalIndent(list, "", "  ")
	must(err)
	fmt.Println(string(data))
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
