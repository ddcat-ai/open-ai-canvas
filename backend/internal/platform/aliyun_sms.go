package platform

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// 阿里云短信（Dysmsapi 2017-05-25）—— **自行实现签名，零外部依赖**。
//
// 为什么不用官方 SDK：这个产品只需要 `SendSms` 一个接口，官方 Go SDK 会带进一大串传递依赖；
// 而阿里云明确支持自签名对接（Dysmsapi 是 **RPC 风格**，签名规范公开且稳定）。
//
// 签名三步（官方《为 RPC API 请求计算签名》）：
//
//	canonical    = "&".join(sorted(percentEncode(k) + "=" + percentEncode(v)))
//	StringToSign = HTTPMethod + "&" + percentEncode("/") + "&" + percentEncode(canonical)
//	Signature    = base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))
//
// ⚠️ `percentEncode` 与标准库的 `url.QueryEscape` **不是一回事**，必须做那三处替换
// （`+`→`%20`、`*`→`%2A`、`%7E`→`~`）—— 少一处签名就对不上，且报错只有一句
// `SignatureDoesNotMatch`，很难查。这一条由 `aliyun_sms_test.go` 的测试向量钉住。

const (
	// aliyunSmsDefaultEndpoint 是短信服务的公网入口。
	aliyunSmsDefaultEndpoint = "https://dysmsapi.aliyuncs.com/"
	// aliyunSmsAPIVersion 是 Dysmsapi 的版本号（拼在公共参数里）。
	aliyunSmsAPIVersion = "2017-05-25"
	// aliyunSmsSendTimeout 单次发送超时。验证码场景**不重试** —— 宁可让用户再点一次，
	// 也不要在上游其实发成功了的情况下重复发送（阿里云同号有 1 分钟频控，重试基本也发不出去）。
	aliyunSmsSendTimeout = 10 * time.Second
)

// AliyunSmsConfig 一次发送需要的全部参数（由后台「短信服务」配置页提供）。
type AliyunSmsConfig struct {
	AccessKeyId     string
	AccessKeySecret string
	/** 短信签名（控制台申请并审核通过的签名名称）。 */
	SignName string
	/** 短信模板 CODE（如 `SMS_153055065`）。 */
	TemplateCode string
	/** 区域，默认 cn-hangzhou（短信服务是全局的，但公共参数要求带）。 */
	RegionId string
	/** 仅测试用：覆盖入口地址（`httptest` 假服务器）。 */
	Endpoint string
}

// AliyunSmsError 上游返回的业务错误（Code 是阿里云的机器码，如 `isv.SMS_SIGNATURE_ILLEGAL`）。
type AliyunSmsError struct {
	Code      string
	Message   string
	RequestId string
}

func (e *AliyunSmsError) Error() string {
	return fmt.Sprintf("阿里云短信发送失败：%s（%s，请求号 %s）", aliyunSmsMessage(e.Code, e.Message), e.Code, e.RequestId)
}

// aliyunSmsMessage 把常见错误码翻成**能直接给管理员看**的中文。
//
// 这些码是排查"为什么发不出去"的唯一线索（签名没审核过、模板没审核过、被限流、欠费…），
// 所以全部保留原文，只做翻译；未知码原样回显 Code+Message。
func aliyunSmsMessage(code, message string) string {
	switch code {
	case "isv.SMS_SIGNATURE_ILLEGAL":
		return "短信签名不合法（控制台里可能还没审核通过，或与模板不匹配）"
	case "isv.SMS_TEMPLATE_ILLEGAL":
		return "短信模板不合法（模板 CODE 写错，或还没审核通过）"
	case "isv.SMS_PARAMETERS_ILLEGAL":
		return "短信模板参数与模板内容不匹配（检查模板里的变量名）"
	case "isv.MOBILE_NUMBER_ILLEGAL":
		return "手机号格式不合法"
	case "isv.BUSINESS_LIMIT_CONTROL":
		return "触发阿里云的发送频率限制（同一号码 1 分钟内只能发 1 条、1 小时 5 条、1 天 10 条）"
	case "isv.AMOUNT_NOT_ENOUGH", "isv.ACCOUNT_BALANCE_NOT_ENOUGH":
		return "阿里云账户余额或套餐包不足"
	case "isv.OUT_OF_SERVICE", "isv.SERVICE_UNSUPPORTED":
		return "短信服务已停用或该业务不支持"
	case "isv.ACCOUNT_NOT_EXISTS", "isv.ACCOUNT_ABNORMAL":
		return "阿里云账号异常（AccessKey 对应的账号状态不对）"
	case "SignatureDoesNotMatch":
		return "签名校验失败（AccessKey Secret 填错了）"
	case "InvalidAccessKeyId.NotFound", "InvalidAccessKeyId":
		return "AccessKey ID 不存在（填错了或已被删除）"
	}
	if strings.TrimSpace(message) == "" {
		return code
	}
	return message
}

