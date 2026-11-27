package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"

	"golang.org/x/crypto/scrypt"
)

const magic = "YCBK0001"
const chunkSize = 64 * 1024

func archiveCipher(password string, salt []byte) (cipher.AEAD, error) {
	if len(password) < 16 {
		return nil, errors.New("恢复口令至少需要 16 个字节")
	}
	key, err := scrypt.Key([]byte(password), salt, 32768, 8, 1, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Each archive has a fresh salt/key, monotonically increasing chunk nonces and
// an authenticated empty final chunk. Reordering and truncation are rejected.
func Encrypt(dst io.Writer, src io.Reader, password string) error {
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	aead, err := archiveCipher(password, salt)
	if err != nil {
		return err
	}
	if _, err = io.WriteString(dst, magic); err != nil {
		return err
	}
	if _, err = dst.Write(salt); err != nil {
		return err
	}
	buffer := make([]byte, chunkSize)
	nonce := make([]byte, aead.NonceSize())
	for counter := uint64(0); ; counter++ {
		n, readErr := io.ReadFull(src, buffer)
		if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
			return readErr
		}
		binary.BigEndian.PutUint64(nonce[len(nonce)-8:], counter)
		sealed := aead.Seal(nil, nonce, buffer[:n], []byte(magic))
		if err = binary.Write(dst, binary.BigEndian, uint32(len(sealed))); err != nil {
			return err
		}
		if _, err = dst.Write(sealed); err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
	}
}

func Decrypt(dst io.Writer, src io.Reader, password string) error {
	header := make([]byte, len(magic)+32)
	if _, err := io.ReadFull(src, header); err != nil {
		return err
	}
	if string(header[:len(magic)]) != magic {
		return errors.New("不支持的备份格式")
	}
	aead, err := archiveCipher(password, header[len(magic):])
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	for counter := uint64(0); ; counter++ {
		var size uint32
		if err = binary.Read(src, binary.BigEndian, &size); err != nil {
			return errors.New("备份不完整：缺少结束校验")
		}
		if size < uint32(aead.Overhead()) || size > chunkSize+uint32(aead.Overhead()) {
			return errors.New("备份分块长度无效")
		}
		chunk := make([]byte, size)
		if _, err = io.ReadFull(src, chunk); err != nil {
			return err
		}
		binary.BigEndian.PutUint64(nonce[len(nonce)-8:], counter)
		plain, err := aead.Open(nil, nonce, chunk, []byte(magic))
		if err != nil {
			return errors.New("恢复口令错误或备份已损坏")
		}
		if len(plain) == 0 {
			var trailing [1]byte
			if n, err := src.Read(trailing[:]); n != 0 || err != io.EOF {
				return errors.New("备份结束后存在额外数据")
			}
			return nil
		}
		if _, err = dst.Write(plain); err != nil {
			return err
		}
	}
}
