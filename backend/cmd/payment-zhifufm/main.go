package main

import (
	"net/http"
	"os"
	"time"

	paymentplugins "yingce/backend/payment-plugins"
)

func main() {
	provider := paymentplugins.NewZhiFuFMProvider(&http.Client{Timeout: 25 * time.Second})
	if err := paymentplugins.RunRPC(provider, os.Stdin, os.Stdout); err != nil {
		os.Exit(1)
	}
}
