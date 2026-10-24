import { productionConditionLimitation } from '../lib/productionConditions';
import { useBusinessText } from '../lib/BusinessLabelProvider';

/** Keep opaque evidence identifiers available on hover, outside business prose. */
export function EvidenceText({ text }: { text: string }) {
  const format = useBusinessText();
  return format(productionConditionLimitation(text))
    .split(/(\b[a-z][a-z0-9_-]*:[a-f0-9]{12,}(?:[:/][a-zA-Z0-9_-]+)*\b)/gi)
    .map((part, index) =>
      index % 2 ? (
        <span key={index} title={part} className="evidence-reference" tabIndex={0}>
          关联证据
        </span>
      ) : (
        part
      ),
    );
}

/** Emphasize explicit conclusions without changing the underlying evidence text. */
export function DecisionText({ text }: { text: string }) {
  const format = useBusinessText();
  return format(productionConditionLimitation(text))
    .split(/((?:因此|所以)[^。！？]*[。！？]?)/g)
    .map((part, index) =>
      index % 2 ? (
        <strong className="decision-conclusion" key={index}>
          <EvidenceText text={part} />
        </strong>
      ) : (
        <EvidenceText text={part} key={index} />
      ),
    );
}
