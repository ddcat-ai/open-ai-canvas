package outbound

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// ReadPeer pins a storage GET to an address already checked by the outbound resolver.
type ReadPeer struct {
	address string
	target  string
}

var peerTransports = struct {
	sync.Mutex
	byAddress map[ReadPeer]*http.Transport
}{byAddress: make(map[ReadPeer]*http.Transport)}

func ResolveReadPeers(ctx context.Context, target *url.URL) ([]ReadPeer, error) {
	host := target.Hostname()
	addresses, err := resolveOutboundHost(ctx, normalizeOutboundHost(host))
	if err != nil {
		return nil, err
	}
	proxy, err := outboundProxyFromEnvironment(&http.Request{URL: target})
	if err != nil {
		return nil, err
	}
	if proxy != nil {
		// The configured proxy owns routing. There is no second origin address we can select.
		return []ReadPeer{{}}, nil
	}
	port := target.Port()
	if port == "" {
		port = "443"
		if target.Scheme == "http" {
			port = "80"
		}
	}
	destination := net.JoinHostPort(host, port)
	peers := make([]ReadPeer, 0, len(addresses))
	seen := make(map[string]bool, len(addresses))
	for _, ip := range addresses {
		address := net.JoinHostPort(ip.String(), port)
		if !seen[address] {
			peers = append(peers, ReadPeer{address: address, target: destination})
			seen[address] = true
		}
	}
	return peers, nil
}

func (peer ReadPeer) Address() string { return peer.address }

func (peer ReadPeer) Client() *http.Client {
	client := OutboundHTTPClient(0)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if peer.address == "" {
		return client
	}
	peerTransports.Lock()
	defer peerTransports.Unlock()
	transport := peerTransports.byAddress[peer]
	if transport == nil {
		if len(peerTransports.byAddress) >= 128 {
			for evicted, old := range peerTransports.byAddress {
				old.CloseIdleConnections()
				delete(peerTransports.byAddress, evicted)
				break
			}
		}
		transport = outboundTransport.Clone()
		transport.Proxy = nil
		transport.DisableCompression = true
		transport.MaxIdleConns = 2
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			if address != peer.target {
				return nil, errors.New("存储请求的连接地址已变化")
			}
			return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, network, peer.address)
		}
		peerTransports.byAddress[peer] = transport
	}
	client.Transport = transport
	return client
}
