package app

import (
	"go/ast"
	"go/parser"
	"go/token"
	"sort"
	"strings"
	"testing"
)

// 本文件是一致性守卫：工具表（模型看到的契约）与运行期分派必须始终一致。
//
// 一个工具要真正可用必须同时出现在三处：compileCloudAgentTools 里的 add("name", …) 注册、
// advanceCloudAgentTool / cloudAgentReadTool 的运行期分派、以及 CloudAgentSupportedToolNames()
// 暴露的平台支持集合。只改其中一两处时，工具对模型不可见、或调用直接落到 default 分支，
// 而既有测试（包括工具 schema 预算用例与能力注册表契约用例）依然全绿——这类"半注册"退化
// 必须在 CI 立刻变红，而不是等用户发现工具不生效。
//
// 实现方式与取舍：advanceCloudAgentTool 的分派是写在事务闭包里的 switch，没有可注入的
// 分派表，纯行为断言覆盖不到"某个工具名有没有分支"（会被运行期提前 return 掩盖）；
// 因此这里用 go/ast 读源码抽取集合再做集合断言——检查的正是"分派有没有写"。
func TestCloudAgentToolTableMatchesRuntimeDispatch(t *testing.T) {
	registered := cloudAgentRegisteredToolNames(t)
	supported := CloudAgentSupportedToolNames()
	dispatched := cloudAgentDispatchedToolNames(t)

	// 1. 平台支持集合里每个名字都能被执行分派处理（读/写两条分派路径都算）。
	missing := difference(supported, dispatched)
	if len(missing) > 0 {
		t.Fatalf("平台声明支持但运行期没有分派分支的工具：%s", strings.Join(missing, ", "))
	}

	// 2. 工具表里所有 add(...) 注册的名字都有分派分支（集合相等，而不是子集）。
	if extra := difference(dispatched, registered); len(extra) > 0 {
		t.Fatalf("运行期有分派分支但没有注册进工具表的工具：%s", strings.Join(extra, ", "))
	}
	if missing := difference(registered, dispatched); len(missing) > 0 {
		t.Fatalf("工具表注册了但没有分派分支的工具：%s", strings.Join(missing, ", "))
	}
	// 工具表全集必须与 CloudAgentSupportedToolNames() 逐一相同（后者从工具表派生，
	// 这条断言守的是"派生用的请求确实覆盖了所有条件暴露的分支"）。
	if missing := difference(registered, supported); len(missing) > 0 {
		t.Fatalf("CloudAgentSupportedToolNames() 漏掉了工具表里的：%s", strings.Join(missing, ", "))
	}
	if missing := difference(supported, registered); len(missing) > 0 {
		t.Fatalf("CloudAgentSupportedToolNames() 多出了工具表里没有的：%s", strings.Join(missing, ", "))
	}

	// 3. cloudAgentWrite 判定为"写操作"的名字必须已注册且有分派分支。
	// 上游语义下这张名单同时决定审批链（approval 分支按 cloudAgentWrite(...) 判定），
	// 漏一个就等于该工具绕过用户审批，因此单独守一条。
	writes := cloudAgentWriteToolNames(t)
	if extra := difference(writes, registered); len(extra) > 0 {
		t.Fatalf("被判为写操作但不在工具表里的工具：%s", strings.Join(extra, ", "))
	}
	if missing := difference(writes, dispatched); len(missing) > 0 {
		t.Fatalf("被判为写操作但没有分派分支的工具：%s", strings.Join(missing, ", "))
	}
}

// cloudAgentRegisteredToolNames 收集 compileCloudAgentTools 里所有 add("name", …) 的名字全集。
func cloudAgentRegisteredToolNames(t *testing.T) []string {
	t.Helper()
	file := parseCloudAgentFile(t, "cloud_agent_tools.go")
	names := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		ident, ok := call.Fun.(*ast.Ident)
		if !ok || ident.Name != "add" || len(call.Args) == 0 {
			return true
		}
		if literal, ok := call.Args[0].(*ast.BasicLit); ok && literal.Kind == token.STRING {
			names[strings.Trim(literal.Value, `"`)] = true
		}
		return true
	})
	if len(names) == 0 {
		t.Fatal("没有从 cloud_agent_tools.go 解析到任何 add(...) 工具注册")
	}
	return sortedKeys(names)
}

