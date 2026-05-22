"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

export interface SelectedCompound {
  id: string;
  name: string;
  smiles: string;
}

interface CompoundSelectionContextValue {
  selected: SelectedCompound[];
  selectedIds: Set<string>;
  addCompound: (c: SelectedCompound) => void;
  removeCompound: (id: string) => void;
  addMany: (compounds: SelectedCompound[]) => void;
  removeMany: (ids: string[]) => void;
  setSelected: (compounds: SelectedCompound[]) => void;
  clearAll: () => void;
}

const CompoundSelectionContext = createContext<CompoundSelectionContextValue>({
  selected: [],
  selectedIds: new Set(),
  addCompound: () => {},
  removeCompound: () => {},
  addMany: () => {},
  removeMany: () => {},
  setSelected: () => {},
  clearAll: () => {},
});

const STORAGE_KEY = "selectedCompounds";

function loadFromStorage(): SelectedCompound[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SelectedCompound[]) : [];
  } catch {
    return [];
  }
}

export function CompoundSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState<SelectedCompound[]>(() =>
    loadFromStorage()
  );

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  }, [selected]);

  const selectedIds = useMemo(() => new Set(selected.map((c) => c.id)), [selected]);

  const addCompound = useCallback((c: SelectedCompound) => {
    setSelectedState((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
  }, []);

  const removeCompound = useCallback((id: string) => {
    setSelectedState((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addMany = useCallback((compounds: SelectedCompound[]) => {
    setSelectedState((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const newOnes = compounds.filter((c) => !existingIds.has(c.id));
      return newOnes.length ? [...prev, ...newOnes] : prev;
    });
  }, []);

  const removeMany = useCallback((ids: string[]) => {
    const toRemove = new Set(ids);
    setSelectedState((prev) => prev.filter((c) => !toRemove.has(c.id)));
  }, []);

  const setSelected = useCallback((compounds: SelectedCompound[]) => {
    setSelectedState(compounds);
  }, []);

  const clearAll = useCallback(() => {
    setSelectedState([]);
  }, []);

  return (
    <CompoundSelectionContext.Provider
      value={{ selected, selectedIds, addCompound, removeCompound, addMany, removeMany, setSelected, clearAll }}
    >
      {children}
    </CompoundSelectionContext.Provider>
  );
}

export function useCompoundSelection() {
  return useContext(CompoundSelectionContext);
}
