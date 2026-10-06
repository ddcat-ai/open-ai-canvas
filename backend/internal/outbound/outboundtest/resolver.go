// Package outboundtest provides socket-free DNS fixtures for outbound policy tests.
package outboundtest

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"strings"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

// PublicDNS maps only the supplied hostnames to a public A record. Other names
// return NXDOMAIN; AAAA queries return no records. No network socket is opened.
// It changes process-global state: callers and their parents must not use
// t.Parallel. Cleanup restores the previous resolver (including nested fixtures).
func PublicDNS(t *testing.T, hosts ...string) {
	t.Helper()
	DNS(t, [4]byte{1, 1, 1, 1}, hosts...)
}

// DNS maps supplied names to a chosen IPv4 address without opening sockets.
func DNS(t *testing.T, address [4]byte, hosts ...string) {
	t.Helper()
	allowed := make(map[string]bool, len(hosts))
	for _, host := range hosts {
		allowed[strings.ToLower(strings.TrimSuffix(host, "."))+"."] = true
	}
	previous := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, resolverAddress string) (net.Conn, error) {
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			for {
				var size [2]byte
				if _, err := io.ReadFull(server, size[:]); err != nil {
					return
				}
				wire := make([]byte, binary.BigEndian.Uint16(size[:]))
				if _, err := io.ReadFull(server, wire); err != nil {
					return
				}
				var query dnsmessage.Message
				if query.Unpack(wire) != nil || len(query.Questions) != 1 {
					return
				}
				q := query.Questions[0]
				response := dnsmessage.Message{Header: dnsmessage.Header{ID: query.ID, Response: true, Authoritative: true, RecursionDesired: query.RecursionDesired, RecursionAvailable: true}, Questions: query.Questions}
				if !allowed[strings.ToLower(q.Name.String())] {
					response.RCode = dnsmessage.RCodeNameError
				} else if q.Type == dnsmessage.TypeA && q.Class == dnsmessage.ClassINET {
					response.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.AResource{A: address}}}
				}
				answer, err := response.Pack()
				if err != nil {
					return
				}
				binary.BigEndian.PutUint16(size[:], uint16(len(answer)))
				if _, err := server.Write(append(size[:], answer...)); err != nil {
					return
				}
			}
		}()
		return client, nil
	}}
	t.Cleanup(func() { net.DefaultResolver = previous })
}
