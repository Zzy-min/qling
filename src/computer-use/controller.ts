import { randomUUID, createHash } from "node:crypto";
import type { ToolResult } from "../types.js";
import { ContentAddressedArtifactStore } from "../harness/artifact-store.js";
import { computerActionSchema, isBlockedComputerKey, normalizeComputerKeys, OBSERVATION_ACTIONS, type ComputerAction } from "./schema.js";

export interface DriverResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}
export interface ComputerUseDriver {
  readonly generation?: number;
  connect(): Promise<void>;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<DriverResult>;
  close(): Promise<void>;
}
interface Snapshot {
  id: string; pid: number; window: string | number; nativeId?: string;
  driverGeneration?: number;
  elements: Set<number>; width?: number; height?: number;
}
class Refusal extends Error {
  constructor(readonly code: string) { super(code); }
}
function reply(action: string, ok: boolean, verdict: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    tool_call_id: "", is_error: !ok,
    output: JSON.stringify({ ok, action, verdict, ...extra }),
    ...(!ok ? { error: { code: String(extra.code ?? "COMPUTER_USE_ERROR"), message: verdict, retriable: false } } : {}),
  };
}
function payload(result: DriverResult): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result.content?.filter(p => p.type === "text").map(p => p.text ?? "").join("\n") ?? "";
  try { const parsed: unknown = JSON.parse(text); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

/** Owns one Agent's desktop state; no shared mutable target and no automatic input replay. */
export class ComputerUseController {
  private snapshot: Snapshot | null = null;
  private owner = "";
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private duplicateHash = "";
  private duplicateStreak = 0;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(private readonly options: {
    enabled: boolean; driver: ComputerUseDriver; stateDir: string; identity?: () => string;
  }) { this.artifacts = new ContentAddressedArtifactStore(options.stateDir); }

  execute(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const owner = this.options.identity?.() ?? "local";
    const next = this.queue.then(() => this.executeOne(raw, owner, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.snapshot = null;
    await this.options.driver.close();
  }
  private async executeOne(raw: Record<string, unknown>, owner: string, signal?: AbortSignal): Promise<ToolResult> {
    const action = typeof raw.action === "string" ? raw.action : "invalid";
    if (!this.options.enabled) return reply(action, false, "blocked", { code: "COMPUTER_USE_DISABLED" });
    if (this.closed) return reply(action, false, "blocked", { code: "COMPUTER_USE_CLOSED" });
    if (owner !== this.owner) { this.owner = owner; this.snapshot = null; this.duplicateHash = ""; this.duplicateStreak = 0; }
    const parsed = computerActionSchema.safeParse(raw);
    if (!parsed.success) return reply(action, false, "blocked", { code: "INVALID_COMPUTER_ACTION" });
    const args = parsed.data;
    const input = !OBSERVATION_ACTIONS.has(action);
    if (args.delivery_mode === "foreground") return reply(action, false, "blocked", { code: "FOREGROUND_DISABLED" });
    if (action === "key" && isBlockedComputerKey(normalizeComputerKeys(args.keys ?? ""))) return reply(action, false, "blocked", { code: "KEY_BLOCKED" });
    let dispatched = false;
    try {
      if (signal?.aborted) throw new Refusal("COMPUTER_USE_CANCELED");
      if (action === "capture") this.snapshot = null;
      const target = input ? this.inputArguments(args) : {};
      await this.options.driver.connect();
      if (this.closed) { await this.options.driver.close(); throw new Refusal("COMPUTER_USE_CLOSED"); }
      if (signal?.aborted) throw new Refusal("COMPUTER_USE_CANCELED");
      if (input && this.snapshot?.driverGeneration !== this.options.driver.generation) {
        this.snapshot = null;
        throw new Refusal("CAPTURE_REQUIRED");
      }
      if (action === "list_windows") {
        const result = await this.options.driver.call("list_windows", {}, signal);
        if (result.isError) throw new Refusal("DRIVER_REJECTED");
        const data = payload(result);
        return reply(action, true, "observed", { data: { windows: Array.isArray(data.windows) ? data.windows.slice(0, 100) : [], trust: "untrusted_desktop_data" } });
      }
      if (action === "capture") return await this.capture(args, signal);
      const tool = action === "type" ? "type_text" : action === "key" ? (Array.isArray(target.keys) && target.keys.length > 1 ? "hotkey" : "press_key") : ["right_click", "middle_click"].includes(action) ? "click" : action;
      this.snapshot = null; // Consume before sending: ambiguous outcomes must not reuse it.
      dispatched = true;
      const result = await this.options.driver.call(tool, target, signal);
      const data = payload(result);
      const unavailable = data.code === "background_unavailable" || data.reason_code === "background_unavailable" || data.verdict === "background_unavailable";
      const ok = !result.isError && data.ok !== false && !unavailable;
      const verdict = unavailable ? "background_unavailable" : !ok ? "error" : data.verdict === "confirmed" || data.verified === true ? "confirmed" : "unverifiable";
      return reply(action, ok, verdict, { next: "capture", ...(unavailable ? { code: "BACKGROUND_UNAVAILABLE" } : data.code === "CAPABILITY_UNSUPPORTED" ? { code: "CAPABILITY_UNSUPPORTED" } : {}) });
    } catch (error) {
      if (error instanceof Refusal) return reply(action, false, "blocked", { code: error.code });
      this.snapshot = null;
      await this.options.driver.close().catch(() => undefined);
      return reply(action, false, input && dispatched ? "unknown_outcome" : "error", { code: input && dispatched ? "TRANSPORT_OUTCOME_UNKNOWN" : "DRIVER_UNAVAILABLE", next: "capture" });
    }
  }

  private inputArguments(args: ComputerAction): Record<string, unknown> {
    const s = this.snapshot;
    if (!s) throw new Refusal("CAPTURE_REQUIRED");
    if (args.snapshot_id !== s.id) throw new Refusal("STALE_SNAPSHOT");
    if ((args.pid !== undefined && args.pid !== s.pid) || (args.window_id !== undefined && String(args.window_id) !== String(s.window))) throw new Refusal("TARGET_MISMATCH");
    if (!s.nativeId) throw new Refusal("NATIVE_SNAPSHOT_REQUIRED");
    const result: Record<string, unknown> = { pid: s.pid, window_id: s.window, ...(s.nativeId ? { snapshot_id: s.nativeId } : {}) };
    const element = () => {
      if (args.element === undefined || !s.elements.has(args.element)) throw new Refusal("ELEMENT_NOT_IN_SNAPSHOT");
      result.element_index = args.element;
    };
    if (["click", "double_click", "right_click", "middle_click", "scroll"].includes(args.action)) {
      if (args.element !== undefined) element();
      else if (args.x !== undefined && args.y !== undefined && s.width && s.height && args.x < s.width && args.y < s.height) {
        result.x = args.x; result.y = args.y;
      } else throw new Refusal("ELEMENT_REQUIRED");
      if (args.action === "scroll") {
        if (!args.direction) throw new Refusal("DIRECTION_REQUIRED");
        result.direction = args.direction; result.amount = args.amount ?? 3;
      } else if (args.action !== "double_click") result.button = args.action === "right_click" ? "right" : args.action === "middle_click" ? "middle" : "left";
    } else if (args.action === "type" || args.action === "set_value") {
      element();
      const value = args.action === "type" ? args.text : args.value;
      if (value === undefined) throw new Refusal("TEXT_REQUIRED");
      result[args.action === "type" ? "text" : "value"] = value;
    } else if (args.action === "key") {
      const keys = normalizeComputerKeys(args.keys ?? "");
      if (!keys.length) throw new Refusal("KEY_REQUIRED");
      if (keys.length > 1) result.keys = keys; else result.key = keys[0];
    }
    if (args.action !== "set_value") result.delivery_mode = "background";
    return result;
  }

  private async capture(args: ComputerAction, signal?: AbortSignal): Promise<ToolResult> {
    if (!args.pid || args.window_id === undefined) throw new Refusal("EXACT_TARGET_REQUIRED");
    const window = Number(args.window_id);
    if (!Number.isSafeInteger(window) || window < 1) throw new Refusal("INVALID_WINDOW_ID");
    const result = await this.options.driver.call("get_window_state", { pid: args.pid, window_id: window, max_elements: args.max_elements ?? 100 }, signal);
    const data = payload(result);
    if (result.isError || data.ok === false) throw new Refusal("CAPTURE_FAILED");
    if ((data.pid !== undefined && data.pid !== args.pid) || (data.window_id !== undefined && String(data.window_id) !== String(args.window_id))) throw new Refusal("TARGET_MISMATCH");
    const rawElements = Array.isArray(data.elements) ? data.elements : [];
    const elements = rawElements.slice(0, args.max_elements ?? 100).flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const e = item as Record<string, unknown>;
      const index = e.element_index ?? e.index;
      return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
        ? [{ index, role: String(e.role ?? "").slice(0, 100), label: String(e.label ?? "").slice(0, 500), enabled: e.enabled !== false }] : [];
    });
    const image = result.content?.find(p => p.type === "image");
    const b64 = image?.data ?? (typeof data.screenshot_png_b64 === "string" ? data.screenshot_png_b64 : undefined);
    let screenshot: Record<string, unknown> = {};
    let dimensions: { width: number; height: number } | undefined;
    if (b64) {
      if (b64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Refusal("INVALID_SCREENSHOT");
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Refusal("INVALID_SCREENSHOT");
      // Native 0.21 uses screenshot_*; coordinates are in this PNG's pixel space,
      // not desktop bounds. Do not authorize pixels from metadata alone.
      const width = data.screenshot_width ?? data.width;
      const height = data.screenshot_height ?? data.height;
      if (typeof width === "number" && Number.isSafeInteger(width) && width > 0 && width <= 100_000 &&
          typeof height === "number" && Number.isSafeInteger(height) && height > 0 && height <= 100_000 &&
          bytes.length >= 24 && bytes.toString("ascii", 12, 16) === "IHDR" &&
          bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height) {
        dimensions = { width, height };
      }
      const hash = createHash("sha256").update(`${args.pid}:${args.window_id}:`).update(bytes).digest("hex");
      if (hash === this.duplicateHash && this.duplicateStreak < 2) { this.duplicateStreak++; screenshot = { screenshot_omitted: true }; }
      else { this.duplicateStreak = 0; screenshot = { screenshot: await this.artifacts.put(bytes, "image/png") }; }
      this.duplicateHash = hash;
    }
    const snapshot: Snapshot = { id: randomUUID(), pid: args.pid, window,
      driverGeneration: this.options.driver.generation,
      ...(typeof data.snapshot_id === "string" ? { nativeId: data.snapshot_id } : {}),
      elements: new Set(elements.filter(e => e.enabled).map(e => e.index)),
      ...dimensions,
    };
    if (this.closed) throw new Refusal("COMPUTER_USE_CLOSED");
    this.snapshot = snapshot;
    const elementInput = Boolean(snapshot.nativeId && snapshot.elements.size);
    const coordinateInput = Boolean(snapshot.nativeId && dimensions);
    return reply("capture", true, "observed", { snapshot_id: snapshot.id, pid: snapshot.pid, window_id: snapshot.window, data: {
      elements, ...screenshot,
      ...(dimensions ? { screenshot_width: dimensions.width, screenshot_height: dimensions.height } : {}),
      input_available: elementInput || coordinateInput,
      element_input_available: elementInput, coordinate_input_available: coordinateInput,
      degraded: data.degraded === true || elements.length === 0,
      ...(typeof data.degraded_reason === "string" ? { degraded_reason: data.degraded_reason.slice(0, 1000) } : {}),
      ...(typeof data.elements_complete === "boolean" ? { elements_complete: data.elements_complete } : {}),
      next: elementInput ? "use_current_element_then_capture" : coordinateInput ? "inspect_local_screenshot_before_pixel_input_or_stop" : "stop_no_supported_input_target",
      trust: "untrusted_desktop_data",
    } });
  }
}
