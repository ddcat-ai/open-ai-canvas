package protocol

import "testing"

func TestAsyncManifestRequiresExplicitCancellationBoundary(t *testing.T) {
	base := `{
		"apiVersion":"yingce.plugin/v1",
		"id":"cancel-contract","version":"1.0.0","name":"Cancel Contract",
		"contributes":{"providers":[{"id":"cancel-contract","label":"Cancel Contract","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/create"},"poll":{"method":"GET","path":"/poll/{{taskId}}"},%s"response":{}}]}
	}`
	cases := []struct {
		name         string
		cancellation string
		wantErr      bool
	}{
		{name: "missing", cancellation: "", wantErr: true},
		{name: "blank reason", cancellation: `"nonCancelable":{"reason":""},`, wantErr: true},
		{name: "cancel and nonCancelable", cancellation: `"cancel":{"method":"POST","path":"/cancel/{{taskId}}"},"nonCancelable":{"reason":"not applicable"},`, wantErr: true},
		{name: "nonCancelable", cancellation: `"nonCancelable":{"reason":"upstream has no cancellation endpoint"},`, wantErr: false},
		{name: "cancel", cancellation: `"cancel":{"method":"POST","path":"/cancel/{{taskId}}"},`, wantErr: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			adapter, err := LoadManifest([]byte(sprintfManifest(base, tc.cancellation)))
			if tc.wantErr {
				if err == nil {
					t.Fatal("manifest without a valid cancellation boundary was accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			metadata := adapter.Metadata()
			if tc.name == "nonCancelable" && (!metadata.NonCancelable || metadata.NonCancelableReason != "upstream has no cancellation endpoint") {
				t.Fatalf("metadata = %#v", metadata)
			}
			if tc.name == "cancel" && metadata.NonCancelable {
				t.Fatalf("cancelable provider was marked nonCancelable: %#v", metadata)
			}
		})
	}
}

func sprintfManifest(base, cancellation string) string {
	const marker = "%s"
	for i := 0; i+len(marker) <= len(base); i++ {
		if base[i:i+len(marker)] == marker {
			return base[:i] + cancellation + base[i+len(marker):]
		}
	}
	panic("manifest fixture marker not found")
}
