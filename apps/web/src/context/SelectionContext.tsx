import { useMemo, useState, type ReactNode } from "react";
import type { Selection } from "@fundip/shared-types";
import { SelectionContext } from "./selection-context-internal";

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const value = useMemo(() => ({ selection, setSelection }), [selection]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
