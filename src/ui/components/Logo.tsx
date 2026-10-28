/** The agora mark: five seats of an assembly around the floor. */
import type { JSX } from "preact";

export const SEATS: [number, number][] = [
  [7.5, 19],
  [10.2, 12.2],
  [16, 9.2],
  [21.8, 12.2],
  [24.5, 19],
];

export function Logo(props: { size?: number }): JSX.Element {
  const size = props.size ?? 28;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="logo">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      {SEATS.map(([cx, cy]) => (
        <circle cx={cx} cy={cy} r="2.3" fill="var(--on-accent)" />
      ))}
      <path d="M10 24h12" stroke="var(--on-accent)" stroke-width="2.2" stroke-linecap="round" />
    </svg>
  );
}
