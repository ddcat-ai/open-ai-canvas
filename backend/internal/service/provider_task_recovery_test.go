package service

import "testing"

func TestRefundedProviderResultRecoveryAllowed(t *testing.T) {
	for _, message := range []string{
		"声明式协议媒体结果下载失败：外部服务地址无效",
		"声明式协议已完成但没有返回媒体地址",
		"人工查询已取得视频，但结果保存失败",
	} {
		if !refundedProviderResultRecoveryAllowed(message) {
			t.Errorf("expected recovery to be allowed for %q", message)
		}
	}
	for _, message := range []string{"模型服务拒绝了请求", "上游 HTTP 404", "任务超时"} {
		if refundedProviderResultRecoveryAllowed(message) {
			t.Errorf("unexpected refunded recovery permission for %q", message)
		}
	}
}
