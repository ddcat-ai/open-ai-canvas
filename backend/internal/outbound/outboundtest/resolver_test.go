package outboundtest

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestPublicDNS(t *testing.T) {
	previous := net.DefaultResolver
	t.Run("fixture", func(t *testing.T) {
		PublicDNS(t, "media.example.com")
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", "media.example.com")
		if err != nil || len(ips) != 1 || !ips[0].Equal(net.IPv4(1, 1, 1, 1)) {
			t.Fatalf("A/AAAA lookup = %v, %v", ips, err)
		}
		if _, err := net.DefaultResolver.LookupIP(ctx, "ip", "unregistered.example.com"); err == nil {
			t.Fatal("unknown host must fail closed")
		}
	})
	if net.DefaultResolver != previous {
		t.Fatal("resolver was not restored")
	}
}
