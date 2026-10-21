package invite

import (
	"crypto/rand"
	"errors"
	"strings"
)

// inviteCodeAlphabet 去除 0/O/1/I/L 等易混字符的可分享字母表。
const inviteCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

const inviteCodeLength = 8

// GenerateInviteCode 生成 8 位随机邀请码。全局唯一性由数据库部分唯一索引与
// 调用方的冲突重试兜底。
func GenerateInviteCode() (string, error) {
	buf := make([]byte, inviteCodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := make([]byte, inviteCodeLength)
	for i, b := range buf {
		code[i] = inviteCodeAlphabet[int(b)%len(inviteCodeAlphabet)]
	}
	return string(code), nil
}

// NormalizeInviteCode 归一化用户输入的邀请码：去空白并转大写。
func NormalizeInviteCode(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

// ValidateInviteCode 校验邀请码格式；空串表示未填写（选填合法）。
func ValidateInviteCode(value string) error {
	if value == "" {
		return nil
	}
	if len(value) != inviteCodeLength {
		return errors.New("邀请码格式不正确")
	}
	for _, char := range value {
		if !strings.ContainsRune(inviteCodeAlphabet, char) {
			return errors.New("邀请码格式不正确")
		}
	}
	return nil
}
