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
	"fmt"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/sns"
	"github.com/aws/aws-sdk-go/service/sns/snsiface"
)

type AmazonSNSClient struct {
	svc      snsiface.SNSAPI
	template string
}

func GetAmazonSNSClient(accessKeyID string, secretAccessKey string, template string, region []string) (*AmazonSNSClient, error) {
	if len(region) == 0 {
		return nil, fmt.Errorf("missing parameter: region")
	}

	sess, err := session.NewSession(&aws.Config{
		Region:      aws.String(region[0]),
		Credentials: credentials.NewStaticCredentials(accessKeyID, secretAccessKey, ""),
	})
	if err != nil {
		return nil, err
	}

	svc := sns.New(sess)

	snsClient := &AmazonSNSClient{
		svc:      svc,
		template: template,
	}

	return snsClient, nil
}

func (a *AmazonSNSClient) SendMessage(param map[string]string, targetPhoneNumber ...string) error {
	code, ok := param["code"]
	if !ok {
		return fmt.Errorf("missing parameter: code")
	}

	bodyContent := fmt.Sprintf(a.template, code)

	if len(targetPhoneNumber) == 0 {
		return fmt.Errorf("missing parameter: targetPhoneNumber")
	}

	messageAttributes := make(map[string]*sns.MessageAttributeValue)
	for k, v := range param {
		messageAttributes[k] = &sns.MessageAttributeValue{
			DataType:    aws.String("String"),
			StringValue: aws.String(v),
		}
	}

	for i := 0; i < len(targetPhoneNumber); i++ {
		_, err := a.svc.Publish(&sns.PublishInput{
			Message:           &bodyContent,
			PhoneNumber:       &targetPhoneNumber[i],
			MessageAttributes: messageAttributes,
		})
		if err != nil {
			return err
		}
	}

	return nil
}
