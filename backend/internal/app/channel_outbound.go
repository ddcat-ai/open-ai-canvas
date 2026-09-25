package app

import (
	"net/http"
	"net/url"
	"time"
)

// ValidateChannelOutboundURL keeps all provider channels on the server-side
// outbound policy. Local desktop endpoints are intentionally unsupported.
// System channels must also target an administrator-approved model origin.
func (s *Service) ValidateChannelOutboundURL(rawURL string) (*url.URL, error) {
	parsed, err := ValidateOutboundURL(rawURL)
	if err != nil {
		return nil, err
	}
	if err := s.requireAllowedModelOrigin(rawURL); err != nil {
		return nil, err
	}
	return parsed, nil
}

func (s *Service) OutboundHTTPClientForChannel(timeout time.Duration, _ *url.URL) *http.Client {
	return OutboundHTTPClient(timeout)
}
