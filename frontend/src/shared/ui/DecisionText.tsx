/** Emphasize explicit conclusions without changing the underlying evidence text. */
export function DecisionText({ text }: { text: string }) {
  return text.split(/((?:因此|所以)[^。！？]*[。！？]?)/g).map((part, index) =>
    index % 2 ? (
      <strong className="decision-conclusion" key={index}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}
