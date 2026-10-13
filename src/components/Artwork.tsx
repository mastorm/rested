export function Sigil({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 3 43 24 24 45 5 24Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M24 7 39 24 24 41 9 24Z" stroke="currentColor" strokeWidth=".5" opacity=".35" />
      <path d="M24 20c-4-3-8-3-12-2v13c4-1 8 0 12 3 4-3 8-4 12-3V18c-4-1-8-1-12 2Zm0 0v14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m24 10 1.2 3.8L29 15l-3.8 1.2L24 20l-1.2-3.8L19 15l3.8-1.2Z" fill="currentColor" />
    </svg>
  );
}

export function Landscape() {
  return (
    <svg className="landscape" viewBox="0 0 1000 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="mist" x2="0" y2="1"><stop stopColor="#8aabac" stopOpacity=".09"/><stop offset="1" stopColor="#8aabac" stopOpacity="0"/></linearGradient>
      </defs>
      <circle cx="802" cy="55" r="34" fill="#bbcaad" opacity=".04" />
      <circle cx="802" cy="55" r="26" fill="none" stroke="#c2b588" strokeWidth=".6" opacity=".14" />
      <path d="m0 188 125-100 70 61 106-108 118 132 115-105 129 133 96-82 73 61 96-109 72 110V250H0Z" fill="url(#mist)" />
      <path d="m212 173 89-132 118 132M274 78l27-37 34 39-21-8-13 7-14-10ZM761 162l67-91 72 110" fill="none" stroke="#89a3a4" strokeWidth=".7" opacity=".12" />
      <path d="M610 215v-61h11v-24h8v-18l8-19 8 19v18h8v24h12v61m-35-23v-22h15v22m-17-39h19m-21-18h23m-19-25h13" fill="none" stroke="#afbcaf" strokeWidth="1" opacity=".1" />
      <path d="m0 231 169-58 128 53 124-54 98 49 160-53 114 41 107-46 100 63v24H0Z" fill="#0b171c" opacity=".6" />
      {[460, 476, 490, 721, 735, 917, 936, 953].map((x, i) => <path key={x} d={`M${x} 250v-${37 + i % 3 * 12}m0 6-10 17h20m-10-12-15 22h30`} fill="none" stroke="#09151a" strokeWidth="3" opacity=".65" />)}
    </svg>
  );
}
