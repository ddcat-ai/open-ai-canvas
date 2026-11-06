// Package emailtpl 渲染系统邮件的 HTML 与纯文本正文。只做展示，不读写数据库、不发信。
//
// 邮件客户端（Gmail、Outlook、QQ 邮箱、Apple Mail）普遍不执行脚本、会剥离 <style> 和 SVG，
// 因此版式全部使用表格 + 行内样式，图表用带 bgcolor 的表格单元格绘制。
package emailtpl

import (
	"bytes"
	"html/template"
	"strings"
)

const (
	colorPage    = "#f4f4f6"
	colorCard    = "#ffffff"
	colorLine    = "#e6e6eb"
	colorText    = "#16161a"
	colorMuted   = "#6e6e78"
	colorFaint   = "#9a9aa3"
	colorSurface = "#f6f6f8"
	colorAccent  = "#3b5bfd"
)

var funcs = template.FuncMap{
	"upper": strings.ToUpper,
}

const layoutHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{.Title}}</title>
</head>
<body style="margin:0;padding:0;background:` + colorPage + `;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">{{.Preheader}}&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="` + colorPage + `" style="background:` + colorPage + `;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="{{.Width}}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:{{.Width}}px;">
<tr><td style="padding:0 4px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="28" height="28" align="center" valign="middle" bgcolor="` + colorText + `" style="width:28px;height:28px;border-radius:8px;color:#ffffff;font-size:14px;font-weight:700;line-height:28px;">{{.BrandInitial}}</td>
<td style="padding-left:10px;font-size:15px;font-weight:600;color:` + colorText + `;letter-spacing:0.2px;">{{.Brand}}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="` + colorCard + `" style="background:` + colorCard + `;border:1px solid ` + colorLine + `;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif;color:` + colorText + `;">
{{.Body}}
</td></tr>
<tr><td style="padding:24px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:` + colorFaint + `;text-align:center;">
{{.FooterNote}}<br>此邮件由系统自动发送，请勿直接回复。<br>&copy; {{.Brand}}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

var layoutTemplate = template.Must(template.New("layout").Funcs(funcs).Parse(layoutHTML))

type layoutData struct {
	Title        string
	Preheader    string
	Brand        string
	BrandInitial string
	Width        int
	Body         template.HTML
	FooterNote   string
}

func renderLayout(data layoutData) (string, error) {
	if data.Width == 0 {
		data.Width = 560
	}
	data.BrandInitial = brandInitial(data.Brand)
	var out bytes.Buffer
	if err := layoutTemplate.Execute(&out, data); err != nil {
		return "", err
	}
	return out.String(), nil
}

func renderPart(tpl *template.Template, data any) (template.HTML, error) {
	var out bytes.Buffer
	if err := tpl.Execute(&out, data); err != nil {
		return "", err
	}
	// 片段由 html/template 渲染，变量已按上下文转义。
	return template.HTML(out.String()), nil
}

func brandInitial(brand string) string {
	for _, r := range strings.TrimSpace(brand) {
		return strings.ToUpper(string(r))
	}
	return "·"
}
