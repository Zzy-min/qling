// ============================================================
// 有界工具调度：只读并发，写入形成屏障
// 对照 Grok tool_calls.rs：资源冲突先声明，再决定并发
// ============================================================

export interface SchedulableTool<T> {
  value: T;
  readOnly: boolean;
  concurrencySafe: boolean;
  sideEffect: string;
}

export interface ToolScheduleOptions {
  /** 只读并发上限，默认 4。 */
  limit?: number;
}

/**
 * 保持原始调用顺序返回结果；只读且可并发的调用成组并行，
 * 其它调用（写、网络、进程、不可并发）各自成为屏障并顺序执行。
 */
export async function runBoundedToolBatch<T, R>(
  items: SchedulableTool<T>[],
  run: (item: T, index: number) => Promise<R>,
  options: ToolScheduleOptions = {}
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? 4));
  const results = new Array<R>(items.length);
  let group: number[] = [];

  const flush = async (): Promise<void> => {
    if (group.length === 0) return;
    const batch = group;
    group = [];
    for (let offset = 0; offset < batch.length; offset += limit) {
      const slice = batch.slice(offset, offset + limit);
      await Promise.all(
        slice.map(async (index) => {
          results[index] = await run(items[index]!.value, index);
        })
      );
    }
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.readOnly && item.concurrencySafe && item.sideEffect === "none") {
      group.push(index);
      if (group.length >= limit) await flush();
      continue;
    }
    await flush();
    results[index] = await run(item.value, index);
  }
  await flush();
  return results;
}
