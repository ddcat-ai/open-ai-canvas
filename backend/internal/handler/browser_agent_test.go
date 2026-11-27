package handler

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
	"yingce/backend/internal/service"
)

func TestBrowserAgentInputRejectsPrivateFieldsAndTrailingData(t *testing.T) {
	for _, body := range []string{`{"protocolVersion":1,"owner":"browser","messages":["secret"]}`, `{"protocolVersion":1,"owner":"browser"} {}`, strings.Repeat("x", 5000)} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(body))
		var input service.BrowserAgentControl
		if err := decodeBrowserInput(c, &input, 4096); err == nil {
			t.Fatal("invalid browser input accepted")
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"events":[{"eventId":"event","message":"secret"}]}`))
	var input struct {
		Events []service.ClientFailureInput `json:"events"`
	}
	if err := decodeBrowserInput(c, &input, 64<<10); err == nil {
		t.Fatal("private log field accepted")
	}
}
