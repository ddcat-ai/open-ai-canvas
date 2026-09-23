// Copyright 2023 The Casdoor Authors. All Rights Reserved.
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
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type GCCPAYClient struct {
	clientname string
	secret     string
	template   string
}

type params struct {
	Mobile         string            `json:"mobile"`
	TemplateCode   string            `json:"template_code"`
	TemplateParams map[string]string `json:"template_params"`
}

func GetGCCPAYClient(clientname string, secret string, template string) (*GCCPAYClient, error) {
	gccPayClient := &GCCPAYClient{
		clientname: clientname,
		secret:     secret,
		template:   template,
	}

	return gccPayClient, nil
}

func RandStringBytesCrypto(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func Md5(str string) string {
	h := md5.New()
	h.Write([]byte(str))
	return hex.EncodeToString(h.Sum(nil))
}

func (c *GCCPAYClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	_, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	reqParams := make(map[string]params)

	for _, mobile := range targetPhoneNumber {
		if strings.HasPrefix(mobile, "+") {
			mobile = mobile[1:]
		}
		randomString, err := RandStringBytesCrypto(16)
		if err != nil {
			return fmt.Errorf("SMS key generation failed")
		}

		reqParams[randomString] = params{
			Mobile:         mobile,
			TemplateCode:   c.template,
			TemplateParams: param,
		}
	}

	requestBody := new(bytes.Buffer)
	err := json.NewEncoder(requestBody).Encode(reqParams)
	if err != nil {
		return fmt.Errorf("SMS sending failed")
	}

	// sign
	timestamp := time.Now().Unix()

	sign := Md5(fmt.Sprintf("%s%d%s", c.clientname, timestamp, c.secret))

	reqUrl := "https://smscenter.sgate.sa/api/v1/client/sendSms"

	// send request
	req, _ := http.NewRequest("POST", reqUrl, requestBody)
	req.Header.Set("clientname", c.clientname)
	req.Header.Set("timestamp", fmt.Sprintf("%d", timestamp))
	req.Header.Set("sign", sign)
	req.Header.Set("content-type", "application/json;")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}

	err = resp.Body.Close()
	if err != nil {
		return err
	}

	return nil
}
