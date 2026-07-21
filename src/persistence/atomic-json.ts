import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface AtomicJsonWriteOptions {
  backup?: boolean;
}

export interface JsonReadResult<T> {
  value: T;
  source: "primary" | "backup";
  primaryError?: Error;
}

const fileQueues = new Map<string, Promise<void>>();

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: AtomicJsonWriteOptions = {}
): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);
  return enqueueFileOperation(filePath, () => atomicWriteSerialized(filePath, serialized, options));
}

export async function readJsonWithBackup<T>(filePath: string): Promise<JsonReadResult<T> | null> {
  try {
    return { value: JSON.parse(await fs.readFile(filePath, "utf8")) as T, source: "primary" };
  } catch (error) {
    const primaryError = error as Error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    try {
      return {
        value: JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8")) as T,
        source: "backup",
        primaryError,
      };
    } catch {
      return null;
    }
  }
}

export function enqueueFileOperation(filePath: string, operation: () => Promise<void>): Promise<void> {
  const key = path.resolve(filePath);
  const previous = fileQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  fileQueues.set(key, current);
  return current.finally(() => {
    if (fileQueues.get(key) === current) fileQueues.delete(key);
  });
}

async function atomicWriteSerialized(
  filePath: string,
  serialized: string,
  options: AtomicJsonWriteOptions
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
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
