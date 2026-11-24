#!/usr/bin/env python3
"""Canvas administrator client; Python standard library only."""
import argparse
import base64
import csv
import getpass
import hashlib
import hmac
import http.server
import io
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile

API = "/api/admin-assistant"
MAX_FILE = 32 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Unexpected redirect; verify the deployment URL")


def site_url(value):
    value = value.rstrip("/")
    p = urllib.parse.urlsplit(value)
    if p.username or p.password or p.query or p.fragment or p.path or not p.netloc:
        raise ValueError("--site must be a site origin")
    if p.scheme != "https" and not (
        p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1", "::1")
    ):
        raise ValueError("HTTPS is required except for loopback development")
    return value


def restrict(path, directory=False):
    if os.name != "nt":
        path.chmod(0o700 if directory else 0o600)
        return
    result = subprocess.run(
        ["whoami", "/user", "/fo", "csv", "/nh"],
        check=True, capture_output=True, text=True,
    )
    sid = next(csv.reader([result.stdout.strip()]))[-1]
    if not sid.startswith("S-1-"):
        raise RuntimeError("Cannot determine Windows account SID")
    rights = "(OI)(CI)F" if directory else "F"
    subprocess.run(
        ["icacls", str(path), "/inheritance:r", "/grant:r", "*" + sid + ":" + rights],
        check=True, capture_output=True,
    )


