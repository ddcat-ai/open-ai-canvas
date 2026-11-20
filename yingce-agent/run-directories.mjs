import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const markerName = ".yingce-run.json";

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export class RunDirectories {
  constructor({ root = process.env.YINGCE_AGENT_TEMP_DIR || join(tmpdir(), "yingce-agent-runs"), orphanTTL = 24 * 60 * 60 * 1000, onError = console.error } = {}) {
    this.root = root;
    this.orphanTTL = orphanTTL;
    this.onError = onError;
    this.active = new Set();
    this.sweeping = null;
  }

  async initialize() {
    if (!isAbsolute(this.root)) throw new Error("YINGCE_AGENT_TEMP_DIR must be absolute");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("Agent temporary root must be a private directory owned by the service");
    }
    this.root = await realpath(this.root);
    await this.sweep();
    this.timer = setInterval(() => {
      this.sweep().catch(error => this.onError("Agent orphan cleanup failed", error));
    }, 10 * 60 * 1000);
    this.timer.unref();
    return this;
  }

  async create() {
    const path = await mkdtemp(join(this.root, "run-"));
    this.active.add(path);
    const marker = { version: 1, parentPID: process.pid, childPID: 0, createdAt: Date.now() };
    try {
      await writeFile(join(path, markerName), JSON.stringify(marker), { mode: 0o600, flag: "wx" });
    } catch (error) {
      this.active.delete(path);
      await rm(path, { recursive: true, force: true });
      throw error;
    }
    return {
      path,
      childStarted: async pid => {
        marker.childPID = pid;
        await writeFile(join(path, `${markerName}.tmp`), JSON.stringify(marker), { mode: 0o600, flag: "wx" });
        await rename(join(path, `${markerName}.tmp`), join(path, markerName));
      },
      cleanup: async () => {
        this.active.delete(path);
        await rm(path, { recursive: true, force: true });
      },
    };
  }

  sweep(now = Date.now()) {
    if (this.sweeping) return this.sweeping;
    this.sweeping = this.sweepOnce(now).finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  async sweepOnce(now) {
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!/^run-[A-Za-z0-9]+$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(this.root, entry.name);
      if (this.active.has(path)) continue;
      let handle;
      try {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) continue;
        handle = await open(join(path, markerName), constants.O_RDONLY | constants.O_NOFOLLOW);
        const markerInfo = await handle.stat();
        if (!markerInfo.isFile() || markerInfo.size > 1024 || (markerInfo.mode & 0o077)) continue;
        const marker = JSON.parse(await handle.readFile("utf8"));
        if (marker.version !== 1 || !Number.isSafeInteger(marker.createdAt) || now - marker.createdAt < this.orphanTTL) continue;
        if (marker.parentPID !== process.pid && processAlive(marker.parentPID)) continue;
        if (marker.childPID && processAlive(marker.childPID)) continue;
        if (!this.active.has(path)) await rm(path, { recursive: true, force: true });
      } catch (error) {
        if (!["ENOENT", "ELOOP"].includes(error.code) && !(error instanceof SyntaxError)) this.onError("Agent orphan directory was retained after cleanup failure", error);
      } finally {
        await handle?.close();
      }
    }
  }

  close() {
    clearInterval(this.timer);
  }
}
