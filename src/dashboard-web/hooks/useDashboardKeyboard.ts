import { useEffect, type RefObject } from "react";

interface KeyboardOptions {
  searchRef: RefObject<HTMLInputElement | null>;
  detailOpen: boolean;
  search: string;
  hasFilters: boolean;
  onCloseDetail: () => void;
  onClearSearch: () => void;
  onResetFilters: () => void;
}

/** One ordered escape chain shared by the page, drawer and filters. */
export function useDashboardKeyboard({
  searchRef,
  detailOpen,
  search,
  hasFilters,
  onCloseDetail,
  onClearSearch,
  onResetFilters,
}: KeyboardOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;

      if (
        event.key === "/"
        && !editing
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (event.key !== "Escape") return;
      if (detailOpen) {
        event.preventDefault();
        onCloseDetail();
      } else if (search) {
        event.preventDefault();
        onClearSearch();
      } else if (hasFilters) {
        event.preventDefault();
        onResetFilters();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    detailOpen,
    hasFilters,
    onClearSearch,
    onCloseDetail,
    onResetFilters,
    search,
    searchRef,
  ]);
}