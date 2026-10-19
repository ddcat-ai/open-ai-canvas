package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"testing"
	"time"
)

// Google id_token 验签是安全边界：不验签就等于让任何人伪造 email 登录任意账号。
// 这里用本地生成的 RSA 密钥对构造真实 JWT，覆盖签名、iss、aud、exp、email_verified 五项。

func testRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func signTestJWT(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header := map[string]any{"alg": "RS256", "kid": kid, "typ": "JWT"}
	headerBytes, _ := json.Marshal(header)
	claimsBytes, _ := json.Marshal(claims)
	signingInput := base64.RawURLEncoding.EncodeToString(headerBytes) + "." + base64.RawURLEncoding.EncodeToString(claimsBytes)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func validGoogleClaims(clientID string) map[string]any {
	return map[string]any{
		"sub":            "google-subject-1",
		"email":          "user@example.com",
		"email_verified": true,
		"name":           "Test User",
		"picture":        "https://example.com/a.png",
		"aud":            clientID,
		"iss":            "https://accounts.google.com",
		"exp":            time.Now().Add(time.Hour).Unix(),
		"iat":            time.Now().Unix(),
	}
}

// newTestServiceWithKey 构造一个注入了测试公钥的 Service，绕开网络。
func newTestServiceWithKey(key *rsa.PrivateKey, kid string) *Service {
	svc := &Service{}
	svc.googleKeys.store(map[string]*rsa.PublicKey{
		kid: {N: new(big.Int).Set(key.N), E: key.E},
	})
	return svc
}

func TestVerifyGoogleIDToken(t *testing.T) {
	key := testRSAKey(t)
	const clientID = "test-client.apps.googleusercontent.com"
	const kid = "test-kid-1"

	t.Run("合法令牌", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		token := signTestJWT(t, key, kid, validGoogleClaims(clientID))
		claims, err := svc.verifyGoogleIDToken(t.Context(), token, clientID)
		if err != nil {
			t.Fatalf("不应报错：%v", err)
		}
		if claims.Subject != "google-subject-1" || claims.Email != "user@example.com" {
			t.Fatalf("claims 解析错误：%+v", claims)
		}
	})

	t.Run("受众不匹配", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		token := signTestJWT(t, key, kid, validGoogleClaims("other-client"))
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("aud 不匹配时必须拒绝")
		}
	})

	t.Run("签发方不匹配", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		claims := validGoogleClaims(clientID)
		claims["iss"] = "https://evil.example.com"
		token := signTestJWT(t, key, kid, claims)
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("iss 不匹配时必须拒绝")
		}
	})

	t.Run("已过期", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		claims := validGoogleClaims(clientID)
		claims["exp"] = time.Now().Add(-time.Minute).Unix()
		token := signTestJWT(t, key, kid, claims)
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("过期令牌必须拒绝")
		}
	})

	t.Run("邮箱未验证", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		claims := validGoogleClaims(clientID)
		claims["email_verified"] = false
		token := signTestJWT(t, key, kid, claims)
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("邮箱未验证必须拒绝")
		}
	})

	t.Run("签名被篡改", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		token := signTestJWT(t, key, kid, validGoogleClaims(clientID))
		// 改掉最后一个字符，签名失效。
		last := token[len(token)-1]
		replacement := byte('A')
		if last == 'A' {
			replacement = 'B'
		}
		tampered := token[:len(token)-1] + string(replacement)
		if _, err := svc.verifyGoogleIDToken(t.Context(), tampered, clientID); err == nil {
			t.Fatal("签名篡改必须拒绝")
		}
	})

	t.Run("换密钥签名", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		otherKey := testRSAKey(t)
		token := signTestJWT(t, otherKey, kid, validGoogleClaims(clientID))
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("非对应私钥签名必须拒绝")
		}
	})

	t.Run("alg=none 攻击", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
		claimsBytes, _ := json.Marshal(validGoogleClaims(clientID))
		payload := base64.RawURLEncoding.EncodeToString(claimsBytes)
		token := header + "." + payload + "."
		if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
			t.Fatal("alg=none 必须拒绝")
		}
	})

	t.Run("格式错误", func(t *testing.T) {
		svc := newTestServiceWithKey(key, kid)
		for _, token := range []string{"", "abc", "a.b", "a.b.c.d"} {
			if _, err := svc.verifyGoogleIDToken(t.Context(), token, clientID); err == nil {
				t.Fatalf("格式 %q 必须拒绝", token)
			}
		}
	})
}

func TestValidateGoogleSetting(t *testing.T) {
	tests := []struct {
		name    string
		value   googleSettingValue
		wantErr bool
	}{
		{"未启用可空", googleSettingValue{Enabled: false}, false},
		{"启用缺 ClientID", googleSettingValue{Enabled: true, ClientSecret: "s", RedirectURL: "https://a.com/cb"}, true},
		{"启用缺回调", googleSettingValue{Enabled: true, ClientID: "c", ClientSecret: "s"}, true},
		{"回调非 HTTPS", googleSettingValue{Enabled: true, ClientID: "c", ClientSecret: "s", RedirectURL: "http://example.com/cb"}, true},
		{"本地回环允许 HTTP", googleSettingValue{Enabled: true, ClientID: "c", ClientSecret: "s", RedirectURL: "http://localhost:3000/cb"}, false},
		{"启用完整", googleSettingValue{Enabled: true, ClientID: "c", ClientSecret: "s", RedirectURL: "https://a.com/cb"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateGoogleSetting(normalizeGoogleSetting(tt.value))
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateGoogleSetting() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
