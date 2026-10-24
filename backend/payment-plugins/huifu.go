package paymentplugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	huifuDefaultGateway    = "https://api.huifu.com"
	huifuPreorderPath      = "/v2/trade/hosting/payment/preorder"
	huifuQueryPath         = "/v2/trade/hosting/payment/queryorderinfo"
	huifuClosePath         = "/v2/trade/hosting/payment/close"
	huifuPreorderTypeH5    = "1"
	huifuRequestTypeH5     = "M"
	huifuSuccessCode       = "00000000"
	huifuTransSuccess      = "S"
	huifuCloseSuccess      = "S"
	huifuDefaultExpire     = 10 * time.Minute
	huifuGoodsDescLimit    = 40
	huifuProjectTitleLimit = 64
	huifuSeqLimit          = 64
)

type HuifuH5Provider struct {
	client  *http.Client
	now     func() time.Time
	baseURL string
}

func NewHuifuH5Provider(client *http.Client) *HuifuH5Provider {
	if client == nil {
		client = http.DefaultClient
	}
	return &HuifuH5Provider{client: client, now: time.Now}
}

func (p *HuifuH5Provider) Descriptor() Descriptor {
	return Descriptor{
		ID: ProviderHuifuH5, PluginID: PluginHuifuH5, PluginVersion: "1.0.0",
		Name: "斗拱 H5 支付", Icon: "assets/icon.svg", CheckoutMode: "redirect",
		IdentityFields: []string{"sysId", "huifuId"},
		NotificationSuccess: NotificationResponse{
			Status: 200, ContentType: "text/plain; charset=utf-8", Body: "RECV_ORD_ID_",
		},
		NotificationFailure: NotificationResponse{
			Status: 400, ContentType: "text/plain; charset=utf-8", Body: "fail",
		},
	}
}

func (p *HuifuH5Provider) ValidateConfig(config Config) error {
	for _, key := range []string{"sysId", "productId", "huifuId", "projectId", "projectTitle", "merchantPrivateKey", "huifuPublicKey", "gateway"} {
		if strings.TrimSpace(config[key]) == "" {
			return fmt.Errorf("斗拱 H5 配置缺少 %s", key)
		}
	}
	if _, err := parseRSAPrivateKey(config["merchantPrivateKey"]); err != nil {
		return fmt.Errorf("斗拱商户私钥无效：%w", err)
	}
	if _, err := parseRSAPublicKey(config["huifuPublicKey"]); err != nil {
		return fmt.Errorf("斗拱汇付公钥无效：%w", err)
	}
	if _, err := huifuGatewayOrigin(config); err != nil {
		return err
	}
	if huifuTruncate(config["projectTitle"], huifuProjectTitleLimit) == "" {
		return errors.New("斗拱 H5 配置 projectTitle 无效")
	}
	return nil
}

func (p *HuifuH5Provider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || request.MerchantOrderNo == "" || request.NotifyURL == "" {
		return Checkout{}, errors.New("斗拱 H5 下单参数无效")
	}
	if err := huifuValidateNotifyURL(request.NotifyURL); err != nil {
		return Checkout{}, err
	}
	now := p.now().In(huifuLocation())
	hostingFields := map[string]string{
		"project_title": huifuTruncate(config["projectTitle"], huifuProjectTitleLimit),
		"project_id":    strings.TrimSpace(config["projectId"]),
		"request_type":  huifuRequestTypeH5,
	}
	if strings.TrimSpace(request.ReturnURL) != "" {
		hostingFields["callback_url"] = strings.TrimSpace(request.ReturnURL)
	}
	hosting, err := huifuJSON(hostingFields)
	if err != nil {
		return Checkout{}, err
	}
	data := map[string]string{
		"req_date":       now.Format("20060102"),
		"req_seq_id":     huifuTruncate(request.MerchantOrderNo, huifuSeqLimit),
		"huifu_id":       strings.TrimSpace(config["huifuId"]),
		"trans_amt":      formatFen(request.AmountFen),
		"goods_desc":     huifuTruncate(request.Description, huifuGoodsDescLimit),
		"pre_order_type": huifuPreorderTypeH5,
		"hosting_data":   string(hosting),
		"notify_url":     request.NotifyURL,
	}
	if !request.ExpiresAt.IsZero() {
		data["time_expire"] = request.ExpiresAt.In(huifuLocation()).Format("20060102150405")
	}
	var envelope huifuEnvelope
	if err := p.call(ctx, config, huifuPreorderPath, data, &envelope); err != nil {
		return Checkout{}, err
	}
	if envelope.Data.RespCode != huifuSuccessCode {
		return Checkout{}, huifuBusinessError(envelope.Data.RespCode, envelope.Data.RespDesc)
	}
	jumpURL := strings.TrimSpace(envelope.Data.JumpURL)
	if jumpURL == "" {
		return Checkout{}, errors.New("斗拱 H5 预下单未返回 jump_url")
	}
	if _, err := url.ParseRequestURI(jumpURL); err != nil || !strings.HasPrefix(jumpURL, "https://") && !strings.HasPrefix(jumpURL, "http://") {
		return Checkout{}, errors.New("斗拱 H5 预下单 jump_url 不是有效 http(s) 地址")
	}
	expiresAt := now.Add(huifuDefaultExpire)
	if parsed, err := time.ParseInLocation("20060102150405", strings.TrimSpace(envelope.Data.TimeExpire), huifuLocation()); err == nil {
		expiresAt = parsed
	} else if !request.ExpiresAt.IsZero() {
		expiresAt = request.ExpiresAt
	}
	return Checkout{Mode: "redirect", Value: jumpURL, ExpiresAt: expiresAt}, nil
}

