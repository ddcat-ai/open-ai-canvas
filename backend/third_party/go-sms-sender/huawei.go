// Copyright 2021 The Casdoor Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package go_sms_sender

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	WSSE_HEADER_FORMAT = "UsernameToken Username=\"%s\",PasswordDigest=\"%s\",Nonce=\"%s\",Created=\"%s\""
	AUTH_HEADER_VALUE  = "WSSE realm=\"SDP\",profile=\"UsernameToken\",type=\"Appkey\""
)

type HuaweiClient struct {
	accessId   string
	accessKey  string
	sign       string
	template   string
	apiAddress string
	sender     string
}

func GetHuaweiClient(accessId string, accessKey string, sign string, template string, other []string) (*HuaweiClient, error) {
	if len(other) < 2 {
		return nil, fmt.Errorf("missing parameter: apiAddress or sender")
	}

	apiAddress := fmt.Sprintf("%s/sms/batchSendSms/v1", other[0])

	huaweiClient := &HuaweiClient{
		accessId:   accessId,
		accessKey:  accessKey,
		sign:       sign,
		template:   template,
		apiAddress: apiAddress,
		sender:     other[1],
	}

	return huaweiClient, nil
}

// SendMessage https://support.huaweicloud.com/intl/en-us/devg-msgsms/sms_04_0012.html
func (c *HuaweiClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	phoneNumbers := strings.Join(targetPhoneNumber, ",")
	templateParas := fmt.Sprintf("[\"%s\"]", code)

	body := buildRequestBody(c.sender, phoneNumbers, c.template, templateParas, "", c.sign)
	headers := make(map[string]string)
	headers["Content-Type"] = "application/x-www-form-urlencoded"
	headers["Authorization"] = AUTH_HEADER_VALUE
	headers["X-WSSE"] = buildWsseHeader(c.accessId, c.accessKey)

	_, err := post(c.apiAddress, []byte(body), headers)
	return err
}

func buildRequestBody(sender, receiver, templateId, templateParas, statusCallBack, signature string) string {
	param := "from=" + url.QueryEscape(sender) + "&to=" + url.QueryEscape(receiver) + "&templateId=" + url.QueryEscape(templateId)
	if templateParas != "" {
		param += "&templateParas=" + url.QueryEscape(templateParas)
	}
	if statusCallBack != "" {
		param += "&statusCallback=" + url.QueryEscape(statusCallBack)
	}
	if signature != "" {
		param += "&signature=" + url.QueryEscape(signature)
	}
	return param
}

func buildWsseHeader(appKey, appSecret string) string {
	cTime := time.Now().Format("2006-01-02T15:04:05Z")
	nonce := uuid.New().String()
	nonce = strings.ReplaceAll(nonce, "-", "")

	h := sha256.New()
	h.Write([]byte(nonce + cTime + appSecret))
	passwordDigestBase64Str := base64.StdEncoding.EncodeToString(h.Sum(nil))

	return fmt.Sprintf(WSSE_HEADER_FORMAT, appKey, passwordDigestBase64Str, nonce, cTime)
}

func post(url string, param []byte, headers map[string]string) (string, error) {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(param))
	if err != nil {
		return "", err
	}

	for key, header := range headers {
		req.Header.Set(key, header)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}
