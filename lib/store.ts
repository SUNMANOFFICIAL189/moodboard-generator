"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { BoardItem, ImageResult } from "./types";
import { uid } from "./utils";

const STORAGE_KEY = "moodboard:v1";
const HISTORY_CAP = 30;

interface BoardState {
  items: BoardItem[];
}

interface Snapshot {
  items: BoardItem[];
  rejected: BoardItem[];
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

  // Refs mirror state so callbacks read current values without re-binding,
  // and history snapshots can be taken synchronously.
  const itemsRef = useRef<BoardItem[]>([]);
  const rejectedRef = useRef<BoardItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    rejectedRef.current = rejected;
  }, [rejected]);

  // Undo / redo stacks. Bounded — old snapshots fall off the back.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  // Depth state so consumers can reactively disable Undo/Redo buttons.
  const [historyDepth, setHistoryDepth] = useState(0);
  const [futureDepth, setFutureDepth] = useState(0);

  function pushHistory() {
    past.current.push({
      items: itemsRef.current,
      rejected: rejectedRef.current,
    });
    if (past.current.length > HISTORY_CAP) past.current.shift();
    future.current = []; // any new action invalidates redo
    setHistoryDepth(past.current.length);
    setFutureDepth(0);
  }

  useEffect(() => {
    setItems(load().items);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save({ items });
  }, [items, hydrated]);

  // Rejected items are NOT persisted — they're a per-session soft-delete bin.

  const addImage = useCallback((image: ImageResult) => {
    pushHistory();
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
      if (placements.length === 0) return;
      pushHistory();
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

  // Continuous edits (drag/resize) — NOT snapshotted to avoid flooding
  // history. User can undo a discrete add/delete instead.
  const updateItem = useCallback((id: string, patch: Partial<BoardItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback((id: string) => {
    pushHistory();
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  // Bringing to front is high-frequency (every click). Not snapshotted.
  const bringToFront = useCallback((id: string) => {
    setItems(prev => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.z), 0);
      return prev.map(it => (it.id === id ? { ...it, z: maxZ + 1 } : it));
    });
  }, []);

  const clear = useCallback(() => {
    pushHistory();
    setItems([]);
  }, []);

  // ─── Refine: soft-reject items into a recoverable tray ────────────────────

  const rejectItems = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    pushHistory();
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
    pushHistory();
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

  const clearRejected = useCallback(() => {
    pushHistory();
    setRejected([]);
  }, []);

  // Combined refine action: reject discarded clusters AND rearrange remaining
  // items by the supplied positions, all in a single undoable snapshot.
  const applyRefineResult = useCallback(
    (
      rejectIds: string[],
      positions: Record<string, { x: number; y: number; width: number; height: number }>,
    ) => {
      pushHistory();
      const rejectSet = new Set(rejectIds);
      const current = itemsRef.current;
      const toReject = current.filter(it => rejectSet.has(it.id));
      const remaining = current.filter(it => !rejectSet.has(it.id));

      // Apply positions to whichever items have a placement; leave others as-is.
      const repositioned = remaining.map(it => {
        const p = positions[it.id];
        return p ? { ...it, x: p.x, y: p.y, width: p.width, height: p.height } : it;
      });
      setItems(repositioned);

      if (toReject.length > 0) {
        setRejected(prev => {
          const existing = new Set(prev.map(r => r.id));
          const fresh = toReject.filter(r => !existing.has(r.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    },
    [],
  );

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return false;
    future.current.push({
      items: itemsRef.current,
      rejected: rejectedRef.current,
    });
    if (future.current.length > HISTORY_CAP) future.current.shift();
    setItems(prev.items);
    setRejected(prev.rejected);
    setHistoryDepth(past.current.length);
    setFutureDepth(future.current.length);
    return true;
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return false;
    past.current.push({
      items: itemsRef.current,
      rejected: rejectedRef.current,
    });
    if (past.current.length > HISTORY_CAP) past.current.shift();
    setItems(next.items);
    setRejected(next.rejected);
    setHistoryDepth(past.current.length);
    setFutureDepth(future.current.length);
    return true;
  }, []);

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
    applyRefineResult,
    undo,
    redo,
    canUndo: historyDepth > 0,
    canRedo: futureDepth > 0,
  };
}
