// Package eventstream decodes the event and data fields of upstream SSE responses.
package eventstream

import (
	"bytes"
	"strings"
)

// Decoder belongs to one response. Discard it on EOF: only a blank line
// dispatches an event, even when the final data line contains valid JSON.
type Decoder struct {
	line    bytes.Buffer
	afterCR bool
	started bool
	event   string
	data    []string
}

func (d *Decoder) Feed(chunk []byte, emit func(event, data string)) {
	for len(chunk) > 0 {
		if d.afterCR {
			d.afterCR = false
			if chunk[0] == '\n' {
				chunk = chunk[1:]
				continue
			}
		}
		end := bytes.IndexAny(chunk, "\r\n")
		if end < 0 {
			d.line.Write(chunk)
			return
		}
		d.line.Write(chunk[:end])
		d.afterCR = chunk[end] == '\r'
		chunk = chunk[end+1:]
		line := d.line.String()
		d.line.Reset()
		if !d.started {
			line = strings.TrimPrefix(line, "\uFEFF")
			d.started = true
		}
		if line == "" {
			if len(d.data) > 0 {
				emit(d.event, strings.Join(d.data, "\n"))
			}
			d.event, d.data = "", nil
			continue
		}
		field, value, _ := strings.Cut(line, ":")
		switch field {
		case "data":
			d.data = append(d.data, strings.TrimPrefix(value, " "))
		case "event":
			d.event = strings.TrimPrefix(value, " ")
		}
	}
}
