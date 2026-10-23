import { createContext, useContext, useState, type ReactNode } from 'react';

type Selection = { operationId: string | null; select: (operationId: string) => void };
const GanttSelectionContext = createContext<Selection | null>(null);

/** A comparison shares operation identity; unrelated charts keep their own scope. */
export function GanttSelectionProvider({ children }: { children: ReactNode }) {
  const parent = useContext(GanttSelectionContext);
  const [operationId, select] = useState<string | null>(null);
  if (parent) return children;
  return (
    <GanttSelectionContext.Provider value={{ operationId, select }}>
      {children}
    </GanttSelectionContext.Provider>
  );
}

export function useGanttSelection() {
  return useContext(GanttSelectionContext);
}
