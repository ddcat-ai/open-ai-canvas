package protocol

import "testing"

func TestBusinessFailureUsesDeclaredPaths(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-wan3-video.yingce-plugin", "dashscope-wan3-video")
	code, message, ok := BusinessFailure(adapter, []byte(`{"output":{"code":"InvalidParameter","message":"bad resolution"}}`))
	if !ok || code != "InvalidParameter" || message != "bad resolution" {
		t.Fatalf("got (%q, %q, %v)", code, message, ok)
	}
	if _, _, ok := BusinessFailure(adapter, []byte(`{"output":{"task_status":"PENDING"}}`)); ok {
		t.Fatal("pending should not fail")
	}
}
