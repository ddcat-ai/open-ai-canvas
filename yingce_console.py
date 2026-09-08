# -*- coding: utf-8 -*-
"""
影策控制台 · YingCe Console
=========================================
一个给非程序员用的影策启动面板。

用法：双击 启动影策.bat 即可（本脚本由它拉起，你不需要手动运行）。

它做了什么：
  1. 在后台开一个本地小服务（127.0.0.1:17580）
  2. 自动打开浏览器，显示一个控制面板
  3. 面板上可以一键启停 5 个服务，实时看状态，看日志
  4. 关掉浏览器不会杀掉服务；想停在面板上点「停止」即可

为什么要有它：
  旧脚本用 start /min 弹一堆黑窗口，看不出起来没起来，
  关错一个窗口服务就死了。而且它漏了 GLM 代理和 Canvas Agent。
"""

import os
import sys
import json
import time
import socket
import threading
import subprocess
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- 路径

ROOT = os.path.dirname(os.path.abspath(__file__))
PANEL_PORT = 17580

PYTHON = r"C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\python.exe"
NODE = r"C:\Users\khy\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"

# Windows 进程标志：脱离父进程独立存活
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

# 本地服务必须绕开系统/沙箱代理，否则 127.0.0.1 的请求会被劫持挂死
CLEAN_PROXY_ENV = {
    "HTTP_PROXY": "", "HTTPS_PROXY": "",
    "http_proxy": "", "https_proxy": "",
    "ALL_PROXY": "", "all_proxy": "",
    "NO_PROXY": "*", "no_proxy": "*",
}

# ---------------------------------------------------------------- 服务清单

SERVICES = [
    {
        "key": "backend",
        "name": "后端服务",
        "desc": "影策的心脏。画布数据、账号、生成任务全靠它。它挂了网页就白屏。",
        "port": 8080,
        "required": True,
        "cwd": os.path.join(ROOT, ".local"),
        "cmd": [os.path.join(ROOT, ".local", "canvas-backend.exe")],
        "env": {
            "CANVAS_REGISTRATION_ENABLED": "true",
            "CANVAS_ALLOW_PRIVATE_UPSTREAMS": "true",
            # 用户自建渠道（custom relay）的 SSRF 防护不认上面的总开关，
            # 只认这份主机白名单 —— 本机 GLM 代理(127.0.0.1:8787)必须在这里
            "CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS": "127.0.0.1,localhost",
            # 安全：必须锁 127.0.0.1，否则局域网可直接访问后端
            "CANVAS_BACKEND_ADDR": "127.0.0.1:8080",
            # 桌面本机渠道能力开关：不设它，勾了「允许本机渠道」的渠道
            # （GLM 代理 http://127.0.0.1:8787）一律报
            # 「不允许访问本机、内网或链路本地地址」。
            # 两项条件必须同时满足：本开关=true 且 addr 显式绑 127.0.0.1。
            "CANVAS_DESKTOP_LOCAL_CHANNELS_ENABLED": "true",
            "CANVAS_CORS_ORIGINS": "http://localhost:3000",
            "CANVAS_DATA_PATH": "./data",
        },
        "log": "backend.log",
        "wait": 20,
    },
    {
        "key": "glm",
        "name": "GLM 代理",
        "desc": "把智谱的接口格式转写成 OpenAI 格式。想用 GLM 模型就得开它。",
        "port": 8787,
        "required": False,
        "cwd": ROOT,
        "cmd": [PYTHON, os.path.join(ROOT, "glm_proxy.py")],
        "env": {},
        "log": "glm_proxy.log",
        "wait": 15,
    },
    {
        "key": "frontend",
        "name": "前端界面",
        "desc": "你眼睛看到的网页。启动要 10~30 秒，第一次更慢，耐心等。",
        "port": 3000,
        "required": True,
        "cwd": os.path.join(ROOT, "web"),
        "cmd": [NODE, "node_modules/vite/bin/vite.js",
                "--host", "127.0.0.1", "--port", "3000", "--strictPort"],
        "env": {},
        "log": os.path.join("web", "vite_dev.log"),
        "wait": 60,
    },
    {
        "key": "agent",
        "name": "Canvas Agent",
        "desc": "侧边栏 @ 技能、WorkBuddy 连画布都靠它。旧脚本从来没启动过它。",
        "port": 17371,
        "required": False,
        "cwd": os.path.join(ROOT, "canvas-agent"),
        "cmd": [NODE, os.path.join(ROOT, "canvas-agent", "dist", "index.js")],
        "env": {},
        "log": "canvas_agent.log",
        "wait": 20,
    },
    {
        "key": "nxf",
        "name": "酿笑坊能力服务",
        "desc": "项目里「酿造工坊」页的引擎：分镜编译、方法论路由、提示词翻译、质量 Gate 全靠它。",
        "port": 8823,
        "required": False,
        "cwd": r"D:\AlcheMvision\nxf\_engine\yingce_bridge",
        "cmd": [r"D:\AlcheMvision\nxf\runtimes\venv\Scripts\python.exe",
                "-m", "uvicorn", "service:app",
                "--host", "127.0.0.1", "--port", "8823"],
        "env": {},
        "log": "nxf_bridge.log",
        "wait": 25,
    },
]

