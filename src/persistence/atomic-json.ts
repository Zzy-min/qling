import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface AtomicJsonWriteOptions {
  backup?: boolean;
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: AtomicJsonWriteOptions = {}
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.backup) {
      try {
        await fs.copyFile(filePath, `${filePath}.bak`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
