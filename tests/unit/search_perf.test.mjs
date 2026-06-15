import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as realExecFile } from "node:child_process";
import { readdir as realReaddir, readFile as realReadFile, stat as realStat } from "node:fs/promises";

let mockExecFileHandler = null;
let mockReaddirHandler = null;

// Register ESM mocks globally before importing the module under test
mock.module("child_process", {
  namedExports: {
    execFile: (file, args, options, callback) => {
      if (mockExecFileHandler) {
        return mockExecFileHandler(file, args, options, callback);
      }
      const cb = typeof options === "function" ? options : callback;
      const opt = typeof options === "function" ? {} : options;
      return realExecFile(file, args, opt, cb);
    }
  }
});

mock.module("fs/promises", {
  namedExports: {
    readdir: async (path, options) => {
      if (mockReaddirHandler) {
        return mockReaddirHandler(path, options);
      }
      return realReaddir(path, options);
    },
    readFile: realReadFile,
    stat: realStat
  }
});

// Dynamically import runSearch after registering mock.module
const { runSearch } = await import("../../dist/tools/search.js");

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-search-perf-test-"));
  const prevWorkspace = process.env.QLING_WORKSPACE_DIR;
  const prevState = process.env.QLING_FILE_STATE_DIR;
  const prevCache = process.env.QLING_FILE_CACHE_DIR;
  try {
    process.env.QLING_WORKSPACE_DIR = dir;
    process.env.QLING_FILE_STATE_DIR = join(dir, ".state");
    process.env.QLING_FILE_CACHE_DIR = join(dir, ".cache");
    await fn(dir);
  } finally {
    mockExecFileHandler = null;
    mockReaddirHandler = null;
    if (prevWorkspace === undefined) delete process.env.QLING_WORKSPACE_DIR;
    else process.env.QLING_WORKSPACE_DIR = prevWorkspace;
    if (prevState === undefined) delete process.env.QLING_FILE_STATE_DIR;
    else process.env.QLING_FILE_STATE_DIR = prevState;
    if (prevCache === undefined) delete process.env.QLING_FILE_CACHE_DIR;
    else process.env.QLING_FILE_CACHE_DIR = prevCache;
    await rm(dir, { recursive: true, force: true });
  }
}

test("search_perf: native search traversal budget limit (10k) warning", async () => {
  await withTempDir(async (dir) => {
    mockReaddirHandler = async () => {
      return Array.from({ length: 10005 }, (_, i) => {
        return {
          name: `fake-file-${i}.txt`,
          isDirectory: () => false,
          isFile: () => true,
        };
      });
    };

    mockExecFileHandler = (file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      const err = new Error("Command failed");
      err.code = "ENOENT";
      cb(err, "", "");
    };

    const result = await runSearch({
      pattern: "dummy",
      target: "content",
      path: dir,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /Warning: Traversal budget/);
  });
});

test("search_perf: git grep fallback works when ripgrep is missing", async () => {
  await withTempDir(async (dir) => {
    mockExecFileHandler = (file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (file === "rg") {
        const err = new Error("rg not found");
        err.code = "ENOENT";
        cb(err, "", "");
      } else if (file === "git") {
        if (args[0] === "ls-files") {
          cb(null, "target.txt\n", "");
        } else if (args[0] === "grep") {
          cb(null, "target.txt:1:hello git grep\n", "");
        } else {
          const opt = typeof options === "function" ? {} : options;
          realExecFile(file, args, opt, cb);
        }
      } else {
        const opt = typeof options === "function" ? {} : options;
        realExecFile(file, args, opt, cb);
      }
    };

    const result = await runSearch({
      pattern: "git",
      target: "content",
      path: dir,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /target\.txt:1:hello git grep/);
  });
});

test("search_perf: git ls-files fallback works for files search", async () => {
  await withTempDir(async (dir) => {
    mockExecFileHandler = (file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (file === "rg") {
        const err = new Error("rg not found");
        err.code = "ENOENT";
        cb(err, "", "");
      } else if (file === "git") {
        if (args[0] === "ls-files") {
          cb(null, "allowed.txt\nignored.md\n", "");
        } else {
          const opt = typeof options === "function" ? {} : options;
          realExecFile(file, args, opt, cb);
        }
      } else {
        const opt = typeof options === "function" ? {} : options;
        realExecFile(file, args, opt, cb);
      }
    };

    const result = await runSearch({
      pattern: "*.txt",
      target: "files",
      path: dir,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /allowed\.txt/);
    assert.doesNotMatch(result.output, /ignored\.md/);
  });
});
