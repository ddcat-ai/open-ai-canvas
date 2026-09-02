package paymentplugins

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

const (
	maxTradeBillBytes   = 64 << 20
	maxTradeBillRecords = 500_000
)

func parseWeChatTradeBill(raw []byte) ([]BillRecord, error) {
	rows, err := readBillCSV(raw)
	if err != nil {
		return nil, fmt.Errorf("解析微信交易账单：%w", err)
	}
	headerIndex, columns := findBillHeader(rows, []string{"商户订单号", "微信订单号", "交易状态"})
	if headerIndex < 0 {
		return nil, errors.New("微信交易账单缺少明细表头")
	}
	amountColumn := firstBillColumn(columns, "订单金额", "总金额", "应结订单金额")
	if amountColumn < 0 {
		return nil, errors.New("微信交易账单缺少订单金额")
	}
	records := make([]BillRecord, 0, len(rows)-headerIndex-1)
	for _, row := range rows[headerIndex+1:] {
		if len(records) >= maxTradeBillRecords {
			return nil, errors.New("微信交易账单记录数超过安全限制")
		}
		status := billCell(row, columns["交易状态"])
		if status != "SUCCESS" {
			continue
		}
		merchantOrderNo := billCell(row, columns["商户订单号"])
		providerTradeNo := billCell(row, columns["微信订单号"])
		if merchantOrderNo == "" || providerTradeNo == "" {
			continue
		}
		amountFen, err := parseYuanToFen(billCell(row, amountColumn))
		if err != nil {
			return nil, fmt.Errorf("微信订单 %s 金额无效", merchantOrderNo)
		}
		currency := "CNY"
		if column := firstBillColumn(columns, "货币种类"); column >= 0 {
			if value := billCell(row, column); value != "" {
				currency = value
			}
		}
		paidAt := parseBillTime(billCell(row, firstBillColumn(columns, "交易时间")))
		records = append(records, BillRecord{
			MerchantOrderNo: merchantOrderNo, ProviderTradeNo: providerTradeNo,
			ProviderStatus: status, AmountFen: amountFen, Currency: currency, PaidAt: paidAt,
		})
	}
	return records, nil
}

func parseAlipayTradeBill(raw []byte) ([]BillRecord, error) {
	files, err := alipayBillFiles(raw)
	if err != nil {
		return nil, err
	}
	recordsByOrder := make(map[string]BillRecord)
	foundHeader := false
	for _, file := range files {
		rows, err := readBillCSV(decodeAlipayBill(file))
		if err != nil {
			continue
		}
		headerIndex, columns := findBillHeader(rows, []string{"商户订单号", "支付宝交易号"})
		if headerIndex < 0 {
			continue
		}
		foundHeader = true
		amountColumn := firstBillColumn(columns, "订单金额（元）", "订单金额(元)", "订单金额")
		if amountColumn < 0 {
			continue
		}
		businessColumn := firstBillColumn(columns, "业务类型", "交易状态")
		paidAtColumn := firstBillColumn(columns, "完成时间", "交易付款时间", "交易时间")
		for _, row := range rows[headerIndex+1:] {
			if len(recordsByOrder) >= maxTradeBillRecords {
				return nil, errors.New("支付宝交易账单记录数超过安全限制")
			}
			business := billCell(row, businessColumn)
			if strings.Contains(business, "退款") || strings.Contains(business, "撤销") || strings.Contains(business, "关闭") {
				continue
			}
			merchantOrderNo := billCell(row, columns["商户订单号"])
			providerTradeNo := billCell(row, columns["支付宝交易号"])
			if merchantOrderNo == "" || providerTradeNo == "" {
				continue
			}
			amountFen, err := parseYuanToFen(billCell(row, amountColumn))
			if err != nil || amountFen <= 0 {
				continue
			}
			recordsByOrder[merchantOrderNo] = BillRecord{
				MerchantOrderNo: merchantOrderNo, ProviderTradeNo: providerTradeNo,
				ProviderStatus: "SUCCESS", AmountFen: amountFen, Currency: "CNY",
				PaidAt: parseBillTime(billCell(row, paidAtColumn)),
			}
		}
	}
	if !foundHeader {
		return nil, errors.New("支付宝交易账单缺少业务明细表头")
	}
	records := make([]BillRecord, 0, len(recordsByOrder))
	for _, record := range recordsByOrder {
		records = append(records, record)
	}
	return records, nil
}

