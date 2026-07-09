# 在 Docker 中运行轻灵 Qling

可选隔离路径（对标 Pi 的 containerization 建议）：把 Agent 关在容器里，宿主机只挂载工作区与必要配置。

> **默认仍是本机直接运行。** 容器不是强制依赖。

## 原则

1. **密钥不进镜像** — 用 `-e` / env-file（且 env-file 不提交）。  
2. **只挂载工作区** — 避免挂整个 `$HOME`。  
3. **写沙箱默认开启** — 容器内 `QLING_WORKSPACE_DIR=/workspace`，`QLING_WRITE_SANDBOX=workspace`。  
4. **网络按需收紧** — `QLING_GUARD_NETWORK_MODE=strict|open|deny`。

## 快速示例

仓库内草案：`packaging/docker/`。

```bash
# 构建
docker build -f packaging/docker/Dockerfile -t qling:1.0.0 .

# 运行（挂载当前目录为工作区）
docker run --rm -it \
  -e QLING_LLM_API_KEY \
  -e QLING_LLM_PROVIDER=deepseek \
  -e QLING_LLM_ENDPOINT=https://api.deepseek.com \
  -e QLING_LLM_MODEL=deepseek-chat \
  -e QLING_WORKSPACE_DIR=/workspace \
  -e QLING_WRITE_SANDBOX=workspace \
  -e QLING_GUARD_NETWORK_MODE=strict \
  -v "%cd%":/workspace \
  -w /workspace \
  qling:1.0.0 \
  run "列出 /workspace 下的文件"
```

Linux/macOS 将 `%cd%` 换成 `$(pwd)`。

## docker compose

见 `packaging/docker/docker-compose.yml`：

```bash
export QLING_LLM_API_KEY=...
docker compose -f packaging/docker/docker-compose.yml run --rm qling doctor
```

## 限制

| 能力 | 容器内说明 |
|------|------------|
| `browser_fetch` | 需额外装 Chromium 依赖，镜像体积大；默认镜像可不含 Playwright |
| GUI TUI | 交互 TUI 可用 `docker run -it`；体验不如本机终端 |
| 原生模块 | `better-sqlite3` 需在镜像构建时编译 |
| Daemon | 容器重启会丢进程；状态可挂载 `~/.qling` 卷（慎挂） |

## 推荐安全组合

```bash
QLING_WRITE_SANDBOX=workspace
QLING_GUARD_NETWORK_MODE=strict
QLING_ALLOW_SENSITIVE_WRITE=   # 保持空：禁止写 .env
# 不要设置 QLING_WRITE_SANDBOX=off
```

本机非容器时同样适用上述环境变量。详见 [install.md](install.md)。
