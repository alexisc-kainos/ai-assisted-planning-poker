import { AvatarArt } from './avatars';

export function Mascot({ className = 'mascot' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 180" aria-hidden="true" focusable="false">
      <rect width={320} height={180} rx={18} fill="#e4ece6" />
      <path d="M0 120 Q60 80 120 104 T240 92 T320 100 V180 H0Z" fill="#cfdcd3" />
      <path d="M30 150 V96 M38 150 V104 M46 150 V90" stroke="#7f9c8c" strokeWidth={3} strokeLinecap="round" />
      <ellipse cx={160} cy={138} rx={122} ry={30} fill="#b9d3cc" />
      <ellipse cx={160} cy={138} rx={112} ry={24} fill="#8fbfb6" />
      <g transform="translate(110 40) scale(1.5625)">
        <AvatarArt id="capybara" />
      </g>
      <ellipse cx={160} cy={148} rx={114} ry={20} fill="#8fbfb6" opacity={0.96} />
      <path
        d="M96 140 Q120 134 144 140 M176 144 Q200 138 224 144"
        stroke="#e4ece6"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
      />
      <circle cx={160} cy={57} r={9} fill="#f2c14e" />
      <path d="M160 48 q6 -6 10 -2 q-5 4 -10 2Z" fill="#7f9c8c" />
      <path
        d="M120 70 q-8 -10 0 -20 q8 -10 0 -20 M200 70 q8 -10 0 -20 q-8 -10 0 -20"
        stroke="#ffffff"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        opacity={0.85}
      />
      <path d="M268 160 V122 M276 160 V124 l6 -8" stroke="#2d3a3a" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <g transform="translate(236 66) scale(0.96875)">
        <AvatarArt id="stork" />
      </g>
    </svg>
  );
}
