# -*- coding: utf-8 -*-
"""GLM 本地转发代理：影策(open-ai-canvas) -> 智谱开放平台
影策的 OpenAI 协议适配器固定拼接 /v1/chat/completions，而智谱只有 /api/paas/v4。
本代理监听 127.0.0.1:8787，把 /v1/xxx 转写为智谱的 /xxx（即 /api/paas/v4/chat/completions）。
零第三方依赖，纯 Python 标准库。与 启动影策.bat 配合使用。
"""
import http.server
import urllib.request
import urllib.error

UPSTREAM = "https://open.bigmodel.cn/api/paas/v4"
LISTEN = ("127.0.0.1", 8787)


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _forward(self, has_body):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if (has_body and length) else None
        # 转写：去掉影策硬加的 /v1 前缀
        path = self.path
        if path.startswith("/v1/"):
            path = path[3:]
        url = UPSTREAM + path
        req = urllib.request.Request(url, data=body, method=self.command)
        for h in ("Authorization", "Content-Type", "Accept", "User-Agent"):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            resp = e
        except Exception as e:
            payload = ('{"error":{"message":"glm-proxy upstream error: %s"}}' % e).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        status = getattr(resp, "status", None) or resp.getcode()
        self.send_response(status)
        for k, v in resp.headers.items():
            lk = k.lower()
            if lk in ("content-type", "x-request-id") and lk != "content-length":
                self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
        except Exception:
            pass
        try:
            self.wfile.write(b"0\r\n\r\n")
        except Exception:
            pass

    def do_POST(self):
        self._forward(True)

    def do_GET(self):
        self._forward(False)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print("GLM proxy listening on http://%s:%s -> %s" % (LISTEN[0], LISTEN[1], UPSTREAM))
    http.server.ThreadingHTTPServer(LISTEN, Proxy).serve_forever()
