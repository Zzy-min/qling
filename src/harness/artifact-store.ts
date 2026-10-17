import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ArtifactRef {
  hash: string;
  path: string;
  mime: string;
  bytes: number;
}

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export class ContentAddressedArtifactStore {
  private readonly stateDir: string;
  private readonly root: string;
  private rootReady: Promise<void> | null = null;

  constructor(stateDir: string) {
    this.stateDir = path.resolve(stateDir);
    this.root = path.join(this.stateDir, "artifacts", "sha256");
  }

  async put(content: string | Uint8Array, mime = "text/plain; charset=utf-8"): Promise<ArtifactRef> {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const hash = createHash("sha256").update(data).digest("hex");
    const directory = path.join(this.root, hash.slice(0, 2));
    const target = path.join(directory, hash);
    await this.ensureRoot();
    await fs.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("artifact directory must be a regular directory");
    await fs.chmod(directory, 0o700).catch(() => undefined);
    let handle: fs.FileHandle | null = null;
    let created = false;
    try {
      handle = await fs.open(target, "wx", 0o600);
      created = true;
      await handle.writeFile(data);
      await handle.sync();
      await handle.chmod(0o600).catch(() => undefined);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        await this.readVerified(target, hash, true);
      } else {
        if (created) await fs.unlink(target).catch(() => undefined);
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
    return { hash, path: target, mime, bytes: data.byteLength };
  }

  async read(ref: Pick<ArtifactRef, "hash">): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(ref.hash)) throw new Error("invalid artifact hash");
    await this.ensureRoot();
    const target = path.join(this.root, ref.hash.slice(0, 2), ref.hash);
    return this.readVerified(target, ref.hash);
  }

  private async ensureRoot(): Promise<void> {
    if (!this.rootReady) {
      this.rootReady = (async () => {
        await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
        const realStateDir = await fs.realpath(this.stateDir);
        for (const directory of [path.join(this.stateDir, "artifacts"), this.root]) {
          await fs.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
          const linkStat = await fs.lstat(directory);
          if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) throw new Error("artifact root must be a regular directory");
          const realDirectory = await fs.realpath(directory);
          const relative = path.relative(realStateDir, realDirectory);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("artifact root escapes state directory");
          await fs.chmod(directory, 0o700).catch(() => undefined);
        }
      })().catch((error) => {
        this.rootReady = null;
        throw error;
      });
    }
    await this.rootReady;
  }

  private async readVerified(target: string, expectedHash: string, tightenPermissions = false): Promise<Buffer> {
    const before = await fs.lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("artifact target is not a regular file");
    const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
    const handle = await fs.open(target, flags);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("artifact target is not a regular file");
      if (stat.size > MAX_ARTIFACT_BYTES) throw new Error("artifact exceeds maximum supported size");
      const after = await fs.lstat(target);
      if (!after.isFile() || after.isSymbolicLink() || (before.ino !== 0 && stat.ino !== before.ino) || (after.ino !== 0 && stat.ino !== after.ino)) {
        throw new Error("artifact target changed during open");
      }
      if (tightenPermissions) await handle.chmod(0o600).catch(() => undefined);
      const data = await handle.readFile();
      const actual = createHash("sha256").update(data).digest("hex");
      if (actual !== expectedHash) throw new Error("artifact hash mismatch");
      return data;
    } finally {
      await handle.close();
    }
  }
}