// cloudAgentWriteToolNames 收集 cloudAgentWrite 里的工具名字面量。
// 该函数是 name == "..." 的布尔表达式（不是 switch），因此直接收集函数体里的字符串字面量。
func cloudAgentWriteToolNames(t *testing.T) []string {
	t.Helper()
	file := parseCloudAgentFile(t, "cloud_agent_tools.go")
	names := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		decl, ok := node.(*ast.FuncDecl)
		if !ok || decl.Name.Name != "cloudAgentWrite" || decl.Body == nil {
			return true
		}
		collectStringLiterals(decl.Body, names)
		return false
	})
	if len(names) == 0 {
		t.Fatal("没有解析到 cloudAgentWrite 的工具名")
	}
	return sortedKeys(names)
}

// cloudAgentDispatchedToolNames 收集运行期两条分派路径覆盖的工具名：
// advanceCloudAgentTool（含审批预演、主执行 switch 与媒体/看图等特例分支）与
// cloudAgentReadTool（默认读取分派）。
func cloudAgentDispatchedToolNames(t *testing.T) []string {
	t.Helper()
	names := map[string]bool{}
	for _, target := range []struct {
		file string
		fn   string
	}{
		{"cloud_agent_runtime.go", "advanceCloudAgentTool"},
		{"cloud_agent_tools.go", "cloudAgentReadTool"},
	} {
		file := parseCloudAgentFile(t, target.file)
		found := false
		ast.Inspect(file, func(node ast.Node) bool {
			decl, ok := node.(*ast.FuncDecl)
			if !ok || decl.Name.Name != target.fn || decl.Body == nil {
				return true
			}
			found = true
			collectToolNameBranches(decl.Body, names)
			return false
		})
		if !found {
			t.Fatalf("%s 里找不到 %s：分派实现被重命名或搬走了，守卫需要同步更新", target.file, target.fn)
		}
	}
	if len(names) == 0 {
		t.Fatal("没有解析到任何分派分支的工具名")
	}
	return sortedKeys(names)
}

// collectToolNameBranches 收集两处分派写法涉及的工具名字面量：
//   - `call.Function.Name == "x"`（含嵌套在 && / || 里的）
//   - `switch call.Function.Name { case "x", "y": … }`
func collectToolNameBranches(body *ast.BlockStmt, out map[string]bool) {
	ast.Inspect(body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.BinaryExpr:
			if typed.Op != token.EQL {
				return true
			}
			if literal, ok := comparedToolName(typed); ok {
				out[literal] = true
			}
		case *ast.SwitchStmt:
			if !isFunctionNameSelector(typed.Tag) {
				return true
			}
			for _, item := range typed.Body.List {
				clause, ok := item.(*ast.CaseClause)
				if !ok {
					continue
				}
				collectStringLiteralsOf(clause.List, out)
			}
		}
		return true
	})
}

// comparedToolName 判断 `X == "name"` 形式里 X 是不是 `…Function.Name`，返回字面量。
func comparedToolName(binary *ast.BinaryExpr) (string, bool) {
	for _, pair := range [][2]ast.Expr{{binary.X, binary.Y}, {binary.Y, binary.X}} {
		if !isFunctionNameSelector(pair[0]) {
			continue
		}
		if literal, ok := pair[1].(*ast.BasicLit); ok && literal.Kind == token.STRING {
			return strings.Trim(literal.Value, `"`), true
		}
	}
	return "", false
}

// isFunctionNameSelector 判断表达式是否是 `X.Function.Name`（工具调用名的统一读法）。
func isFunctionNameSelector(node ast.Node) bool {
	outer, ok := node.(*ast.SelectorExpr)
	if !ok || outer.Sel.Name != "Name" {
		return false
	}
	inner, ok := outer.X.(*ast.SelectorExpr)
	if !ok || inner.Sel.Name != "Function" {
		return false
	}
	_, ok = inner.X.(*ast.Ident)
	return ok
}

func collectStringLiterals(node ast.Node, out map[string]bool) {
	ast.Inspect(node, func(item ast.Node) bool {
		literal, ok := item.(*ast.BasicLit)
		if ok && literal.Kind == token.STRING {
			out[strings.Trim(literal.Value, `"`)] = true
		}
		return true
	})
}

func collectStringLiteralsOf(nodes []ast.Expr, out map[string]bool) {
	for _, node := range nodes {
		collectStringLiterals(node, out)
	}
}

func parseCloudAgentFile(t *testing.T, name string) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), name, nil, 0)
	if err != nil {
		t.Fatalf("解析 %s 失败：%v", name, err)
	}
	return file
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func difference(from, without []string) []string {
	index := make(map[string]bool, len(without))
	for _, item := range without {
		index[item] = true
	}
	diff := make([]string, 0)
	for _, item := range from {
		if !index[item] {
			diff = append(diff, item)
		}
	}
	return diff
}
