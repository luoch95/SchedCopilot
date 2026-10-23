import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { businessText, type BusinessOperation } from './businessLabels';

const LabelsContext = createContext<(text: string) => string>((text) => text);

export function BusinessLabelProvider({
  operations,
  children,
}: {
  operations: BusinessOperation[];
  children: ReactNode;
}) {
  const format = useMemo(() => (text: string) => businessText(text, operations), [operations]);
  return <LabelsContext.Provider value={format}>{children}</LabelsContext.Provider>;
}

export const useBusinessText = () => useContext(LabelsContext);
