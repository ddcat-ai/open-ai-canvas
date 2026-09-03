package main

import (
	"net/http"
	"os"
	"time"

	paymentplugins "infinite-canvas/backend/payment-plugins"
)

func main() {
	provider := paymentplugins.NewWeChatProvider(&http.Client{Timeout: 25 * time.Second}, "https://api.mch.weixin.qq.com")
	if err := paymentplugins.RunRPC(provider, os.Stdin, os.Stdout); err != nil {
		os.Exit(1)
	}
}
