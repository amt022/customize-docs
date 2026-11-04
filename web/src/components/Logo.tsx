/** FormEasy mark: a form sheet with a folded corner and a green tick, on a blue-to-violet tile. */
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="fe-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="FormEasy" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fe-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a7bff" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="fe-ok" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#fe-tile)" />
      <path d="M20 12h16l11 11v25a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="#fff" />
      <path d="M36 12v8a3 3 0 0 0 3 3h8z" fill="#c7d4ff" />
      <rect x="22" y="29" width="15" height="3.2" rx="1.6" fill="#b9c6f0" />
      <rect x="22" y="36" width="10" height="3.2" rx="1.6" fill="#b9c6f0" />
      <circle cx="44" cy="44" r="11.5" fill="url(#fe-ok)" stroke="#fff" strokeWidth="3" />
      <path d="M38.6 44.6l4 4 7.2-8.2" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
