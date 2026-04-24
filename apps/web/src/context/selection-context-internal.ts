import { createContext, useContext } from "react";
import type { Selection } from "@fundip/shared-types";

export interface SelectionContextValue {
  selection: Selection | null;
  setSelection: (selection: Selection | null) => void;
}

export const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
}
