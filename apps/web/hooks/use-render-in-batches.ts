/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";

/**
 * A long list drawn a batch at a time: the first `batch` items, then the next batch each time the end of what's drawn
 * comes near the screen. The item at `keepIndex` is always drawn (the open project's entry, say), and everything
 * before it. Lists of hundreds of rich entries (the sidebar's projects: 650–1,300 per person) otherwise cost every
 * page load, and every click when the entries follow the route.
 *
 * Render `<div ref={endRef} />` after the items while `hasMore`.
 */
export const useRenderInBatches = <T>(items: T[], batch: number, keepIndex = -1) => {
  const [count, setCount] = useState(batch);
  const shown = Math.min(items.length, Math.max(count, keepIndex + 1));
  const hasMore = shown < items.length;
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = endRef.current;
    if (!element || !hasMore) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount(shown + batch);
      },
      { rootMargin: "400px 0px" }
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [hasMore, shown, batch]);

  return { shownItems: items.slice(0, shown), hasMore, endRef };
};
