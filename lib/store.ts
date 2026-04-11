"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(load().items);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save({ items });
  }, [items, hydrated]);

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

  return { items, hydrated, addImage, updateItem, removeItem, bringToFront, clear };
}
