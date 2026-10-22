package architecture

import (
	"go/ast"
	"go/token"
	"strings"
)

func (s *scanner) functionFindings(src *source, fn *ast.FuncDecl) []Finding {
	name := functionName(fn)
	findings := []Finding{}
	if fn.Body != nil {
		lines := s.fset.Position(fn.End()).Line - s.fset.Position(fn.Pos()).Line + 1
		if lines > 120 {
			findings = append(findings, Finding{ID: src.path + ":func:" + name + ":lines", Rule: "function_lines", Value: lines, Limit: 120, Detail: "function exceeds 120 lines"})
		}
		complexity := cyclomatic(fn.Body)
		if complexity > 20 {
			findings = append(findings, Finding{ID: src.path + ":func:" + name + ":complexity", Rule: "complexity", Value: complexity, Limit: 20, Detail: "cyclomatic complexity exceeds 20"})
		}
	}
	if ast.IsExported(fn.Name.Name) && s.containsUntypedMap(fn.Type, src, map[string]bool{}) {
		findings = append(findings, signatureFinding(src.path, name))
	}
	return findings
}

func (s *scanner) exportedTypeFindings(src *source, decl *ast.GenDecl) []Finding {
	findings := []Finding{}
	for _, spec := range decl.Specs {
		typed, ok := spec.(*ast.TypeSpec)
		if !ok || !ast.IsExported(typed.Name.Name) {
			continue
		}
		if fields, ok := typed.Type.(*ast.StructType); ok {
			for _, field := range fields.Fields.List {
				if !s.containsUntypedMap(field.Type, src, map[string]bool{}) {
					continue
				}
				for _, name := range field.Names {
					if ast.IsExported(name.Name) {
						findings = append(findings, signatureFinding(src.path, typed.Name.Name+"."+name.Name))
					}
				}
				if len(field.Names) == 0 {
					findings = append(findings, signatureFinding(src.path, typed.Name.Name+".embedded"))
				}
			}
			continue
		}
		if s.containsUntypedMap(typed.Type, src, map[string]bool{}) {
			findings = append(findings, signatureFinding(src.path, typed.Name.Name))
		}
	}
	return findings
}

func signatureFinding(path, name string) Finding {
	return Finding{ID: path + ":signature:" + name, Rule: "untyped_protocol_map", Value: 1, Limit: 0, Detail: "exported protocol exposes an untyped map; use a DTO or json.RawMessage at the serialization boundary"}
}

func functionName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	return receiverName(fn.Recv.List[0].Type) + "." + fn.Name.Name
}

func receiverName(expr ast.Expr) string {
	switch typed := expr.(type) {
	case *ast.StarExpr:
		return receiverName(typed.X)
	case *ast.IndexExpr:
		return receiverName(typed.X)
	case *ast.IndexListExpr:
		return receiverName(typed.X)
	case *ast.Ident:
		return typed.Name
	default:
		return "receiver"
	}
}

func cyclomatic(body *ast.BlockStmt) int {
	complexity := 1
	ast.Inspect(body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.FuncLit:
			return false
		case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt:
			complexity++
		case *ast.CaseClause:
			if typed.List != nil {
				complexity++
			}
		case *ast.CommClause:
			if typed.Comm != nil {
				complexity++
			}
		case *ast.BinaryExpr:
			if typed.Op == token.LAND || typed.Op == token.LOR {
				complexity++
			}
		}
		return true
	})
	return complexity
}

func (s *scanner) containsUntypedMap(expr ast.Expr, src *source, seen map[string]bool) bool {
	if expr == nil {
		return false
	}
	if m, ok := expr.(*ast.MapType); ok && s.containsAny(m.Value, src, map[string]bool{}) {
		return true
	}
	if resolved, owner, key, ok := s.resolve(expr, src); ok {
		if seen[key] {
			return false
		}
		seen[key] = true
		return s.containsUntypedMap(resolved, owner, seen)
	}
	for _, child := range expressionChildren(expr) {
		if s.containsUntypedMap(child, src, seen) {
			return true
		}
	}
	return false
}

func (s *scanner) containsAny(expr ast.Expr, src *source, seen map[string]bool) bool {
	if ident, ok := expr.(*ast.Ident); ok && ident.Name == "any" {
		return true
	}
	if iface, ok := expr.(*ast.InterfaceType); ok && len(iface.Methods.List) == 0 {
		return true
	}
	if resolved, owner, key, ok := s.resolve(expr, src); ok {
		if seen[key] {
			return false
		}
		seen[key] = true
		return s.containsAny(resolved, owner, seen)
	}
	for _, child := range expressionChildren(expr) {
		if s.containsAny(child, src, seen) {
			return true
		}
	}
	return false
}

func (s *scanner) resolve(expr ast.Expr, src *source) (ast.Expr, *source, string, bool) {
	key := ""
	switch typed := expr.(type) {
	case *ast.Ident:
		key = src.pkg + "." + typed.Name
	case *ast.SelectorExpr:
		if name, ok := typed.X.(*ast.Ident); ok {
			key = src.imports[name.Name] + "." + typed.Sel.Name
		}
	}
	decl, ok := s.types[key]
	return decl.expr, decl.src, key, ok
}

func expressionChildren(expr ast.Expr) []ast.Expr {
	out := []ast.Expr{}
	fields := func(list *ast.FieldList, exportedOnly bool) {
		if list == nil {
			return
		}
		for _, field := range list.List {
			visible := !exportedOnly || len(field.Names) == 0
			for _, name := range field.Names {
				visible = visible || ast.IsExported(name.Name)
			}
			if visible {
				out = append(out, field.Type)
			}
		}
	}
	switch typed := expr.(type) {
	case *ast.MapType:
		out = append(out, typed.Key, typed.Value)
	case *ast.ArrayType:
		out = append(out, typed.Elt)
	case *ast.StarExpr:
		out = append(out, typed.X)
	case *ast.ParenExpr:
		out = append(out, typed.X)
	case *ast.Ellipsis:
		out = append(out, typed.Elt)
	case *ast.ChanType:
		out = append(out, typed.Value)
	case *ast.FuncType:
		fields(typed.Params, false)
		fields(typed.Results, false)
	case *ast.InterfaceType:
		fields(typed.Methods, true)
	case *ast.StructType:
		fields(typed.Fields, true)
	case *ast.IndexExpr:
		out = append(out, typed.X, typed.Index)
	case *ast.IndexListExpr:
		out = append(out, typed.X)
		out = append(out, typed.Indices...)
	}
	return out
}

func FormatFindings(findings []Finding) string {
	var text strings.Builder
	for _, finding := range findings {
		text.WriteString(finding.ID + ": " + finding.Detail + "\n")
	}
	return text.String()
}
