import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DashboardTask } from "../../dashboard/types";
import {
  KIND_FILTERS,
  STATUS_FILTERS,
  hasActiveFilters,
  matchesTaskKey,
  taskKey,
  type DashboardFilters,
} from "../model";
import { EmptyState, TaskListSkeleton } from "./Feedback";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";

interface TaskExplorerProps {
  tasks: readonly DashboardTask[];
  selectedKey: string | null;
  hasSnapshot: boolean;
  snapshotError: string;
  refreshing: boolean;
  filters: DashboardFilters;
  searchRef: RefObject<HTMLInputElement | null>;
  onFiltersChange: (filters: DashboardFilters) => void;
  onResetFilters: () => void;
  onSelectTask: (task: DashboardTask, trigger: HTMLButtonElement) => void;
  onRefresh: () => void;
}

export function TaskExplorer({
  tasks,
  selectedKey,
  hasSnapshot,
  snapshotError,
  refreshing,
  filters,
  searchRef,
  onFiltersChange,
  onResetFilters,
  onSelectTask,
  onRefresh,
}: TaskExplorerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => tasks.map(taskKey), [tasks]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const filtered = hasActiveFilters(filters);

  useEffect(() => {
    if (!keys.length) {
      setActiveKey(null);
      return;
    }
    if (activeKey && keys.includes(activeKey)) return;
    setActiveKey(selectedKey && keys.includes(selectedKey) ? selectedKey : keys[0]);
  }, [activeKey, keys, selectedKey]);

  useEffect(() => {
    if (selectedKey && keys.includes(selectedKey)) setActiveKey(selectedKey);
  }, [keys, selectedKey]);

  const focusRow = (key: string) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-task-key]") ?? []
    );
    rows.find((row) => row.dataset.taskKey === key)?.focus();
  };

  const navigate = (event: React.KeyboardEvent<HTMLButtonElement>, task: DashboardTask) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tasks.findIndex((item) => matchesTaskKey(item, taskKey(task)));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tasks.length - 1
        : event.key === "ArrowDown"
          ? Math.min(index + 1, tasks.length - 1)
          : Math.max(index - 1, 0);
    const next = tasks[nextIndex];
    if (!next) return;
    const key = taskKey(next);
    setActiveKey(key);
    focusRow(key);
  };

  const resetFiltersAndFocus = () => {
    onResetFilters();
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const clearSearch = () => {
    onFiltersChange({ ...filters, search: "" });
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const hint = selectedKey
    ? "Esc 关闭详情 · ↑↓ 浏览任务 · / 聚焦搜索"
    : filtered
      ? "Esc 清除筛选 · ↑↓ 浏览任务 · / 聚焦搜索"
      : "↑↓ 浏览任务 · Enter 查看详情 · / 聚焦搜索";

  return (
    <section className="task-column" aria-labelledby="task-heading">
      <div className="section-heading">
        <div>
          <p>LIVE QUEUE</p>
          <h2 id="task-heading">任务队列</h2>
        </div>
        <span aria-live="polite">{tasks.length} 项</span>
      </div>

      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          id="task-search"
          type="search"
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          placeholder="搜索任务、会话或描述"
          aria-label="搜索任务"
          aria-keyshortcuts="/"
          aria-describedby="task-list-hint"
          autoComplete="off"
        />
        {filters.search && (
          <button className="search-clear" type="button" aria-label="清除搜索" onClick={clearSearch}>
            <Icon name="close" size={14} />
          </button>
        )}
        <kbd aria-hidden="true">/</kbd>
      </div>

      <div className="filters">
        <div className="filter-group" role="group" aria-label="任务类型">
          {KIND_FILTERS.map(([value, label]) => (
            <button
              type="button"
              className={filters.kind === value ? "active" : ""}
              data-filter-kind={value}
              aria-pressed={filters.kind === value}
              onClick={() => onFiltersChange({ ...filters, kind: value })}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="filter-divider" aria-hidden="true" />
        <div className="filter-group" role="group" aria-label="任务状态">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              type="button"
              className={filters.status === value ? "active" : ""}
              data-filter-status={value}
              aria-pressed={filters.status === value}
              onClick={() => onFiltersChange({ ...filters, status: value })}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {hasSnapshot && snapshotError && (
        <div className="sync-warning" role="alert">
          <span>同步失败，正在显示上次数据：{snapshotError}</span>
          <button type="button" onClick={onRefresh}>重试</button>
        </div>
      )}

      <div
        ref={listRef}
        id="task-list"
        className="task-list"
        aria-busy={!hasSnapshot || refreshing}
        aria-describedby="task-list-hint"
      >
        {!hasSnapshot && snapshotError ? (
          <EmptyState
            error
            title="无法连接本地运行时"
            description={snapshotError}
            actionLabel="重新连接"
            onAction={onRefresh}
          />
        ) : !hasSnapshot ? (
          <TaskListSkeleton />
        ) : tasks.length === 0 ? (
          filtered ? (
            <EmptyState
              title="没有匹配的任务"
              description="尝试更换关键词，或清除类型与状态筛选。"
              actionLabel="清除筛选"
              onAction={resetFiltersAndFocus}
            />
          ) : (
            <EmptyState
              title="任务队列还是空的"
              description="可在 TUI 使用 /mission 或 /loop 创建任务，新的运行状态会自动出现在这里。"
            />
          )
        ) : tasks.map((task) => {
          const key = taskKey(task);
          return (
            <TaskRow
              key={key}
              task={task}
              selected={selectedKey === key}
              tabIndex={(activeKey ?? keys[0]) === key ? 0 : -1}
              onSelect={onSelectTask}
              onNavigate={navigate}
              onFocus={(focused) => setActiveKey(taskKey(focused))}
            />
          );
        })}
      </div>

      <p id="task-list-hint" className="list-hint">{hint}</p>
    </section>
  );
}