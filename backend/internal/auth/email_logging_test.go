package auth

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

func captureSMTPLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &output
}

func TestEmailDeliveryLogsFailureWithoutSecrets(t *testing.T) {
	output := captureSMTPLogs(t)
	setting := EmailSettingValue{Host: "smtp.example.com", Port: 587, Encryption: "starttls", Username: "smtp-user", Password: "smtp-secret", FromEmail: "sender@example.com"}
	recipient, subject, body := "reader@example.com", "Verification", "Your verification code is 123456."
	secrets := []string{setting.Username, setting.Password, setting.FromEmail, recipient, subject, body, "123456", "\x00" + setting.Username + "\x00" + setting.Password}
	detail := "535 5.7.8 Authentication credentials invalid"
	for _, secret := range secrets {
		detail += " " + secret + " " + base64.StdEncoding.EncodeToString([]byte(secret))
	}
	deliveryErr := errors.New(detail)
	svc := New(nil, nil, func(EmailSettingValue, string, string, string) error { return deliveryErr })
	if err := svc.deliverEmail(setting, EmailDelivery{Recipient: recipient, Mail: OutgoingMail{Subject: subject, Text: body}}); err != deliveryErr {
		t.Fatalf("delivery error was changed: %v", err)
	}
	var entry struct {
		Level, Msg, Host, Encryption, Recipient, Error string
		Port                                           int
	}
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("expected exactly one JSON log entry: %v", err)
	}
	if entry.Level != "ERROR" || entry.Msg != "smtp email delivery failed" || entry.Host != setting.Host || entry.Port != setting.Port || entry.Encryption != setting.Encryption || entry.Recipient != maskedEmail(recipient) {
		t.Fatalf("missing SMTP log context: %+v", entry)
	}
	if !strings.Contains(entry.Error, "535 5.7.8 Authentication credentials invalid") {
		t.Fatalf("SMTP failure detail was lost: %q", entry.Error)
	}
	for _, secret := range secrets {
		if strings.Contains(entry.Error, secret) || strings.Contains(entry.Error, base64.StdEncoding.EncodeToString([]byte(secret))) {
			t.Fatalf("SMTP log contains sensitive value %q", secret)
		}
	}
	svc.SetMailSender(func(EmailSettingValue, string, string, string) error { return nil })
	output.Reset()
	if err := svc.deliverEmail(setting, EmailDelivery{Recipient: recipient, Mail: OutgoingMail{Subject: subject, Text: body}}); err != nil || output.Len() != 0 {
		t.Fatalf("successful delivery produced an error/log: %v %s", err, output.String())
	}
}

func TestSMTPDeliveryLogsProtocolFailureStage(t *testing.T) {
	type exchange struct{ command, reply string }
	for _, test := range []struct {
		name, encryption, username, stage, detail string
		exchanges                                 []exchange
	}{
		{name: "greeting", stage: "greeting", detail: "554 SMTP service unavailable", exchanges: []exchange{{"", "554 SMTP service unavailable\r\n"}}},
		{name: "starttls", encryption: "starttls", stage: "starttls", detail: "454 TLS temporarily unavailable", exchanges: []exchange{
			{"", "220 localhost\r\n"}, {"EHLO ", "250-localhost\r\n250 STARTTLS\r\n"}, {"STARTTLS", "454 TLS temporarily unavailable\r\n"},
		}},
		{name: "auth", username: "smtp-user", stage: "auth", detail: "535 5.7.8 Authentication credentials invalid", exchanges: []exchange{
			{"", "220 localhost\r\n"}, {"EHLO ", "250-localhost\r\n250 AUTH PLAIN\r\n"}, {"AUTH PLAIN ", "535 5.7.8 Authentication credentials invalid\r\n"},
		}},
		{name: "recipient", stage: "rcpt_to", detail: "550 5.1.1 Recipient rejected", exchanges: []exchange{
			{"", "220 localhost\r\n"}, {"EHLO ", "250 localhost\r\n"}, {"MAIL FROM:", "250 OK\r\n"}, {"RCPT TO:", "550 5.1.1 Recipient rejected\r\n"},
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			output := captureSMTPLogs(t)
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			done := make(chan error, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					done <- err
					return
				}
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(3 * time.Second))
				reader := bufio.NewReader(conn)
				for _, step := range test.exchanges {
					if step.command != "" {
						line, err := reader.ReadString('\n')
						if err != nil || !strings.HasPrefix(line, step.command) {
							done <- fmt.Errorf("expected command %q, got %q: %v", step.command, line, err)
							return
						}
					}
					if _, err := fmt.Fprint(conn, step.reply); err != nil {
						done <- err
						return
					}
				}
				done <- nil
			}()
			setting := EmailSettingValue{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Encryption: test.encryption, Username: test.username, Password: "smtp-secret", FromEmail: "sender@example.com"}
			err = New(nil, nil, nil).deliverEmail(setting, EmailDelivery{Recipient: "reader@example.com", Mail: OutgoingMail{Subject: "Verification", Text: "Your code is 123456."}})
			if serverErr := <-done; serverErr != nil {
				t.Fatal(serverErr)
			}
			var reply *textproto.Error
			if err == nil || !strings.HasPrefix(err.Error(), "smtp "+test.stage+": ") || !errors.As(err, &reply) || fmt.Sprintf("%d %s", reply.Code, reply.Msg) != test.detail {
				t.Fatalf("expected SMTP stage and reply, got %v", err)
			}
			var entry struct{ Error string }
			if jsonErr := json.Unmarshal(output.Bytes(), &entry); jsonErr != nil || entry.Error != err.Error() {
				t.Fatalf("missing detailed failure log: %s", output.String())
			}
		})
	}
}
