export function WorkbenchTitle({
  title = '排产计划工作台',
  english,
  as: Heading = 'h1',
  id,
}: {
  title?: string;
  english?: string;
  as?: 'h1' | 'h2';
  id?: string;
}) {
  return (
    <Heading id={id} className="workbench-title">
      <span className="workbench-logo" aria-hidden="true">
        <span className="workbench-monogram-s">S</span>
        <span className="workbench-monogram-c">C</span>
      </span>
      <span className={english ? 'workbench-title-bilingual' : undefined}>
        <span>{title}</span>
        {english && <small lang="en">{english}</small>}
      </span>
    </Heading>
  );
}
