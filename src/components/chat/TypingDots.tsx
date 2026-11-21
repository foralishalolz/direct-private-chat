export function TypingDots() {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="typing-dot size-1.5 rounded-full bg-[var(--accent)]"
        />
      ))}
    </span>
  );
}
