package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptrace"
	"sort"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/client"
	"github.com/aws/aws-sdk-go/service/s3"
	"yingce/backend/internal/outbound"
)

var errSlowObjectRead = fmt.Errorf("对象存储读取过慢：%w", context.DeadlineExceeded)
var errObjectReadChanged = errors.New("续读对象的版本或区间与原下载不一致")

const tosPeerCooldown = 5 * time.Minute

var tosReadInterval = 5 * time.Second

var slowTOSPeers = struct {
	sync.Mutex
	until map[string]time.Time
}{until: make(map[string]time.Time)}

type readLogIDs struct{ resource, task string }

func WithReadLogIDs(ctx context.Context, resourceID, taskID string) context.Context {
	return context.WithValue(ctx, readLogIDs{}, readLogIDs{resourceID, taskID})
}

func preferHealthyTOSPeers(host string, peers []outbound.ReadPeer) {
	slowTOSPeers.Lock()
	defer slowTOSPeers.Unlock()
	now := time.Now()
	sort.SliceStable(peers, func(i, j int) bool {
		iSlow := slowTOSPeers.until[host+"/"+peers[i].Address()].After(now)
		jSlow := slowTOSPeers.until[host+"/"+peers[j].Address()].After(now)
		return !iSlow && jSlow
	})
}

func demoteTOSPeer(key string) {
	slowTOSPeers.Lock()
	defer slowTOSPeers.Unlock()
	now := time.Now()
	if len(slowTOSPeers.until) >= 256 {
		for peer, until := range slowTOSPeers.until {
			if !until.After(now) {
				delete(slowTOSPeers.until, peer)
			}
		}
	}
	if len(slowTOSPeers.until) < 256 {
		slowTOSPeers.until[key] = now.Add(tosPeerCooldown)
	}
}

type tosDownload struct {
	mu        sync.Mutex
	ctx       context.Context
	cancel    context.CancelFunc
	client    *s3.S3
	input     s3.GetObjectInput
	host      string
	peers     []outbound.ReadPeer
	peerIndex int
	attempt   *objectReadAttempt
	initial   objectReadSpan
	status    int
	delivered int64
	pending   error
	terminal  error
}

type objectReadSpan struct {
	start, end, total int64
	length            int64
	etag, version     string
}

func readTOSObject(ctx context.Context, setting Settings, key, rangeHeader string) (*ObjectStream, error) {
	ctx, cancel := context.WithTimeout(ctx, transferTimeout(setting))
	s3Client, err := NewS3Client(setting, 0)
	if err != nil {
		cancel()
		return nil, err
	}
	d := &tosDownload{ctx: ctx, cancel: cancel, client: s3Client, input: s3ObjectInput(setting, key, rangeHeader)}
	probe, _ := s3Client.GetObjectRequest(&d.input)
	if err := probe.Build(); err != nil {
		cancel()
		return nil, err
	}
	d.host = probe.HTTPRequest.URL.Host
	d.peers, err = outbound.ResolveReadPeers(ctx, probe.HTTPRequest.URL)
	if err != nil {
		cancel()
		return nil, err
	}
	preferHealthyTOSPeers(d.host, d.peers)
	d.peers = d.peers[:min(len(d.peers), 2)]
	stream, span, err := d.open(d.input)
	if err != nil && d.switchPeer(err) {
		stream, span, err = d.open(d.input)
	}
	if err != nil {
		d.finish("failed", err)
		return nil, err
	}
	d.initial = span
	d.status = stream.StatusCode
	stream.Body = d
	return stream, nil
}

