package updaterclient

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

	"yingce/backend/internal/hostupdate"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func New(socketPath, token string) *Client {
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "unix", socketPath)
		},
		DisableKeepAlives: true,
	}
	return &Client{baseURL: "http://unix", token: strings.TrimSpace(token), http: &http.Client{Transport: transport, Timeout: 15 * time.Second}}
}

func (c *Client) Status(ctx context.Context) (hostupdate.Status, error) {
	return c.request(ctx, http.MethodGet, "/v1/status", nil)
}

func (c *Client) Check(ctx context.Context) (hostupdate.Status, error) {
	return c.request(ctx, http.MethodPost, "/v1/check", struct{}{})
}

func (c *Client) Start(ctx context.Context, targetVersion string) (hostupdate.Status, error) {
	return c.request(ctx, http.MethodPost, "/v1/update", hostupdate.StartRequest{TargetVersion: targetVersion})
}

func (c *Client) Rollback(ctx context.Context, reason string) (hostupdate.Status, error) {
	return c.request(ctx, http.MethodPost, "/v1/rollback", hostupdate.RollbackRequest{Reason: reason})
}

func (c *Client) request(ctx context.Context, method, path string, payload any) (hostupdate.Status, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return hostupdate.Status{}, err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return hostupdate.Status{}, err
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Accept", "application/json")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return hostupdate.Status{}, fmt.Errorf("连接 Host Updater：%w", err)
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 2<<20)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error string            `json:"error"`
			Data  hostupdate.Status `json:"data"`
		}
		if err := json.NewDecoder(limited).Decode(&failure); err == nil && failure.Error != "" {
			return failure.Data, fmt.Errorf("Host Updater：%s", failure.Error)
		}
		return hostupdate.Status{}, fmt.Errorf("Host Updater 返回 HTTP %d", response.StatusCode)
	}
	var status hostupdate.Status
	if err := json.NewDecoder(limited).Decode(&status); err != nil {
		return hostupdate.Status{}, fmt.Errorf("解析 Host Updater 响应：%w", err)
	}
	return status, nil
}
