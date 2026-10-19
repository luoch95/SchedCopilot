export function WaitingResult() {
  return (
    <span className="waiting-result">
      等待结果中
      <span className="waiting-dots" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} style={{ animationDelay: `${index * 0.16}s` }}>
            .
          </span>
        ))}
      </span>
    </span>
  );
}
