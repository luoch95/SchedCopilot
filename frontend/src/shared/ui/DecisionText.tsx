import { useBusinessText } from '../lib/BusinessLabelProvider';

/** Emphasize explicit conclusions without changing the underlying evidence text. */
export function DecisionText({ text }: { text: string }) {
  const format = useBusinessText();
  return format(text)
    .split(/((?:因此|所以)[^。！？]*[。！？]?)/g)
    .map((part, index) =>
      index % 2 ? (
        <strong className="decision-conclusion" key={index}>
          {part}
        </strong>
      ) : (
        part
      ),
    );
}