func (d *tosDownload) open(input s3.GetObjectInput) (*ObjectStream, objectReadSpan, error) {
	peer := d.peers[d.peerIndex]
	attempt := newObjectReadAttempt(d.ctx, d.peerIndex+1 < len(d.peers))
	d.attempt = attempt
	req, data := d.client.GetObjectRequest(&input)
	req.SetContext(httptrace.WithClientTrace(attempt.ctx, &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			attempt.mu.Lock()
			attempt.peer = info.Conn.RemoteAddr().String()
			attempt.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			attempt.mu.Lock()
			attempt.firstByte = time.Since(attempt.start)
			attempt.mu.Unlock()
		},
	}))
	req.HTTPRequest.Header.Set("Accept-Encoding", "identity")
	req.Retryer = client.NoOpRetryer{}
	req.Config.HTTPClient = peer.Client()
	attempt.begin()
	err := req.Send()
	attempt.end(0)
	if err != nil {
		if cause := context.Cause(attempt.ctx); cause != nil {
			return nil, objectReadSpan{}, cause
		}
		var failure requestFailure
		if errors.As(err, &failure) {
			switch failure.StatusCode() {
			case http.StatusRequestedRangeNotSatisfiable:
				if input.IfMatch == nil {
					attempt.body = http.NoBody
					return &ObjectStream{StatusCode: http.StatusRequestedRangeNotSatisfiable, AcceptRanges: "bytes", ContentRange: req.HTTPResponse.Header.Get("Content-Range")}, objectReadSpan{}, nil
				}
				return nil, objectReadSpan{}, errObjectReadChanged
			case http.StatusPreconditionFailed:
				return nil, objectReadSpan{}, errObjectReadChanged
			}
		}
		return nil, objectReadSpan{}, err
	}
	attempt.body = data.Body
	stream := &ObjectStream{
		StatusCode: req.HTTPResponse.StatusCode, ContentLength: req.HTTPResponse.ContentLength,
		ContentRange: aws.StringValue(data.ContentRange), AcceptRanges: "bytes",
	}
	span, err := objectSpan(stream, aws.StringValue(data.ETag), aws.StringValue(data.VersionId))
	if err != nil {
		return nil, objectReadSpan{}, err
	}
	attempt.setLength(span.length, strongObjectETag(span.etag))
	return stream, span, nil
}

type requestFailure interface{ StatusCode() int }

func objectSpan(stream *ObjectStream, etag, version string) (objectReadSpan, error) {
	length := stream.ContentLength
	span := objectReadSpan{end: length - 1, total: length, length: length, etag: etag, version: version}
	if stream.StatusCode == http.StatusPartialContent {
		_, err := fmt.Sscanf(stream.ContentRange, "bytes %d-%d/%d", &span.start, &span.end, &span.total)
		if err != nil || span.start < 0 || span.start > span.end || span.end >= span.total ||
			length != span.end-span.start+1 || stream.ContentRange != fmt.Sprintf("bytes %d-%d/%d", span.start, span.end, span.total) {
			return objectReadSpan{}, errors.New("对象存储返回了无效的文件区间")
		}
	}
	return span, nil
}

func strongObjectETag(etag string) bool {
	return len(etag) > 2 && etag[0] == '"' && etag[len(etag)-1] == '"'
}

func (d *tosDownload) switchPeer(err error) bool {
	if d.ctx.Err() != nil || d.peerIndex+1 >= len(d.peers) {
		return false
	}
	if !errors.Is(context.Cause(d.attempt.ctx), errSlowObjectRead) && !errors.Is(err, io.ErrUnexpectedEOF) && !ClassifyError(err).Transient {
		return false
	}
	demoteTOSPeer(d.host + "/" + d.peers[d.peerIndex].Address())
	d.attempt.finish("switched", err)
	d.peerIndex++
	return true
}

func (d *tosDownload) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.terminal != nil {
		return 0, d.terminal
	}
	for {
		if d.initial.length >= 0 && d.delivered == d.initial.length {
			d.finish("complete", nil)
			return 0, io.EOF
		}
		err := d.pending
		d.pending = nil
		if err == nil {
			buffer := p
			if remaining := d.initial.length - d.delivered; d.initial.length >= 0 && int64(len(buffer)) > remaining {
				buffer = buffer[:remaining]
			}
			d.attempt.begin()
			n, readErr := d.attempt.body.Read(buffer)
			d.attempt.end(n)
			d.delivered += int64(n)
			if d.initial.length >= 0 && d.delivered == d.initial.length {
				d.finish("complete", nil)
				return n, io.EOF
			}
			if n > 0 || readErr == nil {
				d.pending = readErr
				return n, nil
			}
			err = readErr
		}
		if cause := context.Cause(d.attempt.ctx); cause != nil {
			err = cause
		}
		if errors.Is(err, io.EOF) {
			if d.initial.length < 0 {
				d.finish("complete", nil)
				return 0, io.EOF
			}
			err = io.ErrUnexpectedEOF
		}
		canResume := d.delivered == 0 || (d.initial.length >= 0 && strongObjectETag(d.initial.etag))
		if !canResume || !d.switchPeer(err) {
			d.finish("failed", err)
			return 0, err
		}
		input := d.input
		if strongObjectETag(d.initial.etag) {
			input.IfMatch = aws.String(d.initial.etag)
		}
		if d.delivered > 0 {
			input.Range = aws.String(fmt.Sprintf("bytes=%d-%d", d.initial.start+d.delivered, d.initial.end))
		}
		stream, span, err := d.open(input)
		expectedStatus := d.status
		if d.delivered > 0 {
			expectedStatus = http.StatusPartialContent
		}
		if err == nil && (stream.StatusCode != expectedStatus ||
			span.start != d.initial.start+d.delivered || span.end != d.initial.end || span.total != d.initial.total ||
			span.etag != d.initial.etag || span.version != d.initial.version) {
			err = errObjectReadChanged
		}
		if err != nil {
			d.finish("failed", err)
			return 0, err
		}
	}
}

