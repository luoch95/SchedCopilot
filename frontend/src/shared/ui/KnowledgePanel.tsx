import type { KnowledgeReport } from '../api/contracts';
import { useBusinessText } from '../lib/BusinessLabelProvider';

export function KnowledgePanel({ report }: { report?: KnowledgeReport | null }) {
  const format = useBusinessText();
  if (!report) return null;
  return (
    <section className="knowledge-panel" aria-label="知识依据">
      <div className="knowledge-heading">
        <h3>知识依据</h3>
        <span className="tag">模拟演示资料</span>
      </div>
      <p className="hint">{report.message}</p>
      {report.status === 'matched' && (
        <>
          <p className="hint">资料提供规范与经验，不代表当前现场事实；数值以本次试排为准。</p>
          <ol className="knowledge-items">
            {report.items.map((item) => {
              const source = report.sources.find((entry) => entry.chunk_id === item.source_id);
              if (!source) return null;
              return (
                <li key={item.source_id}>
                  <p>{format(item.text)}</p>
                  {item.related_facts.length > 0 && (
                    <div className="knowledge-facts">
                      <strong>关联本次结果</strong>
                      <ul>
                        {item.related_facts.map((fact) => (
                          <li key={fact}>{format(fact)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details className="knowledge-source">
                    <summary>
                      查看原文 · {source.title} · v{source.version}
                    </summary>
                    <p className="hint">
                      {source.document_id} · {source.section} · {source.kind}
                    </p>
                    <blockquote>{source.excerpt}</blockquote>
                    <small className="hint">来源文件：{source.filename}</small>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
