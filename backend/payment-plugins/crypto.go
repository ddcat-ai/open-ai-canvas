package paymentplugins

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

func parseRSAPrivateKey(value string) (*rsa.PrivateKey, error) {
	der, ok := decodePEMOrBase64(value)
	if !ok {
		return nil, errors.New("RSA 私钥 PEM 或 Base64 格式无效")
	}
	if key, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
	}
	if key, err := x509.ParsePKCS1PrivateKey(der); err == nil {
		return key, nil
	}
	return nil, errors.New("RSA 私钥必须为 PKCS#1 或 PKCS#8 格式")
}

func parseRSAPublicKey(value string) (*rsa.PublicKey, error) {
	der, ok := decodePEMOrBase64(value)
	if !ok {
		return nil, errors.New("RSA 公钥 PEM 或 Base64 格式无效")
	}
	if key, err := x509.ParsePKIXPublicKey(der); err == nil {
		if rsaKey, ok := key.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	if key, err := x509.ParsePKCS1PublicKey(der); err == nil {
		return key, nil
	}
	if certificate, err := x509.ParseCertificate(der); err == nil {
		if rsaKey, ok := certificate.PublicKey.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	return nil, errors.New("RSA 公钥格式无效")
}

func decodePEMOrBase64(value string) ([]byte, bool) {
	normalized := strings.TrimSpace(value)
	if block, _ := pem.Decode([]byte(normalized)); block != nil {
		return block.Bytes, true
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(normalized), ""))
	if err != nil || len(decoded) == 0 {
		return nil, false
	}
	return decoded, true
}

func rsaSHA256Sign(privateKey *rsa.PrivateKey, content []byte) (string, error) {
	digest := sha256.Sum256(content)
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func rsaSHA256Verify(publicKey *rsa.PublicKey, content []byte, signature string) error {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return fmt.Errorf("签名不是有效 Base64：%w", err)
	}
	digest := sha256.Sum256(content)
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], decoded); err != nil {
		return errors.New("RSA2 签名验证失败")
	}
	return nil
}
