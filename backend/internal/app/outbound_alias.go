package app

import (
	"net/http"
	"net/url"
	"time"

	"infinite-canvas/backend/internal/outbound"
)

// Outbound 符号从 internal/outbound 再导出，保持 service/handler 调用面稳定。
type OutboundHeader = outbound.OutboundHeader

const (
	CustomRelayHeadersHeader = outbound.CustomRelayHeadersHeader
	DefaultOutboundUserAgent = outbound.DefaultOutboundUserAgent
)

func ValidateOutboundURL(rawURL string) (*url.URL, error) {
	parsed, err := outbound.ValidateOutboundURL(rawURL)
	return parsed, mapOutboundError(err)
}

func ValidateCustomRelayURL(rawURL string) (*url.URL, error) {
	parsed, err := outbound.ValidateCustomRelayURL(rawURL)
	return parsed, mapOutboundError(err)
}

func OutboundHTTPClient(timeout time.Duration) *http.Client {
	return outbound.OutboundHTTPClient(timeout)
}

func ApplyDefaultOutboundHeaders(req *http.Request) {
	outbound.ApplyDefaultOutboundHeaders(req)
}

func NormalizeOutboundHeaders(headers []OutboundHeader) ([]OutboundHeader, error) {
	normalized, err := outbound.NormalizeOutboundHeaders(headers)
	return normalized, mapOutboundError(err)
}

func ApplyOutboundHeaders(req *http.Request, headers []OutboundHeader) {
	outbound.ApplyOutboundHeaders(req, headers)
}

func EncodeOutboundHeadersJSON(headers []OutboundHeader) (string, error) {
	encoded, err := outbound.EncodeOutboundHeadersJSON(headers)
	return encoded, mapOutboundError(err)
}

func ParseOutboundHeadersJSON(raw string) ([]OutboundHeader, error) {
	decoded, err := outbound.ParseOutboundHeadersJSON(raw)
	return decoded, mapOutboundError(err)
}

func DecodeRelayOutboundHeaders(encoded string) ([]OutboundHeader, error) {
	decoded, err := outbound.DecodeRelayOutboundHeaders(encoded)
	return decoded, mapOutboundError(err)
}

func CustomRelayHTTPClient(timeout time.Duration) *http.Client {
	return outbound.CustomRelayHTTPClient(timeout)
}

func ValidateOutboundHost(host string) error {
	return mapOutboundError(outbound.ValidateOutboundHost(host))
}

func AllowedPrivateUpstreamHost(host string) bool {
	return outbound.AllowedPrivateUpstreamHost(host)
}

func mapOutboundError(err error) error {
	if err == nil {
		return nil
	}
	if req, ok := err.(*outbound.BadRequestError); ok {
		return BadAuthRequest(req.Message)
	}
	return err
}
