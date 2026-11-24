package emailtpl

import (
	"html/template"
	"strconv"
	"strings"
)

// CodeEmail 是一次性验证码邮件。Code 只出现在正文与标题里，调用方不得写入日志。
type CodeEmail struct {
	Brand string
	// Heading 是正文标题，如“重置密码”。
	Heading string
	// SubjectLabel 是标题里的验证码名称，如“密码重置验证码”；留空时为 Heading + “验证码”。
	SubjectLabel string
	// Intro 说明用途，如“你正在重置 影策 账号密码，请在页面中输入以下验证码。”
	Intro       string
	Code        string
	TTLMinutes  int
	Recipient   string
	SecurityTip string
}

// Rendered 是一封邮件的两种正文。
type Rendered struct {
	Subject string
	Text    string
	HTML    string
}

const codeBodyHTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 8px;">
<div style="font-size:24px;line-height:32px;font-weight:700;color:` + colorText + `;letter-spacing:-0.2px;">{{.Heading}}</div>
<div style="padding-top:12px;font-size:15px;line-height:24px;color:` + colorMuted + `;">{{.Intro}}</div>
</td></tr>
<tr><td style="padding:24px 40px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="` + colorSurface + `" style="background:` + colorSurface + `;border:1px solid ` + colorLine + `;border-radius:12px;">
<tr><td align="center" style="padding:28px 16px 10px;">
<span style="display:inline-block;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Roboto Mono','Courier New',monospace;font-size:38px;line-height:44px;font-weight:700;letter-spacing:10px;color:` + colorText + `;-webkit-user-select:all;user-select:all;padding-left:10px;">{{.Code}}</span>
</td></tr>
<tr><td align="center" style="padding:0 16px 22px;font-size:12px;line-height:18px;color:` + colorFaint + `;">双击或长按验证码即可选中复制</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:` + colorMuted + `;"><span style="color:` + colorAccent + `;">●</span>&nbsp;&nbsp;{{.TTLMinutes}} 分钟内有效，只能使用一次</td></tr>
{{if .Recipient}}<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:` + colorMuted + `;"><span style="color:` + colorAccent + `;">●</span>&nbsp;&nbsp;发送至 {{.Recipient}}</td></tr>{{end}}
<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:` + colorMuted + `;"><span style="color:` + colorAccent + `;">●</span>&nbsp;&nbsp;{{.Brand}} 的工作人员不会向你索要验证码</td></tr>
</table>
</td></tr>
<tr><td style="padding:28px 40px 36px;">
<div style="border-top:1px solid ` + colorLine + `;padding-top:20px;font-size:13px;line-height:21px;color:` + colorFaint + `;">{{.SecurityTip}}</div>
</td></tr>
</table>`

var codeBodyTemplate = template.Must(template.New("code").Parse(codeBodyHTML))

// RenderCode 生成验证码邮件。标题把验证码放在最前，通知栏和收件箱列表无需打开邮件即可看到。
func RenderCode(mail CodeEmail) (Rendered, error) {
	if mail.TTLMinutes <= 0 {
		mail.TTLMinutes = 10
	}
	if strings.TrimSpace(mail.SecurityTip) == "" {
		mail.SecurityTip = "如果这不是你本人的操作，请忽略本邮件，你的账号不会有任何变化。"
	}
	body, err := renderPart(codeBodyTemplate, mail)
	if err != nil {
		return Rendered{}, err
	}
	html, err := renderLayout(layoutData{
		Title:      mail.Heading,
		Preheader:  mail.Code + " 是你的验证码，" + itoa(mail.TTLMinutes) + " 分钟内有效。",
		Brand:      mail.Brand,
		Body:       body,
		FooterNote: "你收到这封邮件，是因为有人在 " + mail.Brand + " 使用了这个邮箱地址。",
	})
	if err != nil {
		return Rendered{}, err
	}
	// 纯文本正文保留“验证码：xxxxxx”独立一行，不支持 HTML 的客户端也能直接复制。
	text := mail.Intro + "\n\n验证码：" + mail.Code + "\n\n" + itoa(mail.TTLMinutes) + " 分钟内有效，只能使用一次。请勿向任何人透露验证码。\n" + mail.SecurityTip + "\n\n— " + mail.Brand
	label := mail.SubjectLabel
	if label == "" {
		label = mail.Heading + "验证码"
	}
	return Rendered{Subject: mail.Code + " 是你的" + mail.Brand + label, Text: text, HTML: html}, nil
}

// NoticeEmail 是不含验证码的账号通知，如邮箱变更提醒、测试邮件。
type NoticeEmail struct {
	Brand   string
	Subject string
	Heading string
	Lines   []string
	Tip     string
}

const noticeBodyHTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 4px;">
<div style="font-size:24px;line-height:32px;font-weight:700;color:` + colorText + `;letter-spacing:-0.2px;">{{.Heading}}</div>
</td></tr>
{{range .Lines}}<tr><td style="padding:12px 40px 0;font-size:15px;line-height:24px;color:` + colorMuted + `;">{{.}}</td></tr>{{end}}
<tr><td style="padding:28px 40px 36px;">
<div style="border-top:1px solid ` + colorLine + `;padding-top:20px;font-size:13px;line-height:21px;color:` + colorFaint + `;">{{.Tip}}</div>
</td></tr>
</table>`

var noticeBodyTemplate = template.Must(template.New("notice").Parse(noticeBodyHTML))

func RenderNotice(mail NoticeEmail) (Rendered, error) {
	body, err := renderPart(noticeBodyTemplate, mail)
	if err != nil {
		return Rendered{}, err
	}
	preheader := mail.Heading
	if len(mail.Lines) > 0 {
		preheader = mail.Lines[0]
	}
	html, err := renderLayout(layoutData{Title: mail.Heading, Preheader: preheader, Brand: mail.Brand, Body: body, FooterNote: "这是一封来自 " + mail.Brand + " 的账号通知。"})
	if err != nil {
		return Rendered{}, err
	}
	text := mail.Heading + "\n\n" + strings.Join(mail.Lines, "\n") + "\n\n" + mail.Tip + "\n\n— " + mail.Brand
	return Rendered{Subject: mail.Subject, Text: text, HTML: html}, nil
}

func itoa(value int) string { return strconv.Itoa(value) }
