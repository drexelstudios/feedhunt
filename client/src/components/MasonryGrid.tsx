import { useRef, useEffect, useState, useCallback, type ReactElement } from "react";

interface MasonryGridProps {
  columns: number;
  gap?: number;
  children: ReactElement[];
  className?: string;
}

/**
 * JS-based masonry layout that distributes items into the shortest column,
 * giving an even spread across all columns with tight vertical packing.
 *
 * Uses absolute positioning measured from real DOM heights, with a
 * ResizeObserver to re-layout when children change size (including
 * async content loads like feed items).
 */
export default function MasonryGrid({
  columns,
  gap = 16,
  children,
  className,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const layoutRef = useRef<() => void>();

  const layout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > [data-masonry-item]")
    );
    if (items.length === 0) {
      setContainerHeight(0);
      return;
    }

    const containerWidth = container.clientWidth;
    if (containerWidth === 0) return; // not mounted yet
    const colWidth = (containerWidth - gap * (columns - 1)) / columns;
    const colHeights = new Array(columns).fill(0);

    for (const item of items) {
      // Set width first so height measurement is accurate
      item.style.width = `${colWidth}px`;

      // Find shortest column
      const shortestCol = colHeights.indexOf(Math.min(...colHeights));
      const left = shortestCol * (colWidth + gap);
      const top = colHeights[shortestCol];

      item.style.left = `${left}px`;
      item.style.top = `${top}px`;

      const height = item.offsetHeight;
      colHeights[shortestCol] += height + gap;
    }

    setContainerHeight(Math.max(...colHeights) - gap);
  }, [columns, gap]);

  layoutRef.current = layout;

  // Re-layout on children or column count change
  useEffect(() => {
    layout();
  }, [layout, children]);

  // ResizeObserver — watches container AND all masonry items for size changes.
  // Uses a MutationObserver to pick up new/removed items dynamically.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => layoutRef.current?.());

    // Observe container for width changes
    ro.observe(container);

    // Observe all current items
    const observeItems = () => {
      const items = container.querySelectorAll<HTMLElement>(":scope > [data-masonry-item]");
      items.forEach((item) => ro.observe(item));
    };
    observeItems();

    // Watch for DOM mutations (new items added/removed) to re-observe
    const mo = new MutationObserver(() => {
      observeItems();
      layoutRef.current?.();
    });
    mo.observe(container, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", height: containerHeight || "auto" }}
    >
      {children.map((child) => (
        <div
          key={child.key}
          data-masonry-item
          style={{
            position: "absolute",
            transition: "left 200ms ease, top 200ms ease",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
