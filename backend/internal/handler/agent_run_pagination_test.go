package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 运行详情分页参数（?sinceSeq= / ?eventLimit=）。合法值按原样进入视图选项，
// 非法或越界一律拒绝：静默夹取会让客户端以为拿到的是它请求的那一页，
// 从而把缺口当成"没有更多记录"。
func TestAgentRunViewOptionsParsesPaginationQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, testCase := range []struct {
		query                        string
		wantSinceSeq, wantEventLimit int
	}{
		{query: "", wantSinceSeq: 0, wantEventLimit: 0},
		{query: "?sinceSeq=0", wantSinceSeq: 0, wantEventLimit: 0},
		{query: "?sinceSeq=12", wantSinceSeq: 12, wantEventLimit: 0},
		{query: "?eventLimit=1", wantSinceSeq: 0, wantEventLimit: 1},
		{query: "?eventLimit=500", wantSinceSeq: 0, wantEventLimit: 500},
		{query: "?sinceSeq=12&eventLimit=50", wantSinceSeq: 12, wantEventLimit: 50},
		{query: "?sinceSeq=%203%20&eventLimit=%207%20", wantSinceSeq: 3, wantEventLimit: 7},
	} {
		t.Run(testCase.query, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/api/agent/runs/run-1"+testCase.query, nil)
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = request
			options, err := agentRunViewOptions(context)
			if err != nil {
				t.Fatalf("%s 被拒绝: %v", testCase.query, err)
			}
			if options.SinceSeq != testCase.wantSinceSeq || options.EventLimit != testCase.wantEventLimit {
				t.Fatalf("%s 解析为 %+v，期望 sinceSeq=%d eventLimit=%d", testCase.query, options, testCase.wantSinceSeq, testCase.wantEventLimit)
			}
		})
	}
}

func TestAgentRunViewOptionsRejectsInvalidPaginationQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, query := range []string{
		"?sinceSeq=abc",
		"?sinceSeq=-1",
		"?sinceSeq=1.5",
		"?sinceSeq=99999999999999999999",
		"?eventLimit=0",
		"?eventLimit=501",
		"?eventLimit=-5",
		"?eventLimit=abc",
	} {
		t.Run(query, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/api/agent/runs/run-1"+query, nil)
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = request
			if options, err := agentRunViewOptions(context); err == nil {
				t.Fatalf("%s 未被拒绝，解析为 %+v", query, options)
			}
		})
	}
}
