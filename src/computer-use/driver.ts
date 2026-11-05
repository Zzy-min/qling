import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import { MCPClient } from "../mcp/client.js";
import type { MCPToolDefinition } from "../mcp/types.js";
import type { ComputerUseDriver, DriverResult } from "./controller.js";

const DRIVER_TOOLS = new Set(["list_windows", "get_window_state", "click", "double_click", "scroll", "type_text", "press_key", "hotkey", "set_value"]);
export function computerDriverEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && allowed.has(name.toUpperCase())) result[name] = value;
  result.CUA_DRIVER_PERMISSION_MODE = "standard";
  return result;
}

/** Existing local binary only. Never installs, grants existing browser profiles, or replays input. */
export class CuaMcpDriver implements ComputerUseDriver {
  private client: MCPClient | null = null;
  private schemas = new Map<string, MCPToolDefinition>();
  private connecting: Promise<void> | null = null;
  private epoch = 0;
  get generation(): number { return this.epoch; }
  constructor(private options: { command: string; args?: string[]; callTimeoutMs?: number }) {}
  async connect(): Promise<void> {
    if (this.client?.isConnected()) return;
    if (!this.connecting) this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private async open(): Promise<void> {
    const epoch = ++this.epoch;
    if (!isAbsolute(this.options.command) || !(await stat(this.options.command)).isFile()) throw new Error("Absolute local driver binary required");
    if (epoch !== this.epoch) throw new Error("Computer driver connection closed");
    const client = new MCPClient({
      name: "qling-computer-use", enabled: true, command: this.options.command,
      args: this.options.args ?? ["mcp"], env: computerDriverEnvironment(),
    }, { connection: 10_000, call: this.options.callTimeoutMs ?? 30_000, inheritEnv: false, maxMessageBytes: 16 * 1024 * 1024, logStderr: false });
    this.client = client;
    const connected = await client.connect();
    if (epoch !== this.epoch) { await client.disconnect(); throw new Error("Computer driver connection closed"); }
    if (connected.status !== "connected") { await this.close(); throw new Error("Computer driver connection failed"); }
    this.schemas = new Map(client.getTools().map(tool => [tool.name, tool]));
    if (!["list_windows", "get_window_state"].every(name => this.schemas.has(name))) {
      await this.close(); throw new Error("Computer driver observation contract not supported");
    }
  }
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<DriverResult> {
    const definition = this.schemas.get(name);
    const props = definition?.inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = definition?.inputSchema.required;
    const unsupported = !DRIVER_TOOLS.has(name) || !definition || !props ||
      Object.keys(args).some(key => !Object.hasOwn(props, key) || (Array.isArray(props[key].enum) && !props[key].enum.includes(args[key]))) ||
      (Array.isArray(required) && required.some(key => typeof key !== "string" || !Object.hasOwn(args, key)));
    if (unsupported) return { isError: true, structuredContent: { ok: false, code: "CAPABILITY_UNSUPPORTED" } };
    if (!this.client) throw new Error("Computer driver is disconnected");
    try { return await this.client.callToolRaw(name, args, signal); }
    catch (error) { await this.close(); throw error; }
  }
  async close(): Promise<void> {
    this.epoch++;
    const client = this.client;
    this.client = null;
    this.schemas.clear();
    await client?.disconnect();
  }
}