// percentEncode 阿里云 RPC 签名专用的 URL 编码。
//
// ⚠️ 在 `url.QueryEscape` 基础上做**三处替换**，少一处签名就对不上：
//   - `+`   → `%20`（空格的正确编码；QueryEscape 会编成 `+`）
//   - `*`   → `%2A`
//   - `%7E` → `~`（波浪号本就不该被编码）
func percentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

// aliyunSmsSignature 按 RPC 规范算签名。
func aliyunSmsSignature(method string, params map[string]string, accessKeySecret string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		if key == "Signature" {
			continue
		}
		keys = append(keys, key)
	}
	// 按**参数名的字典序**（字节序）排序 —— 官方规范里就是这么要求的。
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, percentEncode(key)+"="+percentEncode(params[key]))
	}
	canonical := strings.Join(parts, "&")
	stringToSign := method + "&" + percentEncode("/") + "&" + percentEncode(canonical)

	mac := hmac.New(sha1.New, []byte(accessKeySecret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// SendAliyunSmsCode 发一条验证码短信，返回阿里云的 BizId（便于对账）。
//
// `templateParam` 是模板变量（默认 `{"code":"123456"}`）—— 变量名必须与**模板里写的**一致，
// 不一致会返回 `isv.SMS_PARAMETERS_ILLEGAL`。
func SendAliyunSmsCode(ctx context.Context, cfg AliyunSmsConfig, phone, code string) (string, error) {
	if strings.TrimSpace(cfg.AccessKeyId) == "" || strings.TrimSpace(cfg.AccessKeySecret) == "" {
		return "", errors.New("尚未配置阿里云 AccessKey")
	}
	if strings.TrimSpace(cfg.SignName) == "" || strings.TrimSpace(cfg.TemplateCode) == "" {
		return "", errors.New("尚未配置短信签名或模板")
	}

	regionId := strings.TrimSpace(cfg.RegionId)
	if regionId == "" {
		regionId = "cn-hangzhou"
	}
	templateParam, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return "", fmt.Errorf("组装模板参数失败：%w", err)
	}

	params := map[string]string{
		// 公共参数
		"AccessKeyId":      strings.TrimSpace(cfg.AccessKeyId),
		"Action":           "SendSms",
		"Format":           "JSON",
		"RegionId":         regionId,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   newSignatureNonce(),
		"SignatureVersion": "1.0",
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Version":          aliyunSmsAPIVersion,
		// 业务参数
		"PhoneNumbers":  phone,
		"SignName":      strings.TrimSpace(cfg.SignName),
		"TemplateCode":  strings.TrimSpace(cfg.TemplateCode),
		"TemplateParam": string(templateParam),
	}
	params["Signature"] = aliyunSmsSignature(http.MethodGet, params, cfg.AccessKeySecret)

	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		endpoint = aliyunSmsDefaultEndpoint
	}
	query := url.Values{}
	for key, value := range params {
		query.Set(key, value)
	}
	requestURL := strings.TrimSuffix(endpoint, "/") + "/?" + query.Encode()

	ctx, cancel := context.WithTimeout(ctx, aliyunSmsSendTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", fmt.Errorf("构造短信请求失败：%w", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("调用阿里云短信失败：%w", err)
	}
	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return "", fmt.Errorf("读取阿里云短信响应失败：%w", err)
	}
	var parsed struct {
		Code      string `json:"Code"`
		Message   string `json:"Message"`
		BizId     string `json:"BizId"`
		RequestId string `json:"RequestId"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("阿里云短信响应无法解析（HTTP %d）：%s", response.StatusCode, truncateForError(string(body)))
	}
	if parsed.Code != "OK" {
		return "", &AliyunSmsError{Code: parsed.Code, Message: parsed.Message, RequestId: parsed.RequestId}
	}
	return parsed.BizId, nil
}

// newSignatureNonce 每次请求一个唯一随机数（防重放）。
func newSignatureNonce() string {
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), randomHex(8))
}

// randomHex 取 n 字节的随机十六进制串。
//
// `SignatureNonce` 只求"每次不同"（防重放），不承担安全职责 ——
// 所以取随机失败时退化成时间戳即可，不必把错误往上抛。
func randomHex(n int) string {
	buffer := make([]byte, n)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

func truncateForError(text string) string {
	const limit = 200
	text = strings.TrimSpace(text)
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}
