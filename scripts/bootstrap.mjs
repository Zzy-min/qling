#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const withBrowser = args.includes("--with-browser");
const noBrowser = args.includes("--no-browser");

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
  console.error(`Node.js >= 18 is required. Current: ${process.versions.node}`);
  process.exit(1);
}

console.log("\n🚀 轻灵 Bootstrap（源码本机启动）");
console.log("-----------------------------------------");
console.log(`Node : v${process.versions.node}`);
console.log(`npm  : ${output("npm", ["--version"])}`);

mkdirSync(join(homedir(), ".qling"), { recursive: true });

console.log("\n[1/4] 安装依赖");
run("npm", ["install"]);

console.log("\n[2/4] 构建项目");
run("npm", ["run", "build"]);

console.log("\n[3/4] 浏览器依赖");
if (withBrowser) {
  run("npx", ["playwright", "install", "chromium"]);
} else if (noBrowser) {
  console.log("已跳过浏览器依赖。需要 browser_fetch 时可运行: npm run bootstrap -- --with-browser");
} else {
  console.log("默认不安装浏览器依赖。需要 browser_fetch 时可运行: npm run bootstrap -- --with-browser");
}

console.log("\n[4/4] 本地诊断");
if (existsSync("dist/index.js")) {
  run(process.execPath, ["dist/index.js", "doctor"]);
}

console.log("下一步: 运行 `node dist/index.js setup` 配置模型，或运行 `node dist/index.js` 进入 TUI。");
