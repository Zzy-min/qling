import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const windowsTest = process.platform === "win32" ? test : test.skip;
const packageVersion = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
).version;

windowsTest(
  "portable launcher resolves the real package root when invoked through a WinGet-style symlink",
  { timeout: 30_000 },
  (t) => {
    const windir = process.env.WINDIR || "C:\\Windows";
    const csc = [
      process.env.QLING_CSC,
      join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ].find((candidate) => candidate && existsSync(candidate));
    if (!csc) {
      t.skip(".NET Framework csc.exe is unavailable");
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "qling-portable-link-"));
    try {
      const packageRoot = join(root, "Packages", "Zzy-min.qling", "qling-win-x64");
      const linkDir = join(root, "Links");
      const launcher = join(packageRoot, "qling.exe");
      const link = join(linkDir, "qling.exe");
      const entry = join(packageRoot, "package", "dist", "index.js");
      mkdirSync(join(packageRoot, "runtime"), { recursive: true });
      mkdirSync(dirname(entry), { recursive: true });
      mkdirSync(linkDir, { recursive: true });
      copyFileSync(process.execPath, join(packageRoot, "runtime", "node.exe"));
      writeFileSync(
        entry,
        "console.log(JSON.stringify({ marker: 'portable-link-ok', args: process.argv.slice(2) }));\n",
        "utf8",
      );

      const compile = spawnSync(
        csc,
        [
          "/nologo",
          "/target:exe",
          "/platform:anycpu",
          "/optimize+",
          `/out:${launcher}`,
          join(process.cwd(), "packaging", "win-launcher", "qling-launcher.cs"),
        ],
        { encoding: "utf8" },
      );
      assert.equal(compile.status, 0, compile.stdout + compile.stderr);

      try {
        symlinkSync(launcher, link, "file");
      } catch (error) {
        if (error?.code === "EPERM") {
          t.skip("Windows symbolic-link creation is not permitted");
          return;
        }
        throw error;
      }

      const result = spawnSync(link, ["probe"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stderr, /Bundled Node runtime not found/);
      const payload = JSON.parse(result.stdout.trim());
      assert.equal(payload.marker, "portable-link-ok");
      assert.deepEqual(payload.args, ["probe"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

windowsTest(
  "built portable artifact starts through a WinGet-style symlink and handles a missing API key",
  { timeout: 30_000 },
  (t) => {
    const configuredArtifact = process.env.QLING_PORTABLE_ARTIFACT;
    if (!configuredArtifact) {
      t.skip("set QLING_PORTABLE_ARTIFACT after building the portable ZIP");
      return;
    }

    const artifact = resolve(configuredArtifact);
    assert.ok(existsSync(artifact), `portable artifact does not exist: ${artifact}`);
    const root = mkdtempSync(join(tmpdir(), "qling-built-artifact-link-"));
    try {
      const link = join(root, "qling.exe");
      try {
        symlinkSync(artifact, link, "file");
      } catch (error) {
        if (error?.code === "EPERM") {
          t.skip("Windows symbolic-link creation is not permitted");
          return;
        }
        throw error;
      }

      const versionResult = spawnSync(link, ["--version"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(versionResult.status, 0, versionResult.stdout + versionResult.stderr);
      assert.match(versionResult.stdout, new RegExp(`qling/${packageVersion.replace(/\./g, "\\.")}`));

      const missingKeyResult = spawnSync(link, [], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          USERPROFILE: root,
          HOME: root,
          QLING_LLM_ENDPOINT: "https://api.deepseek.com",
          QLING_LLM_API_KEY: "",
          DEEPSEEK_API_KEY: "",
          OPENAI_API_KEY: "",
          API_KEY: "",
          QLING_FILE_STATE_DIR: join(root, ".qling"),
          QLING_FILE_CACHE_DIR: join(root, ".qling", "cache"),
          QLING_WORKSPACE_DIR: root,
          QLING_BOOT_QUIET: "true",
        },
      });
      assert.equal(
        missingKeyResult.status,
        1,
        missingKeyResult.stdout + missingKeyResult.stderr,
      );
      assert.match(missingKeyResult.stderr, /QLING_API_KEY_MISSING/);
      assert.match(missingKeyResult.stderr, /qling setup/);
      assert.doesNotMatch(
        missingKeyResult.stderr,
        /at new AgentLoop|file:\/\/\/|Node\.js v\d+/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
