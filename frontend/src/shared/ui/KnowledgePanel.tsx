import type { KnowledgeReport } from '../api/contracts';
import { useBusinessText } from '../lib/BusinessLabelProvider';

export function KnowledgePanel({ report }: { report?: KnowledgeReport | null }) {
  const format = useBusinessText();
  if (!report) return null;
  const sources =
    report.status === 'matched'
      ? report.sources.filter(
          (source, index, entries) =>
            entries.findIndex((entry) => entry.chunk_id === source.chunk_id) === index,
        )
      : [];
  const isHistory = (source: KnowledgeReport['sources'][number]) =>
    /历史(?:相似)?案例/.test(`${source.title} ${source.section}`);
  const groups = [
    { title: '参考规范', sources: sources.filter((source) => !isHistory(source)) },
    { title: '历史相似案例', sources: sources.filter(isHistory) },
  ];
  return (
    <section className="knowledge-panel" aria-label="知识依据">
      <details className="knowledge-disclosure">
        <summary className="knowledge-heading">
          <h3>
            <span className="analysis-focus-icon" aria-hidden="true">
              📖
            </span>
            参考规范与历史案例
            <span className="knowledge-count">
              （
              {report.status === 'unavailable' ? '检索暂不可用' : `已检索 ${sources.length} 条依据`}
              ）
            </span>
          </h3>
          <span className="knowledge-demo-tag">模拟演示资料</span>
        </summary>
        <div className="knowledge-content">
          <p className="hint">{report.message}</p>
          {report.status === 'matched' && (
            <>
              <p className="hint">资料提供规范与经验，不代表当前现场事实；数值以本次试排为准。</p>
              {groups
                .filter((group) => group.sources.length > 0)
                .map((group) => (
                  <section className="knowledge-group" key={group.title} aria-label={group.title}>
                    <h4>{group.title}</h4>
                    <div className="knowledge-cards">
                      {group.sources.map((source) => {
                        const item = report.items.find(
                          (entry) => entry.source_id === source.chunk_id,
                        );
                        return (
                          <article
                            className="knowledge-card"
                            key={source.chunk_id}
                            aria-label={source.title}
                          >
                            <strong className="knowledge-card-title">{source.title}</strong>
                            <p className="knowledge-file">
                              来源文件：<strong>《{source.filename}》</strong>
                            </p>
                            <p className="knowledge-passage-label">命中片段</p>
                            <blockquote className="knowledge-excerpt">{source.excerpt}</blockquote>
                            {item && <p className="knowledge-advice">{format(item.text)}</p>}
                            {!!item?.related_facts.length && (
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
                              <summary aria-label={`查看原文：${source.title}`}>查看原文</summary>
                              <div className="knowledge-source-content">
                                <p>
                                  <strong>原文引用片段</strong> · {source.title} · v{source.version}
                                </p>
                                <p className="hint">
                                  {source.document_id} · {source.section} · {source.kind}
                                </p>
                                <blockquote>{source.excerpt}</blockquote>
                                <p className="hint">来源文件：{source.filename}</p>
                                <p className="hint">片段编号：{source.chunk_id}</p>
                                <p className="hint">
                                  文件校验值（SHA-256）：{source.content_sha256}
                                </p>
                              </div>
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
