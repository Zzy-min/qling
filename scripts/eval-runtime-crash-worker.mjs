import { RuntimeEventJournal } from "../dist/runtime/event-journal.js";

const [stateDir, sessionId] = process.argv.slice(2);
if (!stateDir || !sessionId) process.exit(2);
const journal = new RuntimeEventJournal({ stateDir, sessionId });
await journal.init();
await journal.recordToolCall({ toolCallId: "read-retryable", tool: "read", argumentsHash: "a", sideEffect: "none", idempotent: true, status: "running", startedAt: Date.now() });
await journal.recordToolCall({ toolCallId: "write-unknown", tool: "write", argumentsHash: "b", sideEffect: "workspace", idempotent: false, status: "running", startedAt: Date.now() });
await journal.append({ type: "crash_injected", payload: { worker: process.pid } });
process.exit(86);