class Client:
    def __init__(self, site):
        self.site = site_url(site)
        root = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
        self.config_dir = root / "canvas-admin"
        self.config = self.config_dir / (hashlib.sha256(self.site.encode()).hexdigest() + ".json")
        self.opener = urllib.request.build_opener(NoRedirect())

    def load(self):
        if not self.config.exists():
            return {}
        if self.config.is_symlink():
            raise RuntimeError("Credential file must not be a symlink")
        return json.loads(self.config.read_text(encoding="utf-8"))

    def save(self, value):
        if self.config_dir.is_symlink():
            raise RuntimeError("Credential directory must not be a symlink")
        self.config_dir.mkdir(parents=True, exist_ok=True)
        restrict(self.config_dir, True)
        fd, tmp = tempfile.mkstemp(dir=self.config_dir, prefix=".credential-")
        path = Path(tmp)
        try:
            os.close(fd)
            restrict(path)
            path.write_text(json.dumps(value), encoding="utf-8")
            os.replace(path, self.config)
        finally:
            path.unlink(missing_ok=True)

    def request(self, path, method="GET", data=None, authenticated=True, headers=None, binary=False, form=False):
        target = urllib.parse.urljoin(self.site, path)
        if urllib.parse.urlsplit(target)[:2] != urllib.parse.urlsplit(self.site)[:2]:
            raise RuntimeError("Cross-origin request refused")
        hdr = {"Accept": "application/json", **(headers or {})}
        if authenticated:
            hdr["Authorization"] = "Bearer " + self.access_token()
        if form:
            data = urllib.parse.urlencode(data).encode()
            hdr["Content-Type"] = "application/x-www-form-urlencoded"
        elif data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
            hdr["Content-Type"] = "application/json"
        req = urllib.request.Request(target, data=data, method=method, headers=hdr)
        try:
            with self.opener.open(req, timeout=90) as response:
                content = response.read(MAX_FILE + 1)
        except urllib.error.HTTPError as exc:
            # Never print response bodies or request headers: upstream errors may contain credentials.
            raise RuntimeError("Request failed (HTTP %d); inspect the invocation in Agent access" % exc.code) from None
        if len(content) > MAX_FILE:
            raise RuntimeError("Response exceeds 32 MiB")
        if binary:
            return content
        value = json.loads(content)
        if "code" in value:
            if value["code"] != 0:
                raise RuntimeError("Canvas API error (code %s)" % value["code"])
            return value["data"]
        return value

    def access_token(self):
        token = os.environ.get("CANVAS_ADMIN_TOKEN")
        if token:
            return token
        credentials = self.load()
        if not credentials:
            raise RuntimeError("Run login or token first")
        if credentials.get("refresh_token") and credentials.get("expires_at", 0) < time.time() + 60:
            fresh = self.request(API + "/oauth/token", "POST", {
                "grant_type": "refresh_token", "client_id": credentials["client_id"],
                "refresh_token": credentials["refresh_token"], "resource": self.site + API + "/mcp",
            }, authenticated=False, form=True)
            fresh["client_id"] = credentials["client_id"]
            fresh["expires_at"] = time.time() + fresh["expires_in"]
            self.save(fresh)
            credentials = fresh
        return credentials["access_token"]

    def login(self, scopes):
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(32)
        received = {}

        class Callback(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                p = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(p.query)
                if p.path != "/callback" or not hmac.compare_digest(query.get("state", [""])[0], state):
                    self.send_error(400)
                    return
                received.update({k: v[0] for k, v in query.items()})
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(b"Canvas authorization received. You can close this tab.")

            def log_message(self, *args):
                pass

        with http.server.HTTPServer(("127.0.0.1", 0), Callback) as server:
            server.timeout = 1
            redirect = "http://127.0.0.1:%d/callback" % server.server_port
            client = self.request(API + "/oauth/register", "POST", {
                "client_name": "Canvas Admin Skill", "redirect_uris": [redirect],
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            }, authenticated=False)
            query = urllib.parse.urlencode({
                "client_id": client["client_id"], "redirect_uri": redirect,
                "response_type": "code", "resource": self.site + API + "/mcp",
                "scope": " ".join(scopes), "state": state,
                "code_challenge": challenge, "code_challenge_method": "S256",
            })
            target = self.site + API + "/oauth/authorize?" + query
            print("Open this URL to authorize:\n" + target)
            webbrowser.open(target)
            deadline = time.monotonic() + 300
            while not received and time.monotonic() < deadline:
                server.handle_request()
        if "code" not in received:
            raise RuntimeError("Authorization denied or timed out")
        credentials = self.request(API + "/oauth/token", "POST", {
            "grant_type": "authorization_code", "client_id": client["client_id"],
            "code": received["code"], "redirect_uri": redirect, "code_verifier": verifier,
            "resource": self.site + API + "/mcp",
        }, authenticated=False, form=True)
        credentials["client_id"] = client["client_id"]
        credentials["expires_at"] = time.time() + credentials["expires_in"]
        self.save(credentials)
        print("Authorized; credentials stored outside the Skill directory.")


def install_archive(data, manifest, destination):
    if manifest.get("apiVersion") != 1 or manifest.get("size") != len(data):
        raise RuntimeError("Incompatible or incomplete Skill package")
    if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), manifest.get("sha256", "")):
        raise RuntimeError("Skill checksum mismatch")
    if Path(destination).is_symlink():
        raise RuntimeError("Skill installation directory must not be a symlink")
    destination = Path(destination).resolve()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 100 or sum(m.file_size for m in members) > MAX_FILE:
            raise RuntimeError("Oversized Skill archive")
        paths = []
        seen = set()
        for member in members:
            p = PurePosixPath(member.filename)
            if ("\\" in member.filename or p.is_absolute() or ".." in p.parts
                or len(p.parts) < 2 or p.parts[0] != "canvas-admin"
                or any(":" in part for part in p.parts)
                or stat.S_ISLNK(member.external_attr >> 16)):
                raise RuntimeError("Unsafe Skill archive path")
            relative = Path(*p.parts[1:])
            key = relative.as_posix().casefold()
            if key in seen:
                raise RuntimeError("Duplicate Skill archive path")
            seen.add(key)
            target = destination / relative
            if not target.resolve().is_relative_to(destination):
                raise RuntimeError("Skill path escapes installation directory")
            current = target
            while current != destination:
                if current.is_symlink():
                    raise RuntimeError("Skill update refuses symlinks")
                current = current.parent
            paths.append((member, relative))
        if "skill.md" not in seen or "scripts/canvas_admin.py" not in seen:
            raise RuntimeError("Skill entrypoint or client missing")
        # Verify every member before changing the installed package.
        with tempfile.TemporaryDirectory(prefix="canvas-skill-") as temporary:
            stage = Path(temporary)
            for member, relative in paths:
                if member.is_dir():
                    continue
                path = stage / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(member))
            destination.mkdir(parents=True, exist_ok=True)
            for member, relative in paths:
                if member.is_dir():
                    continue
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".skill-")
                os.close(fd)
                try:
                    shutil.copyfile(stage / relative, tmp)
                    os.replace(tmp, target)
                finally:
                    Path(tmp).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=os.environ.get("CANVAS_ADMIN_URL"), required=not os.environ.get("CANVAS_ADMIN_URL"))
    sub = parser.add_subparsers(dest="command", required=True)
    login = sub.add_parser("login")
    login.add_argument("--scope", action="append", default=[])
    install = sub.add_parser("install")
    install.add_argument("--destination", type=Path, required=True, help="Full canvas-admin Skill directory")
    for name in ("token", "status", "logout", "version", "update"):
        sub.add_parser(name)
    listing = sub.add_parser("list")
    listing.add_argument("--module", default="")
    listing.add_argument("--keyword", default="")
    listing.add_argument("--page", type=int, default=1)
    describe = sub.add_parser("describe")
    describe.add_argument("operation")
    execute = sub.add_parser("execute")
    execute.add_argument("operation")
    execute.add_argument("--args-file", type=Path)
    execute.add_argument("--key", default="")
    upload = sub.add_parser("upload")
    upload.add_argument("file", type=Path)
    download = sub.add_parser("download")
    download.add_argument("id")
    download.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    client = Client(args.site)
    cmd = args.command
    if cmd == "login":
        client.login(args.scope)
        return 0
    if cmd == "token":
        value = getpass.getpass("Canvas management Token: ").strip()
        prior = os.environ.get("CANVAS_ADMIN_TOKEN")
        try:
            os.environ["CANVAS_ADMIN_TOKEN"] = value
            client.request(API + "/operations")
        finally:
            if prior is None:
                os.environ.pop("CANVAS_ADMIN_TOKEN", None)
            else:
                os.environ["CANVAS_ADMIN_TOKEN"] = prior
        client.save({"access_token": value})
        print("Token verified and stored.")
        return 0
    if cmd == "logout":
        client.config.unlink(missing_ok=True)
        print("Local credentials removed. Revoke server access in Agent access if needed.")
        return 0
    if cmd in ("version", "update", "install"):
        result = client.request(API + "/skill/latest", authenticated=False)
        if cmd in ("update", "install"):
            data = client.request(result["downloadUrl"], authenticated=False, binary=True)
            destination = args.destination if cmd == "install" else Path(__file__).resolve().parent.parent
            if destination.resolve() == client.config_dir.resolve() or client.config_dir.resolve().is_relative_to(destination.resolve()):
                raise RuntimeError("Skill destination must not contain the credential directory")
            install_archive(data, result, destination)
            print("Skill installed at " + str(destination.resolve()) + " (version " + result["version"] + ")")
            return 0
    elif cmd == "status":
        result = client.request(API + "/operations")
        result = {"authenticated": True, "site": client.site, "availableOperations": result["total"]}
    elif cmd == "list":
        result = client.request(API + "/operations?" + urllib.parse.urlencode({"module": args.module, "keyword": args.keyword, "page": args.page}))
    elif cmd == "describe":
        result = client.request(API + "/operations/" + urllib.parse.quote(args.operation, safe=""))
    elif cmd == "execute":
        body = json.loads(args.args_file.read_text(encoding="utf-8")) if args.args_file else {}
        result = client.request(API + "/operations/" + urllib.parse.quote(args.operation, safe="") + "/execute", "POST", {"arguments": body, "idempotencyKey": args.key})
    elif cmd == "upload":
        if args.file.stat().st_size > MAX_FILE:
            raise RuntimeError("File exceeds 32 MiB")
        result = client.request(API + "/attachments", "POST", args.file.read_bytes(), headers={"Content-Type": "application/octet-stream", "X-Filename": urllib.parse.quote(args.file.name)})
    elif cmd == "download":
        if args.output.exists():
            raise RuntimeError("Output file exists; choose a new path")
        data = client.request(API + "/attachments/" + urllib.parse.quote(args.id, safe=""), binary=True)
        with args.output.open("xb") as output:
            output.write(data)
        print("Downloaded to " + str(args.output))
        return 0
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if isinstance(result, dict) and result.get("status") in ("failed", "rejected", "expired", "unknown"):
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, KeyError) as exc:
        print("Canvas admin: " + str(exc), file=sys.stderr)
        sys.exit(1)
