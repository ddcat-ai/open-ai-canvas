package go_sms_sender

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync/atomic"
)

// SendResult describes provider acceptance, not handset delivery.
type SendResult struct {
	State, RequestID, MessageID, Code string
}

var ErrSendUnknown = errors.New("sms acceptance unknown")
var ErrSendRejected = errors.New("sms rejected")

type singleSendTransport struct {
	ctx       context.Context
	base      http.RoundTripper
	host      string
	attempted atomic.Bool
	body      []byte
	status    int
}

func (t *singleSendTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != t.host || t.attempted.Swap(true) {
		return nil, ErrSendUnknown
	}
	response, err := t.base.RoundTrip(req.Clone(t.ctx))
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	t.body, t.status = body, response.StatusCode
	response.Body = io.NopCloser(bytes.NewReader(body))
	return response, nil
}

// SendMessageContext requires a fresh client per call. It deliberately disables
// implicit SDK retries and validates acceptance independently of SendMessage.
func SendMessageContext(ctx context.Context, client SmsClient, transport http.RoundTripper, params map[string]string, phone string) (SendResult, error) {
	result := SendResult{State: "unknown", Code: "acceptance_unknown"}
	if transport == nil || phone == "" {
		return result, ErrSendUnknown
	}
	t := &singleSendTransport{ctx: ctx, base: transport}
	switch c := client.(type) {
	case *AliyunClient:
		t.host = "dysmsapi.aliyuncs.com"
		c.core.GetConfig().AutoRetry = false
		c.core.SetTransport(t)
	case *TencentClient:
		t.host = "sms.tencentcloudapi.com"
		c.core.WithHttpTransport(t)
	default:
		return result, ErrSendRejected
	}
	// Upstream errors may contain credentials/phone numbers and are not exposed.
	_ = client.SendMessage(params, phone)
	if t.status < 200 || t.status >= 300 {
		return result, ErrSendUnknown
	}
	switch client.(type) {
	case *AliyunClient:
		var body struct{ Code, RequestId, BizId string }
		if json.Unmarshal(t.body, &body) != nil {
			return result, ErrSendUnknown
		}
		result.RequestID = body.RequestId
		if body.Code != "" && body.Code != "OK" {
			result.State, result.Code = "rejected", body.Code
			return result, ErrSendRejected
		}
		if body.Code != "OK" || body.BizId == "" || body.RequestId == "" {
			return result, ErrSendUnknown
		}
		result.MessageID = body.BizId
	case *TencentClient:
		var body struct {
			Response struct {
				RequestId     string
				Error         *struct{ Code string }
				SendStatusSet []struct{ Code, SerialNo string }
			}
		}
		if json.Unmarshal(t.body, &body) != nil {
			return result, ErrSendUnknown
		}
		result.RequestID = body.Response.RequestId
		if body.Response.Error != nil && body.Response.Error.Code != "" {
			result.State, result.Code = "rejected", body.Response.Error.Code
			return result, ErrSendRejected
		}
		if len(body.Response.SendStatusSet) != 1 {
			return result, ErrSendUnknown
		}
		status := body.Response.SendStatusSet[0]
		if status.Code != "" && status.Code != "Ok" {
			result.State, result.Code = "rejected", status.Code
			return result, ErrSendRejected
		}
		if status.Code != "Ok" || status.SerialNo == "" || result.RequestID == "" {
			return result, ErrSendUnknown
		}
		result.MessageID = status.SerialNo
	}
	result.State, result.Code = "accepted", ""
	return result, nil
}