func (p *HuifuH5Provider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(request.MerchantOrderNo) == "" {
		return Result{}, errors.New("斗拱 H5 查单缺少商户订单号")
	}
	order, err := p.queryOriginal(ctx, config, request.MerchantOrderNo)
	if err != nil {
		return Result{}, err
	}
	return huifuResult(request.MerchantOrderNo, order), nil
}

func (p *HuifuH5Provider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(request.MerchantOrderNo) == "" {
		return Result{}, errors.New("斗拱 H5 关单缺少商户订单号")
	}
	order, err := p.queryOriginal(ctx, config, request.MerchantOrderNo)
	if err != nil {
		return Result{}, err
	}
	result := huifuResult(request.MerchantOrderNo, order)
	if result.Paid {
		return result, nil
	}
	now := p.now().In(huifuLocation())
	orgDate := strings.TrimSpace(order.OrgReqDate)
	if orgDate == "" {
		orgDate = now.Format("20060102")
	}
	data := map[string]string{
		"req_seq_id":     huifuNewSeq("C", request.MerchantOrderNo, now),
		"req_date":       now.Format("20060102"),
		"huifu_id":       strings.TrimSpace(config["huifuId"]),
		"org_req_date":   orgDate,
		"org_req_seq_id": huifuTruncate(request.MerchantOrderNo, huifuSeqLimit),
	}
	var envelope huifuEnvelope
	if err := p.call(ctx, config, huifuClosePath, data, &envelope); err != nil {
		return Result{}, err
	}
	if envelope.Data.RespCode != huifuSuccessCode && envelope.Data.RespCode != "00000100" {
		return Result{}, huifuBusinessError(envelope.Data.RespCode, envelope.Data.RespDesc)
	}
	result.ProviderStatus = firstNonEmpty(envelope.Data.CloseStat, envelope.Data.OrgTransStat, result.ProviderStatus)
	result.Closed = envelope.Data.CloseStat == huifuCloseSuccess
	return result, nil
}

func (p *HuifuH5Provider) VerifyNotification(_ context.Context, config Config, _ http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}
	values, err := parseHuifuNotification(rawBody)
	if err != nil {
		return Notification{}, err
	}
	respData := strings.TrimSpace(firstNonEmpty(values["resp_data"], values["data"]))
	sign := strings.TrimSpace(values["sign"])
	if respData == "" || sign == "" {
		return Notification{}, errors.New("斗拱异步通知缺少 resp_data 或 sign")
	}
	publicKey, err := parseRSAPublicKey(config["huifuPublicKey"])
	if err != nil {
		return Notification{}, err
	}
	if err := rsaSHA256Verify(publicKey, []byte(respData), sign); err != nil {
		return Notification{}, err
	}
	var payload huifuNotifyPayload
	if err := json.Unmarshal([]byte(respData), &payload); err != nil {
		return Notification{}, fmt.Errorf("解析斗拱异步通知：%w", err)
	}
	if strings.TrimSpace(payload.HuifuID) != strings.TrimSpace(config["huifuId"]) {
		return Notification{}, errors.New("斗拱异步通知商户号不匹配")
	}
	merchantOrderNo := strings.TrimSpace(payload.ReqSeqID)
	if merchantOrderNo == "" {
		return Notification{}, errors.New("斗拱异步通知缺少 req_seq_id")
	}
	amount, err := parseYuanToFen(payload.TransAmt)
	if err != nil {
		return Notification{}, errors.New("斗拱异步通知金额无效")
	}
	paid := payload.TransStat == huifuTransSuccess
	eventID := firstNonEmpty(payload.HfSeqID, merchantOrderNo) + ":" + payload.TransStat
	return Notification{
		EventID: eventID,
		Result: Result{
			MerchantOrderNo: merchantOrderNo,
			ProviderTradeNo: strings.TrimSpace(payload.HfSeqID),
			ProviderStatus:  firstNonEmpty(payload.TransStat, payload.RespCode),
			AmountFen:       amount,
			Currency:        "CNY",
			Paid:            paid,
			PaidAt:          parseHuifuDateTime(payload.EndTime, payload.TransFinishTime),
		},
	}, nil
}

