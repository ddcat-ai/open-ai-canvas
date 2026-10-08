package yingceagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	agentruntime "yingce/backend/internal/agent/runtime"
)

type Status struct {
	OK     bool `json:"ok"`
	Active int  `json:"active"`
	Limit  int  `json:"limit"`
	Queued int  `json:"queued"`
}

func Inspect(ctx context.Context, endpoint string) (Status, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return Status{}, fmt.Errorf("YINGCE_AGENT_URL is empty")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/healthz", nil)
	if err != nil {
		return Status{}, err
	}
	response, err := remoteClient.Do(request)
	if err != nil {
		return Status{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Status{}, fmt.Errorf("yingce-agent health returned HTTP %d", response.StatusCode)
	}
	var status Status
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&status); err != nil {
		return Status{}, err
	}
	return status, nil
}

func SetLimit(ctx context.Context, endpoint, serviceToken string, limit int) error {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	serviceToken = strings.TrimSpace(serviceToken)
	if endpoint == "" {
		return fmt.Errorf("YINGCE_AGENT_URL is empty")
	}
	if len(serviceToken) < 32 {
		return fmt.Errorf("YINGCE_AGENT_TOKEN must contain at least 32 characters")
	}
	payload, err := json.Marshal(map[string]int{"maxSessions": limit})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint+"/v1/limit", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+serviceToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := remoteClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return fmt.Errorf("yingce-agent limit returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}

// Run executes one Agent session on the independent yingce-agent service.
// The Go process keeps the bridge, billing, and tool execution. A configured
// remote endpoint never falls back to an embedded Node process: doing so can
// run the same step twice.
func Run(ctx context.Context, endpoint, serviceToken, bridgeHost string, request agentruntime.ProcessRequest, bridge agentruntime.Bridge) error {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	serviceToken = strings.TrimSpace(serviceToken)
	if endpoint == "" {
		return fmt.Errorf("YINGCE_AGENT_URL is empty")
	}
	if len(serviceToken) < 32 {
		return fmt.Errorf("YINGCE_AGENT_TOKEN must contain at least 32 characters")
	}
	server, err := agentruntime.StartBridge("0.0.0.0:0", bridgeHost, bridge)
	if err != nil {
		return err
	}
	defer server.Close()
	request.BridgeURL = server.URL
	request.BridgeToken = server.Token
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode remote Agent request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/v1/runs", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create remote Agent request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+serviceToken)
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := remoteClient.Do(httpRequest)
	if err != nil {
		return fmt.Errorf("call yingce-agent: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("yingce-agent returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return agentruntime.ReadOutput(response.Body)
}

var remoteClient = &http.Client{
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2: true,
		IdleConnTimeout:   90 * time.Second,
	},
}
