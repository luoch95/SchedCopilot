import { useEffect, useState } from 'react';
import { workbenchApi } from './api';

type Analysis = Awaited<ReturnType<typeof workbenchApi.faultAnalysis>>;

export function useHistoricalFaultAnalysis(revision: number | undefined) {
  const [record, setRecord] = useState<{ revision: number; analysis: Analysis; error: string }>();
  useEffect(() => {
    if (revision === undefined) return;
    let cancelled = false;
    workbenchApi.faultAnalysis(revision).then(
      (analysis) => {
        if (!cancelled) setRecord({ revision, analysis, error: '' });
      },
      (error: unknown) => {
        if (!cancelled)
          setRecord({
            revision,
            analysis: null,
            error: error instanceof Error ? error.message : '历史分析加载失败',
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return {
    loading: revision !== undefined && record?.revision !== revision,
    analysis: record?.revision === revision ? record?.analysis : null,
    error: record?.revision === revision ? record?.error : '',
  };
}