func (p *HuifuH5Provider) DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error) {
	return nil, fmt.Errorf("%w: H5/PC预下单接口未提供交易账单下载", ErrTradeBillNotFound)
}

func (p *HuifuH5Provider) queryOriginal(ctx context.Context, config Config, merchantOrderNo string) (huifuData, error) {
	now := p.now().In(huifuLocation())
	dates := []string{now.Format("20060102"), now.AddDate(0, 0, -1).Format("20060102")}
	var last error
	for _, orgDate := range dates {
		data := map[string]string{
			"req_date":       now.Format("20060102"),
			"req_seq_id":     huifuNewSeq("Q", merchantOrderNo, now),
			"huifu_id":       strings.TrimSpace(config["huifuId"]),
			"org_req_date":   orgDate,
			"org_req_seq_id": huifuTruncate(merchantOrderNo, huifuSeqLimit),
		}
		var envelope huifuEnvelope
		if err := p.call(ctx, config, huifuQueryPath, data, &envelope); err != nil {
			if errors.Is(err, ErrOrderNotFound) {
				last = err
				continue
			}
			return huifuData{}, err
		}
		if envelope.Data.RespCode == "20000004" || envelope.Data.RespCode == "99010003" {
			last = fmt.Errorf("%w: %s", ErrOrderNotFound, envelope.Data.RespDesc)
			continue
		}
		if envelope.Data.RespCode != huifuSuccessCode && envelope.Data.RespCode != "00000100" {
			return huifuData{}, huifuBusinessError(envelope.Data.RespCode, envelope.Data.RespDesc)
		}
		if envelope.Data.OrgReqDate == "" {
			envelope.Data.OrgReqDate = orgDate
		}
		return envelope.Data, nil
	}
	if last == nil {
		last = ErrOrderNotFound
	}
	return huifuData{}, last
}

func (p *HuifuH5Provider) call(ctx context.Context, config Config, path string, data map[string]string, output *huifuEnvelope) error {
	payload, err := huifuSignedPayload(config, data)
	if err != nil {
		return err
	}
	endpoint, err := p.origin(config)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := p.client.Do(request)
	if err != nil {
		return &ProviderError{Code: "huifu_transport_error", Message: "斗拱网络请求失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return &ProviderError{Code: "huifu_response_read_error", Message: "读取斗拱响应失败", Temporary: true, Cause: err}
	}
	if response.StatusCode == 404 {
		return fmt.Errorf("%w: 斗拱接口不存在", ErrOrderNotFound)
	}
	if response.StatusCode == 922 || response.StatusCode == 40002 {
		return errors.New("斗拱验签失败")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &ProviderError{Code: "huifu_http_error", Message: "斗拱接口返回失败", Temporary: response.StatusCode >= 500}
	}
	var envelope huifuEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("解析斗拱响应：%w", err)
	}
	if strings.TrimSpace(envelope.Sign) != "" {
		if err := huifuVerifyResponse(config, envelope); err != nil {
			return err
		}
	}
	if output != nil {
		*output = envelope
	}
	return nil
}

type huifuEnvelope struct {
	SysID     string    `json:"sys_id"`
	ProductID string    `json:"product_id"`
	Sign      string    `json:"sign"`
	Data      huifuData `json:"data"`
}

type huifuData struct {
	RespCode     string `json:"resp_code"`
	RespDesc     string `json:"resp_desc"`
	ReqDate      string `json:"req_date"`
	ReqSeqID     string `json:"req_seq_id"`
	HuifuID      string `json:"huifu_id"`
	JumpURL      string `json:"jump_url"`
	PreOrderID   string `json:"pre_order_id"`
	TimeExpire   string `json:"time_expire"`
	OrgReqDate   string `json:"org_req_date"`
	OrgReqSeqID  string `json:"org_req_seq_id"`
	OrgHfSeqID   string `json:"org_hf_seq_id"`
	TransStat    string `json:"trans_stat"`
	TransAmt     string `json:"trans_amt"`
	TransTime    string `json:"trans_time"`
	CloseStat    string `json:"close_stat"`
	OrgTransStat string `json:"org_trans_stat"`
	OrderStat    string `json:"order_stat"`
}

type huifuNotifyPayload struct {
	RespCode        string `json:"resp_code"`
	HuifuID         string `json:"huifu_id"`
	ReqSeqID        string `json:"req_seq_id"`
	ReqDate         string `json:"req_date"`
	HfSeqID         string `json:"hf_seq_id"`
	TransAmt        string `json:"trans_amt"`
	TransStat       string `json:"trans_stat"`
	EndTime         string `json:"end_time"`
	TransFinishTime string `json:"trans_finish_time"`
}