func alipayBillFiles(raw []byte) ([][]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		// A few sandbox environments return an uncompressed CSV. Supporting it
		// also makes the parser tolerant without weakening archive limits.
		return [][]byte{raw}, nil
	}
	files := make([][]byte, 0, len(reader.File))
	var total int64
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(file.Name), ".csv") {
			continue
		}
		if file.UncompressedSize64 > maxTradeBillBytes || total+int64(file.UncompressedSize64) > maxTradeBillBytes {
			return nil, errors.New("支付宝账单压缩包超过安全限制")
		}
		stream, err := file.Open()
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(stream, maxTradeBillBytes+1))
		closeErr := stream.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(data) > maxTradeBillBytes {
			return nil, errors.New("支付宝账单文件超过安全限制")
		}
		total += int64(len(data))
		files = append(files, data)
	}
	if len(files) == 0 {
		return nil, errors.New("支付宝账单压缩包不包含 CSV")
	}
	return files, nil
}

func decodeAlipayBill(raw []byte) []byte {
	if utf8.Valid(raw) {
		return raw
	}
	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
	if err != nil {
		return raw
	}
	return decoded
}

func readBillCSV(raw []byte) ([][]string, error) {
	reader := csv.NewReader(bytes.NewReader(raw))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	return reader.ReadAll()
}

func findBillHeader(rows [][]string, required []string) (int, map[string]int) {
	for rowIndex, row := range rows {
		columns := make(map[string]int, len(row))
		for columnIndex, value := range row {
			columns[normalizeBillCell(value)] = columnIndex
		}
		valid := true
		for _, field := range required {
			if _, ok := columns[field]; !ok {
				valid = false
				break
			}
		}
		if valid {
			return rowIndex, columns
		}
	}
	return -1, nil
}

func firstBillColumn(columns map[string]int, names ...string) int {
	for _, name := range names {
		if column, ok := columns[name]; ok {
			return column
		}
	}
	return -1
}

func billCell(row []string, column int) string {
	if column < 0 || column >= len(row) {
		return ""
	}
	return normalizeBillCell(row[column])
}

func normalizeBillCell(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "\ufeff"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "`"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "'"))
	return value
}

func parseBillTime(value string) time.Time {
	location := time.FixedZone("CST", 8*60*60)
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
		if parsed, err := time.ParseInLocation(layout, strings.TrimSpace(value), location); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func trustedDownloadURL(raw, baseURL string, allowedSuffixes ...string) (*url.URL, error) {
	return trustedDownloadURLWithPolicy(raw, baseURL, nil, allowedSuffixes...)
}

func trustedDownloadURLWithPolicy(raw, baseURL string, allowedHTTPHosts []string, allowedSuffixes ...string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Host == "" || target.User != nil || target.Fragment != "" {
		return nil, errors.New("支付渠道返回了无效账单下载地址")
	}
	host := strings.ToLower(target.Hostname())
	base, _ := url.Parse(baseURL)
	baseMatch := base != nil && strings.EqualFold(target.Host, base.Host)
	suffixMatch := false
	for _, suffix := range allowedSuffixes {
		suffix = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(suffix), "."))
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			suffixMatch = true
			break
		}
	}
	if !baseMatch && !suffixMatch {
		return nil, errors.New("支付渠道账单下载地址不在可信域名内")
	}
	if target.Scheme == "http" {
		if baseMatch && base != nil && base.Scheme == "http" {
			return target, nil
		}
		allowed := false
		for _, allowedHost := range allowedHTTPHosts {
			if strings.EqualFold(host, strings.TrimSpace(allowedHost)) {
				allowed = true
				break
			}
		}
		if !allowed || (target.Port() != "" && target.Port() != "80") {
			return nil, errors.New("支付渠道账单下载地址必须使用 HTTPS")
		}
		return target, nil
	}
	if target.Scheme != "https" {
		return nil, errors.New("支付渠道账单下载地址必须使用 HTTPS")
	}
	if target.Port() != "" && target.Port() != "443" {
		return nil, errors.New("支付渠道账单下载地址使用了非标准端口")
	}
	return target, nil
}

// clientWithTrustedRedirects validates every redirect before it is followed.
// Validating only response.Request would be too late because an HTTP client may
// already have contacted an attacker-controlled or internal redirect target.
func clientWithTrustedRedirects(client *http.Client, baseURL string, allowedSuffixes ...string) *http.Client {
	return clientWithTrustedRedirectPolicy(client, baseURL, nil, allowedSuffixes...)
}

func clientWithTrustedRedirectPolicy(client *http.Client, baseURL string, allowedHTTPHosts []string, allowedSuffixes ...string) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	copyClient := *client
	previous := client.CheckRedirect
	copyClient.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("支付渠道账单下载重定向过多")
		}
		if _, err := trustedDownloadURLWithPolicy(request.URL.String(), baseURL, allowedHTTPHosts, allowedSuffixes...); err != nil {
			return err
		}
		if previous != nil {
			return previous(request, via)
		}
		return nil
	}
	return &copyClient
}