SVC_BY_KEY = {s["key"]: s for s in SERVICES}

# ---------------------------------------------------------------- 操作日志

_event_log = []
_log_lock = threading.Lock()


def log_event(msg, level="info"):
    with _log_lock:
        _event_log.append({
            "t": time.strftime("%H:%M:%S"),
            "level": level,
            "msg": msg,
        })
        if len(_event_log) > 200:
            del _event_log[0]


# ---------------------------------------------------------------- 端口与进程

def port_alive(port, timeout=0.7):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect(("127.0.0.1", int(port)))
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


def pids_on_port(port):
    """用 netstat 找出占用该端口的 PID。"""
    try:
        out = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, timeout=8
        ).stdout.decode("gbk", errors="ignore")
    except Exception:
        return set()
    pids = set()
    needle = ":%s" % port
    for line in out.splitlines():
        if needle not in line:
            continue
        if "LISTENING" not in line.upper():
            continue
        parts = line.split()
        if len(parts) >= 5 and parts[-1].isdigit():
            pids.add(parts[-1])
    return pids


def start_service(svc):
    if port_alive(svc["port"]):
        log_event("%s 已经在运行了（端口 %s）" % (svc["name"], svc["port"]))
        return "already"

    if not os.path.exists(svc["cmd"][0]):
        log_event("%s 启动失败：找不到 %s" % (svc["name"], svc["cmd"][0]), "error")
        return "missing"

    env = os.environ.copy()
    env.update(CLEAN_PROXY_ENV)
    env.update(svc.get("env") or {})

    log_path = os.path.join(ROOT, svc.get("log") or "console.log")
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        logf = open(log_path, "ab")
    except Exception as e:
        log_event("%s 无法写日志：%s" % (svc["name"], e), "error")
        logf = subprocess.DEVNULL

    try:
        subprocess.Popen(
            svc["cmd"],
            cwd=svc["cwd"],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=subprocess.STDOUT,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    except Exception as e:
        log_event("%s 启动失败：%s" % (svc["name"], e), "error")
        return "error"

    log_event("正在启动 %s ..." % svc["name"])

    # 轮询等端口起来
    deadline = time.time() + int(svc.get("wait") or 20)
    while time.time() < deadline:
        time.sleep(1)
        if port_alive(svc["port"]):
            log_event("%s 已就绪（端口 %s）" % (svc["name"], svc["port"]), "ok")
            return "ok"

    log_event("%s 启动超时，端口 %s 未响应。点「看日志」排查。"
              % (svc["name"], svc["port"]), "warn")
    return "timeout"


def stop_service(svc):
    pids = pids_on_port(svc["port"])
    if not pids:
        log_event("%s 本来就没在运行" % svc["name"])
        return "notrunning"
    for pid in pids:
        subprocess.run(["taskkill", "/F", "/PID", pid],
                       capture_output=True, timeout=8)
    time.sleep(1)
    if port_alive(svc["port"]):
        log_event("%s 停止失败，端口 %s 仍被占用" % (svc["name"], svc["port"]), "error")
        return "stuck"
    log_event("%s 已停止" % svc["name"])
    return "ok"


def tail_log(svc, lines=60):
    path = os.path.join(ROOT, svc.get("log") or "console.log")
    if not os.path.exists(path):
        return "(还没有日志文件)"
    try:
        with open(path, "rb") as f:
            data = f.read()
        text = data.decode("utf-8", errors="ignore")
    except Exception as e:
        return "(读日志失败：%s)" % e
    tail = text.splitlines()[-lines:]
    return "\n".join(tail)


# ---------------------------------------------------------------- HTTP 面板

PANEL_HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>影策控制台</title>
<style>
:root{
  --navy:#0a2540;--gold:#c9a961;--teal:#0d9488;
  --bg:#faf9f7;--card:#fff;--line:#e5e2dc;
  --ink:#1f2933;--ink2:#5b6470;--ink3:#8b93a0;
  --ok:#0d9488;--warn:#c9820f;--err:#c0392b;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);
 font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
 line-height:1.7;padding:32px 20px}
.wrap{max-width:1080px;margin:0 auto}
header{border-bottom:3px solid var(--navy);padding-bottom:20px;margin-bottom:26px;
 display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px}
h1{font-size:26px;color:var(--navy);font-weight:500}
.sub{font-size:13px;color:var(--ink2);margin-top:6px}
.hint{font-size:12px;color:var(--ink3);text-align:right;line-height:1.8}
.hint b{color:var(--teal)}

.bar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:26px}
button{font-family:inherit;font-size:14px;padding:11px 22px;border-radius:8px;
 border:1px solid var(--line);background:var(--card);color:var(--ink);
 cursor:pointer;transition:.15s;font-weight:500}
