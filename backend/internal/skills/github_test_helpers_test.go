package skills

import (
	"io"
	"net/http"
	"strings"
)

type githubRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn githubRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
func githubTestResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