func (d *tosDownload) Close() error {
	d.cancel()
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.finish("closed", nil)
}

func (d *tosDownload) finish(outcome string, err error) error {
	defer d.cancel()
	if d.terminal == nil {
		d.terminal = err
		if err == nil {
			d.terminal = io.EOF
		}
	}
	if outcome == "complete" && d.peerIndex > 0 {
		outcome = "recovered"
	}
	return d.attempt.finish(outcome, err)
}

type objectReadAttempt struct {
	ctx    context.Context
	cancel context.CancelCauseFunc
	body   io.ReadCloser
	start  time.Time
	closed bool

	mu                          sync.Mutex
	peer                        string
	waiting                     time.Time
	active, lastData, firstByte time.Duration
	bytes, length               int64
	resumable                   bool
	stalled                     bool
}

func newObjectReadAttempt(parent context.Context, hasAlternate bool) *objectReadAttempt {
	ctx, cancel := context.WithCancelCause(parent)
	a := &objectReadAttempt{ctx: ctx, cancel: cancel, start: time.Now(), length: -1}
	if hasAlternate {
		go a.watch(tosReadInterval)
	}
	return a
}

func (a *objectReadAttempt) begin() {
	a.mu.Lock()
	a.waiting = time.Now()
	a.mu.Unlock()
}

func (a *objectReadAttempt) end(n int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	wait := time.Since(a.waiting)
	a.active += wait
	a.stalled = a.stalled || wait >= 2*tosReadInterval
	a.waiting = time.Time{}
	if n > 0 {
		a.bytes += int64(n)
		a.lastData = a.active
	}
}

func (a *objectReadAttempt) setLength(length int64, resumable bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.length, a.resumable = length, resumable
}

func (a *objectReadAttempt) watch(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	deadline, _ := a.ctx.Deadline()
	var prevActive time.Duration
	var prevBytes int64
	slowWindows := 0
	for {
		select {
		case <-a.ctx.Done():
			return
		case now := <-ticker.C:
			a.mu.Lock()
			active, last, bytes, length := a.active, a.lastData, a.bytes, a.length
			waiting, resumable := a.waiting, a.resumable
			a.mu.Unlock()
			if !waiting.IsZero() {
				active += max(now.Sub(waiting), 0)
			}
			if (bytes == 0 || resumable) && length != bytes && !waiting.IsZero() {
				if active-last >= 2*interval {
					a.cancel(errSlowObjectRead)
					return
				}
				// Backpressure from an exporter or browser is not time spent reading the peer.
				if length > bytes && active-prevActive >= interval/2 &&
					float64(length-bytes)*float64(active-prevActive) > float64(bytes-prevBytes)*float64(deadline.Sub(now)) {
					slowWindows++
					if slowWindows >= 2 {
						a.cancel(errSlowObjectRead)
						return
					}
				} else {
					slowWindows = 0
				}
			} else {
				slowWindows = 0
			}
			prevActive, prevBytes = active, bytes
		}
	}
}

func (a *objectReadAttempt) finish(outcome string, err error) error {
	if a.closed {
		return nil
	}
	a.closed = true
	cause := context.Cause(a.ctx)
	a.cancel(nil)
	var closeErr error
	if a.body != nil {
		closeErr = a.body.Close()
	}
	logFailure := outcome == "failed" && !errors.Is(err, context.Canceled)
	if outcome == "switched" || outcome == "recovered" || logFailure || outcome == "complete" && a.stalled {
		a.mu.Lock()
		peer, firstByte := a.peer, a.firstByte
		a.mu.Unlock()
		ids, _ := a.ctx.Value(readLogIDs{}).(readLogIDs)
		reason := ClassifyError(err).Code
		if errors.Is(cause, errSlowObjectRead) || outcome == "complete" && a.stalled {
			reason = "slow_read"
		} else if errors.Is(err, io.ErrUnexpectedEOF) {
			reason = "short_read"
		} else if err != nil && reason == "" {
			reason = "storage_read_failed"
		}
		slog.InfoContext(a.ctx, "TOS object read", "outcome", outcome, "reason", reason,
			"resourceId", ids.resource, "taskId", ids.task, "peer", peer, "firstByteMs", firstByte.Milliseconds(),
			"bytes", a.bytes, "expectedBytes", a.length, "elapsedMs", time.Since(a.start).Milliseconds())
	}
	return closeErr
}
