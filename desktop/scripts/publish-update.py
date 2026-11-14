# PeekReel 发版上传：把 electron-builder 产物推到 HK 服务器更新源。
# 用法：python desktop/scripts/publish-update.py --edition lite [安装包路径]
# 凭据从 desktop/scripts/.release-credentials.json 读取（已 gitignore）：
#   {"host": "...", "port": 22, "user": "root", "password": "..."}
# 流程：1) 校验本地版本 > 服务器版本（防回滚） 2) 块映射差分上传（优先，实测
#       0.2.13→0.2.14 只需传 0.8MB/265MB） 3) 不可用时 8 连接并行全量上传兜底
#       4) 服务器端拼装 + sha512 全量校验 5) 原子切换 6) 旧包清理
# 差分与 electron-updater 的差分下载同源：blockmap 记录安装包每块的 sha256+长度，
# 服务器已持有的块零传输；拼装结果 sha512 与本地新包比对，不一致自动回退全量。
import argparse, base64, glob, gzip, hashlib, json, os, re, shutil, subprocess, sys, threading, time
import paramiko

HERE = os.path.dirname(os.path.abspath(__file__))
RELEASE = os.path.join(HERE, "..", "release")
REMOTE_DIR = "/opt/peekreel/updates/lite"
FEED_URL = "https://peekreel.peekcart.com/updates/lite/"
REMOTE_APPLY_DIFF = "/opt/peekreel/update-tools/apply-diff.py"
UPLOAD_WORKERS = 8  # 实测跨境 SFTP：1 连接 0.3MB/s，8 连接 1.8MB/s（近线性）
DIFF_MIN_REUSE = 0.4  # 服务器已有字节低于 40% 时差分无收益，直接全量

def load_creds():
    path = os.path.join(HERE, ".release-credentials.json")
    if not os.path.exists(path):
        sys.exit(f"缺少 {path}（服务器凭据，不入库）")
    return json.load(open(path, encoding="utf-8"))

def ver_tuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3])

def sha512_b64(path):
    h = hashlib.sha512()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(buf)
    return base64.b64encode(h.digest()).decode()

