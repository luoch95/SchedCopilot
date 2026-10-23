import type { InsertionRequestRecord } from '../api/contracts';

const internalNumber =
  /(?:URG-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-OP\d+)?/gi;

/** Resolve real business numbers without changing IDs used by scheduling or API calls. */
export function orderLabel(
  text: string,
  requests: Pick<InsertionRequestRecord, 'id' | 'request_no'>[] = [],
) {
  const numbers = new Map(
    requests.map((request) => [request.id.toLowerCase(), request.request_no]),
  );
  return text.replace(internalNumber, (value) => {
    const id = value
      .replace(/^URG-/i, '')
      .replace(/-OP\d+$/i, '')
      .toLowerCase();
    const number = numbers.get(id);
    // Missing metadata must never expose a database ID or invent a request number.
    if (!number || new RegExp(internalNumber.source, 'i').test(number)) {
      return '单号待同步';
    }
    const operation = value.match(/-OP\d+$/i)?.[0] ?? '';
    return `${number}${operation}`;
  });
}
