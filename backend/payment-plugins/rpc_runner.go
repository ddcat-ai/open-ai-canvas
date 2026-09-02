package paymentplugins

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const rpcVersion = "yingce.payment/v1"

type rpcRequest struct {
	Version   string              `json:"version"`
	Operation string              `json:"operation"`
	Config    Config              `json:"config,omitempty"`
	Request   json.RawMessage     `json:"request,omitempty"`
	Headers   map[string][]string `json:"headers,omitempty"`
	Body      string              `json:"bodyBase64,omitempty"`
	BillDate  string              `json:"billDate,omitempty"`
}

type rpcResponse struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
}

func RunRPC(provider Provider, input io.Reader, output io.Writer) error {
	decoder := json.NewDecoder(io.LimitReader(input, 2<<20))
	var request rpcRequest
	if err := decoder.Decode(&request); err != nil {
		return writeRPC(output, rpcResponse{Code: "invalid_request", Message: "请求不是有效 JSON"})
	}
	if request.Version != rpcVersion {
		return writeRPC(output, rpcResponse{Code: "unsupported_version", Message: "不支持的支付插件协议版本"})
	}
	if provider == nil {
		return writeRPC(output, rpcResponse{Code: "provider_unavailable", Message: "支付插件未配置"})
	}
	ctx := context.Background()
	var value any
	var err error
	switch request.Operation {
	case "validate_config":
		err = provider.ValidateConfig(request.Config)
	case "create_order":
		var valueRequest CreateRequest
		err = json.Unmarshal(request.Request, &valueRequest)
		if err == nil {
			value, err = provider.CreateOrder(ctx, request.Config, valueRequest)
		}
	case "query_order":
		var valueRequest QueryRequest
		err = json.Unmarshal(request.Request, &valueRequest)
		if err == nil {
			value, err = provider.QueryOrder(ctx, request.Config, valueRequest)
		}
	case "close_order":
		var valueRequest CloseRequest
		err = json.Unmarshal(request.Request, &valueRequest)
		if err == nil {
			value, err = provider.CloseOrder(ctx, request.Config, valueRequest)
		}
	case "verify_notification":
		body, decodeErr := base64.StdEncoding.DecodeString(request.Body)
		err = decodeErr
		if err == nil {
			value, err = provider.VerifyNotification(ctx, request.Config, http.Header(request.Headers), body)
		}
	case "download_trade_bill":
		billDate, parseErr := time.Parse("2006-01-02", request.BillDate)
		err = parseErr
		if err == nil {
			value, err = provider.DownloadTradeBill(ctx, request.Config, billDate)
		}
	default:
		err = fmt.Errorf("unknown payment operation %q", request.Operation)
	}
	if err != nil {
		response := rpcResponse{Code: "provider_error", Message: err.Error()}
		if providerErr, ok := err.(*ProviderError); ok && strings.TrimSpace(providerErr.Code) != "" {
			response.Code = providerErr.Code
		}
		return writeRPC(output, response)
	}
	return writeRPC(output, rpcResponse{OK: true, Data: value})
}

func writeRPC(output io.Writer, response rpcResponse) error {
	return json.NewEncoder(output).Encode(response)
}
