# Local transport extension

Upstream: `github.com/casdoor/go-sms-sender`, tag `v0.25.0`, commit
`af78ac0e42f4` (2024-11-29), Apache-2.0. The upstream Go source is retained;
this module is pinned using the parent module's local `replace` directive.

Canvas additions: `safe_http.go` exposes a context-bound, single-recipient,
single-attempt send with structured acceptance identifiers. It uses the upstream
SDKs for signing and payload construction, injects the host's outbound transport,
and strictly checks the raw provider response. Unknown results are never retried.
`tencent.go` additionally rejects missing response/status objects before dereferencing.

Only Aliyun and Tencent have the safe transport capability. Other upstream
providers are not exposed by Canvas. No delivery-receipt capability is claimed.
Before upgrading, run the host's SMS transport contract tests.
