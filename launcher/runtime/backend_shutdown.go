package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

func requestBackendShutdown(upstream *url.URL, token string) error {
	if token == "" {
		return errors.New("private backend shutdown credential unavailable")
	}
	target := *upstream
	target.Path = "/_yingce_launcher/shutdown"
	target.RawPath, target.RawQuery, target.Fragment = "", "", ""
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), nil)
	if err != nil {
		return errors.New("create private backend shutdown request")
	}
	req.Header.Set("X-Yingce-Shutdown-Token", token)
	transport := &http.Transport{
		Proxy:             nil,
		DialContext:       (&net.Dialer{Timeout: 3 * time.Second}).DialContext,
		DisableKeepAlives: true,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(req)
	if err != nil {
		// Do not include transport errors that could carry credential-bearing URLs.
		return errors.New("private backend shutdown request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("private backend shutdown returned HTTP %d", response.StatusCode)
	}
	return nil
}