def verify_signature(exe):
    if os.name == "nt":
        powershell = shutil.which("powershell.exe") or shutil.which("powershell") or shutil.which("pwsh")
        if not powershell:
            sys.exit("无法验证 Windows Authenticode 签名：未找到 PowerShell")
        literal = exe.replace("'", "''")
        result = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command", f"(Get-AuthenticodeSignature -LiteralPath '{literal}').Status"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0 or result.stdout.strip().splitlines()[-1:] != ["Valid"]:
            sys.exit("Lite 安装包没有有效的 Authenticode 签名；未发布")
        return
    verifier = shutil.which("osslsigncode")
    if not verifier:
        sys.exit("无法验证 Windows Authenticode 签名：请安装 osslsigncode；未发布")
    result = subprocess.run([verifier, "verify", "-in", exe], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        sys.exit("Lite 安装包 Authenticode 签名无效；未发布")

def pick_artifacts(explicit=None, edition="lite"):
    if edition != "lite":
        sys.exit("当前发布工具只支持 Lite 更新源")
    prefix = "PeekReel-Lite-Setup-"
    package = json.load(open(os.path.join(HERE, "..", "package.json"), encoding="utf-8"))
    package_version = package.get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", package_version):
        sys.exit("desktop/package.json 版本号无效")
    exe = explicit or None
    if not exe:
        setups = sorted(glob.glob(os.path.join(RELEASE, prefix + "*.exe")), key=os.path.getmtime)
        if not setups:
            sys.exit("release/ 下没有 PeekReel-Lite-Setup-*.exe，先 npm run dist:lite")
        exe = setups[-1]
    exe = os.path.abspath(exe)
    expected_name = f"{prefix}{package_version}-x64.exe"
    if os.path.basename(exe) != expected_name:
        sys.exit("安装包名称与 Lite 更新渠道不匹配")
    yml = os.path.join(RELEASE, "latest.yml")
    if not os.path.exists(yml):
        sys.exit("release/latest.yml 不存在（electron-builder 需配置 publish 生成）")
    manifest = open(yml, encoding="utf-8").read()
    version_match = re.search(r"^version:\s*(\S+)\s*$", manifest, re.MULTILINE)
    path_match = re.search(r"^path:\s*(\S+)\s*$", manifest, re.MULTILINE)
    hash_match = re.search(r"^sha512:\s*(\S+)\s*$", manifest, re.MULTILINE)
    size_match = re.search(r"^files:\s*\n\s+- url:.*?\n\s+sha512:\s*(\S+)\s*\n\s+size:\s*(\d+)", manifest, re.MULTILINE | re.DOTALL)
    if not version_match or version_match.group(1) != package_version or not path_match or not hash_match or not size_match or path_match.group(1) != expected_name:
        sys.exit("latest.yml 与 Lite 安装包不匹配")
    if hash_match.group(1) != sha512_b64(exe) or int(size_match.group(2)) != os.path.getsize(exe):
        sys.exit("latest.yml 的 SHA-512 或文件大小与 Lite 安装包不一致")
    if size_match.group(1) != hash_match.group(1):
        sys.exit("latest.yml 内的文件哈希字段不一致")
    return exe, yml

def load_blockmap(path):
    """读 blockmap（gzip+JSON），取 files[0]（NSIS 安装包只有这一个 entry）。"""
    with gzip.open(path, "rb") as f:
        return json.load(f)["files"][0]

def compute_diff(new_exe, new_blockmap, old_blockmap_path):
    """复刻 electron-updater downloadPlanBuilder 的语义（块 blake2b(18)+长度都相同才算复用），
    但块在新包里的偏移可能整体漂移，所以复用块也要生成「旧偏移→新偏移」的拷贝指令。
    返回 (差分载荷路径, 元数据, 复用字节比例)；ops 三元组 [old_off, new_off, sz]，
    old_off<0 表示从载荷顺序取字节。"""
    new = load_blockmap(new_blockmap)
    old = load_blockmap(old_blockmap_path)
    old_map = {}
    off = old["offset"]
    for i, c in enumerate(old["checksums"]):
        if c not in old_map:
            old_map[c] = (off, old["sizes"][i])
        off += old["sizes"][i]
    with open(new_exe, "rb") as f:
        data = f.read()
    diff_path = new_exe + ".diffbin"
    meta = {"new_size": len(data), "base_size": sum(old["sizes"]), "ops": []}
    reuse = total = 0
    off = new["offset"]
    with open(diff_path, "wb") as out:
        for i, c in enumerate(new["checksums"]):
            sz = new["sizes"][i]
            hit = old_map.get(c)
            total += sz
            if hit and hit[1] == sz:
                reuse += sz
                meta["ops"].append([hit[0], off, sz])
            else:
                out.write(data[off:off + sz])
                meta["ops"].append([-1, off, sz])
            off += sz
    return diff_path, meta, (reuse / total if total else 0)

def upload_differential(client, exe, exe_name, local_sha512, old_blockmap_local):
    """差分上传路径。成功返回 True；任何失败返回 False（调用方走全量兜底）。"""
    diff_dir = f"{REMOTE_DIR}/.diff"
    diff_path = meta_path = None
    try:
        diff_path, meta, ratio = compute_diff(exe, exe + ".blockmap", old_blockmap_local)
        diff_size = os.path.getsize(diff_path)
        full_size = os.path.getsize(exe)
        print(f"差分计划：{diff_size/1048576:.1f}MB / 全量 {full_size/1048576:.0f}MB（服务器可复用 {ratio*100:.1f}%）", flush=True)
        if diff_size == 0 or ratio < DIFF_MIN_REUSE:
            print(f"  复用率 {ratio*100:.0f}% 低于阈值，不值得差分", flush=True)
            return False
        meta_path = diff_path + ".json"
        with open(meta_path, "w") as f:
            json.dump(meta, f)
        base_name = os.path.basename(old_blockmap_local)[len(".remote-"):-len(".blockmap")]
        base_exe = f"{REMOTE_DIR}/{base_name}"
        assembled = f"{REMOTE_DIR}/{exe_name}.diff-assembled"
        _, out, _ = client.exec_command(f"rm -rf {diff_dir} && mkdir -p {diff_dir}", timeout=30)
        out.channel.recv_exit_status()
        sftp = client.open_sftp()
        sftp.put(diff_path, diff_dir + "/diff.bin")
        sftp.put(meta_path, diff_dir + "/diff.json")
        # 新 blockmap 传给服务器做逐块校验（apply-diff 用 blake2b(18) 比对）
        sftp.put(exe + ".blockmap", diff_dir + "/new.blockmap")
        sftp.close()
        cmd = (f"python3 {REMOTE_APPLY_DIFF} '{base_exe}' {diff_dir}/diff.bin {diff_dir}/diff.json "
               f"{diff_dir}/new.blockmap '{assembled}'"
               f" && python3 -c \"import base64,hashlib;"
               f"print(base64.b64encode(hashlib.sha512(open('{assembled}','rb').read()).digest()).decode())\"")
        _, out, err = client.exec_command(cmd, timeout=600)
        lines = [l.strip() for l in out.read().decode("utf-8", "replace").splitlines() if l.strip()]
        rc = out.channel.recv_exit_status()
        e = err.read().decode("utf-8", "replace").strip()
        if e:
            print("  STDERR:", e, flush=True)
        remote_sha = lines[-1] if lines else ""
        if rc != 0 or remote_sha != local_sha512:
            print(f"  差分拼装校验不一致（rc={rc}），回退全量", flush=True)
            client.exec_command(f"rm -rf {diff_dir} '{assembled}'", timeout=30)
            return False
        _, out, _ = client.exec_command(f"mv -f '{assembled}' '{REMOTE_DIR}/package.exe.tmp' && rm -rf {diff_dir}", timeout=60)
        rc = out.channel.recv_exit_status()
        if rc != 0:
            print("  差分产物切换失败，回退全量", flush=True)
            return False
        print(f"  差分上传成功：{diff_size/1048576:.1f}MB（全量应为 {full_size/1048576:.0f}MB）", flush=True)
        return True
    except Exception as ex:
        print(f"  差分路径异常（{ex}），回退全量", flush=True)
        client.exec_command(f"rm -rf {diff_dir}", timeout=30)
        return False
    finally:
        for p in (diff_path, meta_path):
            if p:
                try: os.remove(p)
                except OSError: pass

def upload_parallel(client, creds, local_path, remote_path):
    """分块并行上传：每线程独立 SSH 连接写远端分片，最后服务器端 cat 拼接。
    进度按完成分片数估算。失败抛异常终止发版。"""
    size = os.path.getsize(local_path)
    n = min(UPLOAD_WORKERS, max(1, (size + 16 * 1024 * 1024 - 1) // (16 * 1024 * 1024)))
    chunk = (size + n - 1) // n
    parts_dir = remote_path + ".parts"
    client.exec_command(f"rm -rf {parts_dir} && mkdir -p {parts_dir}")[1].channel.recv_exit_status()
    done_flags, lock, start = [False] * n, threading.Lock(), time.time()
    def worker(i):
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(creds["host"], creds.get("port", 22), creds["user"], creds["password"], timeout=30)
        sftp = ssh.open_sftp()
        begin, end = i * chunk, min((i + 1) * chunk, size)
        with open(local_path, "rb") as f, sftp.open(f"{parts_dir}/{i:03d}", "wb") as remote:
            f.seek(begin)
            remaining = end - begin
            while remaining > 0:
                buf = f.read(min(512 * 1024, remaining))
                remote.write(buf)
                remaining -= len(buf)
        sftp.close(); ssh.close()
        with lock:
            done_flags[i] = True
            print(f"  分片 {i+1}/{n} 完成（{sum(done_flags)}/{n}，{time.time()-start:.0f}s）", flush=True)
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads: t.start()
    for t in threads: t.join()
    if not all(done_flags):
        sys.exit("并行上传失败（有分片未完成）")
    # 服务器端拼接 + 本地一致性校验（分片顺序拼接后比对字节数）
    sha_cmd = f"cd {parts_dir} && cat $(ls | sort) > {remote_path} && stat -c %s {remote_path} && rm -rf {parts_dir}"
    _, out, _ = client.exec_command(sha_cmd, timeout=300)
    remote_size = out.read().decode().strip().splitlines()
    if not remote_size or int(remote_size[-1]) != size:
        sys.exit(f"拼接后大小不一致：本地 {size}，远端 {remote_size}")
    print(f"  上传完成 {time.time()-start:.0f}s（{size/1048576/(time.time()-start):.1f}MB/s）", flush=True)

def main():
    parser = argparse.ArgumentParser(description="发布签名的 PeekReel Lite 更新包")
    parser.add_argument("--edition", choices=["lite"], default="lite")
    parser.add_argument("artifact", nargs="?", help="可选的已签名 Lite 安装包路径")
    args = parser.parse_args()
    exe, yml = pick_artifacts(args.artifact, args.edition)
    verify_signature(exe)
    local_ver = re.search(r"version:\s*(\S+)", open(yml, encoding="utf-8").read()).group(1)
    exe_name = os.path.basename(exe)
    print(f"exe = {exe_name} ({os.path.getsize(exe)/1048576:.0f}MB)\n本地版本 = {local_ver}", flush=True)

    creds = load_creds()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(creds["host"], creds.get("port", 22), creds["user"], creds["password"], timeout=15)

    def run(cmd, label, timeout=120):
        _, out, err = client.exec_command(cmd, timeout=timeout)
        o, e = out.read().decode("utf-8", "replace").strip(), err.read().decode("utf-8", "replace").strip()
        rc = out.channel.recv_exit_status()
        print(f"--- {label} (rc={rc})", flush=True)
        if o: print(o, flush=True)
        if e: print("STDERR:", e, flush=True)
        if rc != 0: sys.exit(f"步骤失败：{label}")
        return o

    remote_ver = ""
    head = run(f"head -1 {REMOTE_DIR}/latest.yml 2>/dev/null || true", "remote-latest")
    m = re.search(r"version:\s*(\S+)", head or "")
    if m:
        remote_ver = m.group(1)
        if ver_tuple(remote_ver) >= ver_tuple(local_ver):
            sys.exit(f"服务器已是 {remote_ver}，本地 {local_ver} 不是升级；先升 desktop/package.json 版本号")
    print(f"版本推进：{remote_ver or '(首次发布)'} -> {local_ver}", flush=True)

    run(f"mkdir -p {REMOTE_DIR}", "mkdir")

    # 差分基线 = 服务器上与旧安装包同期发布的 blockmap（对旧包字节权威）。
    old_bm_local = None
    if os.path.exists(exe + ".blockmap"):
        listed = run(f"ls -1 {REMOTE_DIR} 2>/dev/null || true", "list-base")
        cands = [l for l in listed.splitlines()
                 if l.endswith(".blockmap") and l != exe_name + ".blockmap"]
        if cands:
            base_blockmap = sorted(cands)[-1]  # 文件名含版本号，字典序即版本序
            old_bm_local = os.path.join(HERE, ".remote-" + base_blockmap)
            sftp0 = client.open_sftp()
            try:
                sftp0.get(f"{REMOTE_DIR}/{base_blockmap}", old_bm_local)
                print(f"差分基线 = {base_blockmap}", flush=True)
            except Exception as ex:
                print(f"旧 blockmap 拉取失败（{ex}），走全量", flush=True)
                old_bm_local = None
            finally:
                sftp0.close()

    local_sha512 = sha512_b64(exe)
    uploaded = (old_bm_local is not None
                and upload_differential(client, exe, exe_name, local_sha512, old_bm_local))
    try:
        if old_bm_local: os.remove(old_bm_local)
    except OSError: pass

    if not uploaded:
        print(f"全量上传安装包（{os.path.getsize(exe)/1048576:.0f}MB，{UPLOAD_WORKERS} 连接并行）...", flush=True)
        upload_parallel(client, creds, exe, REMOTE_DIR + "/package.exe.tmp")

    # 落盘产物 sha512 必须等于本地新包（差分/全量统一出口校验），不一致终止发版。
    verify = run("python3 -c \"import base64,hashlib;"
                 f"print(base64.b64encode(hashlib.sha512(open('{REMOTE_DIR}/package.exe.tmp','rb').read()).digest()).decode())\"",
                 "verify-assembled", timeout=300)
    got = verify.strip().splitlines()[-1] if verify.strip() else ""
    if got != local_sha512:
        sys.exit("服务器产物 sha512 与本地新包不一致，发版终止（线上文件未被改动）")

    sftp = client.open_sftp()
    sftp.put(yml, REMOTE_DIR + "/latest.yml.tmp")
    if os.path.exists(exe + ".blockmap"):
        sftp.put(exe + ".blockmap", REMOTE_DIR + "/package.blockmap.tmp")

    bm = f' && mv -f package.blockmap.tmp "{exe_name}.blockmap"' if os.path.exists(exe + ".blockmap") else ""
    run(f'cd {REMOTE_DIR} && mv -f package.exe.tmp "{exe_name}" && mv -f latest.yml.tmp latest.yml{bm} && chmod 644 *', "atomic-swap")

    # 旧版本清理：保留最近两版（当前 + 上一版回退），其余 exe/blockmap 删除。
    keep = {exe_name, exe_name + ".blockmap"}
    listed = run(f"ls -1 {REMOTE_DIR}", "list-before-cleanup")
    old = [l for l in listed.splitlines() if l.endswith((".exe", ".blockmap")) and l not in keep]
    def ver_of(name):
        m = re.search(r"Setup-([\d.]+)-x64", name)
        return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)
    if old:
        newest_old = max(ver_of(f) for f in old)
        remove = [f for f in old if ver_of(f) != newest_old]
        if remove:
            run(f'cd {REMOTE_DIR} && rm -f {" ".join(chr(34)+f+chr(34) for f in remove)} && echo cleaned', "cleanup-old")
    run(f"curl -sk -o /dev/null -w '%{{http_code}}' -H 'Host: peekreel.peekcart.com' http://127.0.0.1/updates/lite/latest.yml || true", "lite-feed-probe")
    run(f"curl -sk -o /dev/null -w '%{{http_code}}' https://upd.contect.de5.net/lite/latest.yml || true", "lite-cdn-probe")
    run(f"ls -la {REMOTE_DIR}", "list")
    sftp.close(); client.close()
    print(f"PUBLISH DONE — {FEED_URL} 下次检查更新时将获取此版本", flush=True)

if __name__ == "__main__":
    main()
