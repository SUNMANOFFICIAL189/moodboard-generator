"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { BoardItem, ImageResult } from "./types";
import { uid } from "./utils";

const STORAGE_KEY = "moodboard:v1";

interface BoardState {
  items: BoardItem[];
}

function load(): BoardState {
  if (typeof window === "undefined") return { items: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    return JSON.parse(raw) as BoardState;
  } catch {
    return { items: [] };
  }
}

function save(state: BoardState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useBoard() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [rejected, setRejected] = useState<BoardItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Ref mirror for reading latest state inside callbacks without re-binding.
  const itemsRef = useRef<BoardItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    setItems(load().items);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save({ items });
  }, [items, hydrated]);

  // Rejected items are NOT persisted — they're a per-session soft-delete bin.

  const addImage = useCallback((image: ImageResult) => {
    setItems(prev => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.z), 0);
      const aspect = image.width / image.height || 1;
      const w = 260;
      const h = Math.round(w / aspect);
      const item: BoardItem = {
        id: uid(),
        image,
        x: 120 + (prev.length % 6) * 40,
        y: 120 + (prev.length % 6) * 30,
        width: w,
        height: h,
        rotation: 0,
        z: maxZ + 1,
      };
      return [...prev, item];
    });
  }, []);

  // Batch placement with pre-computed positions (used by Mode A auto-layout
  // when files are dropped directly onto the canvas).
  const addImagesAt = useCallback(
    (
      placements: Array<{
        image: ImageResult;
        x: number;
        y: number;
        width: number;
        height: number;
      }>,
    ) => {
      setItems(prev => {
        const startZ = prev.reduce((m, it) => Math.max(m, it.z), 0);
        const newItems: BoardItem[] = placements.map((p, i) => ({
          id: uid(),
          image: p.image,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          rotation: 0,
          z: startZ + 1 + i,
        }));
        return [...prev, ...newItems];
      });
    },
    [],
  );

  const updateItem = useCallback((id: string, patch: Partial<BoardItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const bringToFront = useCallback((id: string) => {
    setItems(prev => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.z), 0);
      return prev.map(it => (it.id === id ? { ...it, z: maxZ + 1 } : it));
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // ─── Refine: soft-reject items into a recoverable tray ────────────────────

  const rejectItems = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const current = itemsRef.current;
    const toReject = current.filter(it => idSet.has(it.id));
    if (toReject.length === 0) return;
    setItems(current.filter(it => !idSet.has(it.id)));
    setRejected(prev => {
      const existing = new Set(prev.map(r => r.id));
      const fresh = toReject.filter(r => !existing.has(r.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  const restoreFromRejected = useCallback((id: string) => {
    setRejected(prev => {
      const found = prev.find(r => r.id === id);
      if (!found) return prev;
      setItems(its => {
        const maxZ = its.reduce((m, it) => Math.max(m, it.z), 0);
        return [...its, { ...found, z: maxZ + 1 }];
      });
      return prev.filter(r => r.id !== id);
    });
  }, []);

  const clearRejected = useCallback(() => setRejected([]), []);

  return {
    items,
    rejected,
    hydrated,
    addImage,
    addImagesAt,
    updateItem,
    removeItem,
    bringToFront,
    clear,
    rejectItems,
    restoreFromRejected,
    clearRejected,
  };
}
