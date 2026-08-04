import { useEffect, useRef } from "react";
import { recordNinoExposure } from "@/lib/nino/intelligence";

const sent = new Set<string>();

/**
 * Registra exposição apenas quando o card fica realmente visível,
 * com deduplicação por sessão (item + superfície).
 */
export function useNinoExposure(
  itemId: string | null | undefined,
  surface: string,
  rank?: number,
  reason?: string,
) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!itemId || !node) return;
    const key = `${itemId}:${surface}`;
    if (sent.has(key)) return;

    if (typeof IntersectionObserver === "undefined") {
      sent.add(key);
      void recordNinoExposure(itemId, surface, rank, reason);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !sent.has(key)) {
            sent.add(key);
            void recordNinoExposure(itemId, surface, rank, reason);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [itemId, surface, rank, reason]);

  return ref;
}
