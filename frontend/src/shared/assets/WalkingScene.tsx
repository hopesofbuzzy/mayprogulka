import { useId } from 'react';

// Decorative city-and-forest scene, reconstructed as local vectors from the approved reference.
export function WalkingScene() {
  const clip = useId();
  return (
    <svg viewBox="0 0 500 470" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}><path d="M0 470V250C0 112 112 0 250 0S500 112 500 250V470Z" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path fill="#c4e7eb" d="M0 0h500v470H0z" />
        <circle cx="371" cy="113" r="46" fill="#ffd274" />
        <path d="M40 77c-13-4-7-16 4-17 0-18 26-21 35-10 11-8 29 3 27 15 22 16-40 25-66 12Z" fill="#f6f5e8" />
        <path d="M437 140c-19-2-15-12-3-14 0-13 14-19 22-12 10-12 26-7 28 5 18 0 21 15 6 20-13 5-39 5-53 1Z" fill="#f6f5e8" />
        <path d="M0 292h500v178H0z" fill="#97c6ae" />
        <g>
          <rect x="24" y="194" width="83" height="119" rx="5" fill="#e8a88b" />
          <rect x="106" y="147" width="75" height="166" rx="5" fill="#d68b76" />
          <path d="M49 209v104m30-132v132m52-151v151m31-151v151" stroke="#f8d6ba" strokeWidth="4" />
          <g transform="rotate(-7 100 203)" fill="#fff" fontFamily="Roboto, Arial, sans-serif" fontWeight="900">
            <text x="51" y="201" fontSize="40" fill="#eb704c">МАЙ</text>
            <text x="49" y="198" fontSize="40">МАЙ</text>
            <text x="51" y="227" fontSize="15" letterSpacing="1">ПРОГУЛКА</text>
          </g>
          <path d="M390 222h65v92h-65z" fill="#efb28d" />
          <path d="M402 225v89m30-89v89" stroke="#ffdab2" strokeWidth="4" />
        </g>
        <path d="M0 357c102-64 209-87 331-41 85 29 113 23 169 29v125H0Z" fill="#7cad7b" />
        <path d="M55 470c100-97 218-98 445-60v60Z" fill="#347b56" />
        <g>
          <path d="M205 307v-41" stroke="#916e49" strokeWidth="8" />
          <path d="m205 191-28 91h56Z" fill="#267553" />
          <path d="m180 275 25-78 24 78" fill="#277a55" />
          <path d="M456 331v-67" stroke="#936b47" strokeWidth="10" />
          <path d="m456 192-36 105h72Z" fill="#247653" />
          <path d="m425 287 31-88 29 88" fill="#287a55" />
        </g>
        <path d="M41 437c68-40 129 13 210-12 74-24 83-121 117-211l109-29" stroke="#fcf4dc" strokeWidth="53" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M39 438c67-41 134 11 211-14 71-23 86-123 120-211l106-28" stroke="#ed7045" strokeWidth="8" strokeLinecap="round" strokeDasharray="1 17" />
        <circle cx="82" cy="414" r="20" fill="#d4c9a8" opacity=".4" transform="translate(0 3)" />
        <circle cx="82" cy="412" r="20" fill="#fa7047" stroke="#fff" strokeWidth="4" />
        <path d="m82 405 5 6-5 6-5-6 5-6Z" fill="#fff" />
        <circle cx="372" cy="192" r="20" fill="#32805b" stroke="#fff" strokeWidth="4" />
        <path d="m366 192 4 4 7-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