button:hover{border-color:var(--ink3);transform:translateY(-1px)}
button:disabled{opacity:.45;cursor:not-allowed;transform:none}
button.primary{background:var(--navy);color:#fff;border-color:var(--navy)}
button.primary:hover{background:#123a5e}
button.gold{background:var(--gold);color:var(--navy);border-color:var(--gold)}
button.danger{background:#fff;color:var(--err);border-color:#e8c4bf}
button.danger:hover{background:#fdf3f2}
button.sm{padding:6px 14px;font-size:12px}

.card{background:var(--card);border:1px solid var(--line);border-radius:12px;
 padding:20px 24px;margin-bottom:14px;display:flex;align-items:center;gap:18px}
.card.on{border-left:4px solid var(--teal)}
.card.off{border-left:4px solid #cfcabf}
.dot{width:12px;height:12px;border-radius:50%;flex:0 0 12px}
.card.on .dot{background:var(--ok);box-shadow:0 0 0 4px rgba(13,148,136,.14)}
.card.off .dot{background:#cfcabf}
.card.busy .dot{background:var(--warn);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.info{flex:1;min-width:0}
.nm{font-size:16px;font-weight:500;color:var(--navy)}
.nm .pt{font-size:12px;color:var(--ink3);font-weight:400;margin-left:8px;
 font-family:monospace}
.ds{font-size:12.5px;color:var(--ink2);margin-top:3px}
.st{font-size:13px;font-weight:500;margin-top:7px}
.card.on .st{color:var(--ok)}
.card.off .st{color:var(--ink3)}
.card.busy .st{color:var(--warn)}
.card.off.dead .st{color:var(--err)}
.acts{display:flex;gap:8px;flex:0 0 auto}

.logbox{background:var(--navy);border-radius:12px;padding:20px 24px;margin-top:26px}
.logbox h3{font-size:14px;color:var(--gold);font-weight:500;margin-bottom:12px;
 letter-spacing:.05em}
.logbody{font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.85;
 color:#c8d6e5;max-height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.logbody .e{color:#ff9b94}
.logbody .w{color:#f5c86b}
.logbody .k{color:#7fd8c8}
.logbody .t{color:#6b7c90}

.modal{position:absolute;top:0;left:0;right:0;background:rgba(10,37,64,.96);
 border-radius:12px;padding:22px 24px;margin-top:14px;display:none}
.modal.show{display:block}
.modal h4{color:var(--gold);font-size:13px;margin-bottom:12px;font-weight:500}
.modal pre{font-family:Consolas,monospace;font-size:11.5px;color:#c8d6e5;
 max-height:320px;overflow:auto;white-space:pre-wrap;line-height:1.75}
.modal .cls{margin-top:14px}

footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);
 font-size:12px;color:var(--ink3);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div>
    <h1>影策控制台</h1>
    <div class="sub">服务没起来？在这里看。关掉这个页面不会关掉服务。</div>
  </div>
  <div class="hint">
    影策网址 <b>http://127.0.0.1:3000</b><br>
    账号 <b>zhuren</b> ／ 密码 <b>zhuren2026</b>
  </div>
</header>

<div class="bar">
  <button class="primary" id="btnStartAll">一键启动全部</button>
  <button class="danger" id="btnStopAll">全部停止</button>
  <button class="gold" id="btnOpenCanvas">打开画布（连 MCP）</button>
  <button class="gold" id="btnOpen">打开影策首页</button>
  <button id="btnRefresh">刷新状态</button>
  <button class="gold" id="btnSelfCheck">接入自检</button>
  <span id="busyTip" style="align-self:center;font-size:13px;color:var(--warn);display:none">
    正在操作，请稍候…
  </span>
</div>

<div id="cards"></div>

<div class="logbox">
  <h3>操作日志</h3>
  <div class="logbody" id="logBody"></div>
</div>

<div class="modal" id="modal">
  <h4 id="modalTitle">日志</h4>
  <pre id="modalBody"></pre>
  <button class="cls sm" onclick="document.getElementById('modal').classList.remove('show')">关闭</button>
</div>

<footer>
  <div>影策控制台 · 状态每 3 秒自动刷新</div>
  <div>想彻底关掉服务，点上面的「全部停止」</div>
</footer>

</div>

<script>
var busy = false;

function esc(s){return String(s).replace(/[&<>]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}

function render(data){
  var html = '';
  data.services.forEach(function(s){
    var cls = s.state==='running' ? 'on' : 'off';
    if(s.busy) cls = 'busy';
    if(s.state==='dead') cls += ' dead';
    var stText = {
      running:'运行中 · 端口 '+s.port,
      stopped:'未启动',
      starting:'正在启动…',
      stopping:'正在停止…',
      dead:'异常 · 端口被别的程序占用'
    }[s.state] || s.state;

    html += '<div class="card '+cls+'">'
      + '<div class="dot"></div>'
      + '<div class="info">'
      +   '<div class="nm">'+esc(s.name)
      +     '<span class="pt">'+esc(s.port)+'</span></div>'
      +   '<div class="ds">'+esc(s.desc)+'</div>'
      +   '<div class="st">'+esc(stText)+'</div>'
      + '</div>'
      + '<div class="acts">'
      +   '<button class="sm" onclick="act(\'start\',\''+s.key+'\')">启动</button>'
      +   '<button class="sm danger" onclick="act(\'stop\',\''+s.key+'\')">停止</button>'
      +   '<button class="sm" onclick="viewLog(\''+s.key+'\')">看日志</button>'
      + '</div>'
      + '</div>';
  });
  document.getElementById('cards').innerHTML = html;

  var lb = '';
  (data.log||[]).slice().reverse().forEach(function(e){
    var c = {ok:'k',warn:'w',error:'e'}[e.level] || 't';
    lb += '<div class="'+c+'">['+esc(e.t)+'] '+esc(e.msg)+'</div>';
  });
  document.getElementById('logBody').innerHTML = lb || '<div class="t">（还没有操作）</div>';
}

async function refresh(){
  try{
    var r = await fetch('/api/status',{cache:'no-store'});
    render(await r.json());
  }catch(e){
    document.getElementById('logBody').innerHTML =
      '<div class="e">连不上控制台服务了。请重新双击 启动影策.bat</div>';
  }
}

async function post(url){
  if(busy) return;
  busy = true;
  document.getElementById('busyTip').style.display='inline';
  try{
    await fetch(url,{method:'POST'});
  }catch(e){}
  await refresh();
  busy = false;
  document.getElementById('busyTip').style.display='none';
}

function act(a,k){ post('/api/'+a+'/'+k); }
function startAll(){ post('/api/start/all'); }
function stopAll(){
  if(!confirm('确定停止全部服务吗？\n（影策网页会打不开，直到你再次启动）')) return;
  post('/api/stop/all');
}

async function viewLog(k){
  var r = await fetch('/api/log/'+k,{cache:'no-store'});
  var d = await r.json();
  document.getElementById('modalTitle').textContent = d.name+' · 最近日志';
  document.getElementById('modalBody').textContent = d.text;
  document.getElementById('modal').classList.add('show');
}

// 接入自检：只读体检，把断链定位压成一次点击
async function selfCheck(){
  var btn = document.getElementById('btnSelfCheck');
  btn.disabled = true; btn.textContent = '自检中…';
  try{
    var r = await fetch('/api/selfcheck',{cache:'no-store'});
    var d = await r.json();
    document.getElementById('modalTitle').textContent =
      (d.ok ? '[全通] ' : '[有断点] ') + '接入自检报告';
    document.getElementById('modalBody').textContent = d.text;
    document.getElementById('modal').classList.add('show');
  }catch(e){
    alert('自检请求失败：'+e);
  }finally{
    btn.disabled = false; btn.textContent = '接入自检';
  }
}

document.getElementById('btnStartAll').onclick = startAll;
document.getElementById('btnStopAll').onclick = stopAll;
document.getElementById('btnRefresh').onclick = refresh;
document.getElementById('btnSelfCheck').onclick = selfCheck;
// 打开画布：必须带 ?mode=new 才会连上 Canvas Agent，
// 否则 WorkBuddy 侧 MCP 会一直报「当前没有已连接画布」
document.getElementById('btnOpenCanvas').onclick = function(){
  window.open('http://127.0.0.1:3000/canvas?mode=new','_blank');
};
document.getElementById('btnOpen').onclick = function(){
  window.open('http://127.0.0.1:3000','_blank');
};

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    # 面板状态：key -> 'starting' | 'stopping'
    busy_state = {}

    def log_message(self, *args):
        pass  # 别把每请求打到终端

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]

        if p in ("/", "/index.html"):
            body = PANEL_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if p == "/api/status":
            svcs = []
            for s in SERVICES:
                st = Handler.busy_state.get(s["key"])
                if not st:
                    st = "running" if port_alive(s["port"]) else "stopped"
                svcs.append({
                    "key": s["key"], "name": s["name"], "desc": s["desc"],
                    "port": s["port"], "state": st, "busy": st in ("starting", "stopping"),
                })
            with _log_lock:
                logs = list(_event_log)
            self._json({"services": svcs, "log": logs})
            return

        # 接入自检：只读体检，不改任何东西
        if p == "/api/selfcheck":
            script = os.path.join(ROOT, "_ops", "check_integration.py")
            if not os.path.isfile(script):
                self._json({"ok": False, "text": "找不到自检脚本: %s" % script})
                return
            try:
                proc = subprocess.run(
                    [PYTHON, script],
                    capture_output=True, text=True,
                    encoding="utf-8", errors="replace",
                    timeout=60, cwd=ROOT,
                )
                self._json({
                    "ok": proc.returncode == 0,
                    "code": proc.returncode,
                    "text": (proc.stdout or "") + (proc.stderr or ""),
                })
            except Exception as e:
                self._json({"ok": False, "text": "自检执行失败: %r" % (e,)})
            return

        if p.startswith("/api/log/"):
            key = p[len("/api/log/"):]
            s = SVC_BY_KEY.get(key)
            if not s:
                self._json({"name": "?", "text": "(没有这个服务)"})
                return
            self._json({"name": s["name"], "text": tail_log(s)})
            return

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = self.path.split("?")[0]
        parts = [x for x in p.split("/") if x]
        # 期望 /api/<action>/<target>
        if len(parts) != 3 or parts[0] != "api":
            self._json({"error": "bad request"}, 400)
            return
        action, target = parts[1], parts[2]

        if action not in ("start", "stop"):
            self._json({"error": "bad action"}, 400)
            return

        def work():
            try:
                if target == "all":
                    items = SERVICES if action == "start" else list(reversed(SERVICES))
                else:
                    s = SVC_BY_KEY.get(target)
                    items = [s] if s else []
                for s in items:
                    Handler.busy_state[s["key"]] = "starting" if action == "start" else "stopping"
                    try:
                        if action == "start":
                            start_service(s)
                        else:
                            stop_service(s)
                    finally:
                        Handler.busy_state.pop(s["key"], None)
            except Exception as e:
                log_event("操作出错：%s" % e, "error")

        threading.Thread(target=work, daemon=True).start()
        self._json({"ok": True})


# ---------------------------------------------------------------- 入口

def auto_start_if_idle():
    """
    双击 bat 后自动把服务拉起来 —— 用户不需要再点任何按钮。
    只有当「一个服务都没在跑」时才自动启动，避免重复起。
    """
    time.sleep(1.2)
    running = [s for s in SERVICES if port_alive(s["port"], timeout=0.4)]
    if running:
        log_event("检测到 %d 个服务已在运行，跳过自动启动" % len(running))
        return

    log_event("没有服务在运行，开始自动启动 …")
    for s in SERVICES:
        Handler.busy_state[s["key"]] = "starting"
        try:
            start_service(s)
        finally:
            Handler.busy_state.pop(s["key"], None)

    up = [s for s in SERVICES if port_alive(s["port"], timeout=0.4)]
    if len(up) == len(SERVICES):
        log_event("全部 %d 个服务已就绪。点「打开影策网页」开始用。" % len(up), "ok")
    else:
        log_event("%d/%d 个服务就绪。没起来的可以点它右边的「看日志」查原因。"
                  % (len(up), len(SERVICES)), "warn")


def main():
    # 已经被别的实例占用？直接开浏览器就行，别重复起
    if port_alive(PANEL_PORT):
        log_event("控制台已经在运行，直接打开面板")
        webbrowser.open("http://127.0.0.1:%d/" % PANEL_PORT)
        return 0

    log_event("控制台已启动，面板地址 http://127.0.0.1:%d/" % PANEL_PORT)

    server = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    # 后台自动拉起服务，不阻塞面板打开
    threading.Thread(target=auto_start_if_idle, daemon=True).start()

    url = "http://127.0.0.1:%d/" % PANEL_PORT
    print("")
    print("  影策控制台已就绪")
    print("  面板地址： %s" % url)
    print("  浏览器应该会自动打开。没有的话手动访问上面的地址。")
    print("  想停止全部服务，在面板上点「全部停止」，或直接关掉这个窗口后")
    print("  运行 stop-yingce.bat")
    print("")
    sys.stdout.flush()

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