func huifuSignedPayload(config Config, data map[string]string) ([]byte, error) {
	privateKey, err := parseRSAPrivateKey(config["merchantPrivateKey"])
	if err != nil {
		return nil, err
	}
	content := huifuCanonical(stringMapToAny(data))
	signature, err := rsaSHA256Sign(privateKey, []byte(content))
	if err != nil {
		return nil, err
	}
	envelope := map[string]any{
		"sys_id":     strings.TrimSpace(config["sysId"]),
		"product_id": strings.TrimSpace(config["productId"]),
		"sign":       signature,
		"data":       data,
	}
	return huifuJSON(envelope)
}

func huifuJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSpace(buffer.Bytes()), nil
}

func huifuVerifyResponse(config Config, envelope huifuEnvelope) error {
	publicKey, err := parseRSAPublicKey(config["huifuPublicKey"])
	if err != nil {
		return err
	}
	raw, err := json.Marshal(envelope.Data)
	if err != nil {
		return err
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return err
	}
	return rsaSHA256Verify(publicKey, []byte(huifuCanonical(object)), envelope.Sign)
}

func huifuCanonical(data map[string]any) string {
	keys := make([]string, 0, len(data))
	for key, value := range data {
		if key == "" || key == "sign" || huifuScalar(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+huifuScalar(data[key]))
	}
	return strings.Join(parts, "&")
}

func huifuScalar(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

func stringMapToAny(input map[string]string) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func huifuResult(merchantOrderNo string, data huifuData) Result {
	amount, _ := parseYuanToFen(data.TransAmt)
	paid := data.TransStat == huifuTransSuccess || data.OrderStat == "1"
	closed := data.CloseStat == huifuCloseSuccess
	return Result{
		MerchantOrderNo: merchantOrderNo,
		ProviderTradeNo: firstNonEmpty(data.OrgHfSeqID, data.PreOrderID),
		ProviderStatus:  firstNonEmpty(data.TransStat, data.CloseStat, data.RespCode),
		AmountFen:       amount,
		Currency:        "CNY",
		Paid:            paid,
		Closed:          closed && !paid,
		PaidAt:          parseHuifuDateTime(data.TransTime, ""),
	}
}

func huifuBusinessError(code, desc string) error {
	message := strings.TrimSpace(desc)
	if message == "" {
		message = "斗拱业务请求失败"
	}
	if code == "20000004" || code == "99010003" {
		return fmt.Errorf("%w: %s", ErrOrderNotFound, message)
	}
	return &ProviderError{Code: code, Message: message}
}

func (p *HuifuH5Provider) origin(config Config) (string, error) {
	if strings.TrimSpace(p.baseURL) != "" {
		return strings.TrimRight(p.baseURL, "/"), nil
	}
	return huifuGatewayOrigin(config)
}

func huifuGatewayOrigin(config Config) (string, error) {
	raw := strings.TrimSpace(config["gateway"])
	if raw == "" {
		raw = huifuDefaultGateway
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("斗拱 gateway 必须是 https 地址")
	}
	return strings.TrimRight(parsed.Scheme+"://"+parsed.Host, "/"), nil
}

func huifuValidateNotifyURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("斗拱 notify_url 必须是 http 或 https 地址")
	}
	if parsed.RawQuery != "" {
		return errors.New("斗拱 notify_url 不能带查询参数")
	}
	return nil
}

func huifuNewSeq(prefix, merchantOrderNo string, now time.Time) string {
	seq := prefix + now.Format("150405") + merchantOrderNo
	return huifuTruncate(seq, huifuSeqLimit)
}

func huifuTruncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func huifuLocation() *time.Location {
	return time.FixedZone("CST", 8*60*60)
}

func parseHuifuNotification(rawBody []byte) (map[string]string, error) {
	trimmed := bytes.TrimSpace(rawBody)
	if len(trimmed) == 0 {
		return nil, errors.New("斗拱异步通知为空")
	}
	if trimmed[0] == '{' {
		var object map[string]any
		if err := json.Unmarshal(trimmed, &object); err != nil {
			return nil, err
		}
		out := make(map[string]string, len(object))
		for key, value := range object {
			out[key] = huifuScalar(value)
		}
		return out, nil
	}
	values, err := url.ParseQuery(string(trimmed))
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(values))
	for key := range values {
		out[key] = values.Get(key)
	}
	return out, nil
}

func parseHuifuDateTime(primary, fallback string) time.Time {
	for _, value := range []string{primary, fallback} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if parsed, err := time.ParseInLocation("20060102150405", value, huifuLocation()); err == nil {
			return parsed
		}
	}
	return time.Time{}
}
