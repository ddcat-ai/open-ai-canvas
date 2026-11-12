package hostupdate

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type Server struct {
	manager *Manager
	token   string
}

func NewServer(manager *Manager, token string) (*Server, error) {
	if manager == nil {
		return nil, errors.New("更新管理器不能为空")
	}
	if len(strings.TrimSpace(token)) < 32 {
		return nil, errors.New("CANVAS_UPDATER_TOKEN 至少需要 32 个字符")
	}
	return &Server{manager: manager, token: strings.TrimSpace(token)}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.manager.Snapshot()) })
	mux.HandleFunc("PUT /v1/sources", func(w http.ResponseWriter, r *http.Request) {
		var sources Sources
		if err := decodeJSON(r, &sources); err != nil {
			writeError(w, http.StatusBadRequest, err, nil)
			return
		}
		if err := sources.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err, nil)
			return
		}
		status, err := s.manager.SaveSources(sources)
		if err != nil {
			code := http.StatusInternalServerError
			if errors.Is(err, ErrBusy) {
				code = http.StatusConflict
			}
			writeError(w, code, err, status)
			return
		}
		writeJSON(w, http.StatusOK, status)
	})
	mux.HandleFunc("POST /v1/sources/test", func(w http.ResponseWriter, _ *http.Request) {
		status, err := s.manager.TestSources()
		if err != nil {
			code := http.StatusInternalServerError
			if errors.Is(err, ErrBusy) {
				code = http.StatusConflict
			}
			writeError(w, code, err, status)
			return
		}
		writeJSON(w, http.StatusAccepted, status)
	})
	mux.HandleFunc("POST /v1/check", func(w http.ResponseWriter, r *http.Request) {
		status, err := s.manager.Check(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err, status)
			return
		}
		writeJSON(w, http.StatusOK, status)
	})
	mux.HandleFunc("POST /v1/update", func(w http.ResponseWriter, r *http.Request) {
		var request StartRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, http.StatusBadRequest, err, nil)
			return
		}
		status, err := s.manager.StartUpdate(request.TargetVersion)
		if err != nil {
			writeError(w, http.StatusConflict, err, status)
			return
		}
		writeJSON(w, http.StatusAccepted, status)
	})
	mux.HandleFunc("POST /v1/rollback", func(w http.ResponseWriter, r *http.Request) {
		var request RollbackRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, http.StatusBadRequest, err, nil)
			return
		}
		status, err := s.manager.StartRollback(request.Reason)
		if err != nil {
			writeError(w, http.StatusConflict, err, status)
			return
		}
		writeJSON(w, http.StatusAccepted, status)
	})
	return s.authorize(mux)
}

func (s *Server) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if len(provided) != len(s.token) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
			writeError(w, http.StatusUnauthorized, errors.New("更新器认证失败"), nil)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, err error, data any) {
	writeJSONStatus(w, status, map[string]any{"error": err.Error(), "data": data})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	writeJSONStatus(w, status, value)
}

func writeJSONStatus(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
