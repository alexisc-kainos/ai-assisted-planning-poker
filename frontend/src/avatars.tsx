import type { ReactNode } from 'react';

export interface AvatarOption {
  id: string;
  label: string;
  art: ReactNode;
}

const INK = '#23302f';
const shape = { stroke: '#3a4a48', strokeWidth: 1.1, strokeLinejoin: 'round' as const };
const line = { fill: 'none', stroke: INK, strokeLinecap: 'round' as const };

const eyes = (cx1: number, cx2: number, cy: number, r = 2.4) => (
  <>
    <circle cx={cx1} cy={cy} r={r} fill={INK} />
    <circle cx={cx2} cy={cy} r={r} fill={INK} />
  </>
);

export const AVATARS: AvatarOption[] = [
  {
    id: 'capybara',
    label: 'Capybara',
    art: (
      <>
        <circle cx={19} cy={17} r={5} fill="#a8774f" {...shape} />
        <circle cx={45} cy={17} r={5} fill="#a8774f" {...shape} />
        <rect x={12} y={16} width={40} height={40} rx={17} fill="#c4915f" {...shape} />
        <rect x={20} y={36} width={24} height={15} rx={7} fill="#a8774f" {...shape} />
        <circle cx={27} cy={41} r={1.6} fill={INK} />
        <circle cx={37} cy={41} r={1.6} fill={INK} />
        {eyes(23, 41, 29, 2.5)}
      </>
    ),
  },
  {
    id: 'stork',
    label: 'Stork',
    art: (
      <>
        <path d="M12 60 Q30 40 50 60Z" fill="#2b2b33" {...shape} />
        <circle cx={30} cy={30} r={16} fill="#ffffff" {...shape} />
        <path d="M43 27 L62 38 L43 34Z" fill="#e8643c" {...shape} />
        <circle cx={35} cy={26} r={2.5} fill={INK} />
        <path d="M18 18 Q22 12 28 14" strokeWidth={1.6} {...line} />
      </>
    ),
  },
  {
    id: 'penguin',
    label: 'Penguin',
    art: (
      <>
        <ellipse cx={32} cy={34} rx={21} ry={23} fill="#2f3446" {...shape} />
        <path d="M18 38 Q18 22 32 27 Q46 22 46 38 Q46 52 32 53 Q18 52 18 38Z" fill="#ffffff" {...shape} />
        {eyes(26, 38, 35)}
        <path d="M28 41 L36 41 L32 46Z" fill="#f2a33a" {...shape} />
      </>
    ),
  },
  {
    id: 'cat',
    label: 'Cat',
    art: (
      <>
        <path d="M13 28 L17 8 L30 20Z" fill="#9aa0ad" {...shape} />
        <path d="M51 28 L47 8 L34 20Z" fill="#9aa0ad" {...shape} />
        <circle cx={32} cy={36} r={19} fill="#9aa0ad" {...shape} />
        <path d="M18 22 L19 14 L25 20Z" fill="#f2b8c6" />
        <path d="M46 22 L45 14 L39 20Z" fill="#f2b8c6" />
        {eyes(25, 39, 34)}
        <path d="M29.5 40 L34.5 40 L32 43Z" fill="#e88a9a" />
        <path d="M10 41 L22 42 M10 46 L22 45 M54 41 L42 42 M54 46 L42 45" strokeWidth={1.2} {...line} />
      </>
    ),
  },
  {
    id: 'dog',
    label: 'Dog',
    art: (
      <>
        <ellipse cx={13} cy={30} rx={7} ry={14} transform="rotate(15 13 30)" fill="#8a6142" {...shape} />
        <ellipse cx={51} cy={30} rx={7} ry={14} transform="rotate(-15 51 30)" fill="#8a6142" {...shape} />
        <circle cx={32} cy={34} r={19} fill="#d9b88f" {...shape} />
        <ellipse cx={32} cy={43} rx={10} ry={8} fill="#f3e3cc" {...shape} />
        {eyes(25, 39, 31)}
        <ellipse cx={32} cy={39.5} rx={3.6} ry={2.6} fill={INK} />
      </>
    ),
  },
  {
    id: 'fox',
    label: 'Fox',
    art: (
      <>
        <path d="M11 26 L14 6 L27 18Z" fill="#e07a3a" {...shape} />
        <path d="M53 26 L50 6 L37 18Z" fill="#e07a3a" {...shape} />
        <path d="M8 24 Q32 10 56 24 L32 56Z" fill="#e07a3a" {...shape} />
        <path d="M10 26 L32 56 L24 34Z" fill="#fff4ea" {...shape} />
        <path d="M54 26 L32 56 L40 34Z" fill="#fff4ea" {...shape} />
        {eyes(24, 40, 29)}
        <circle cx={32} cy={51} r={2.6} fill={INK} />
      </>
    ),
  },
  {
    id: 'frog',
    label: 'Frog',
    art: (
      <>
        <circle cx={20} cy={22} r={9} fill="#6fb35a" {...shape} />
        <circle cx={44} cy={22} r={9} fill="#6fb35a" {...shape} />
        <ellipse cx={32} cy={40} rx={25} ry={17} fill="#6fb35a" {...shape} />
        <circle cx={20} cy={22} r={5} fill="#ffffff" {...shape} />
        <circle cx={44} cy={22} r={5} fill="#ffffff" {...shape} />
        {eyes(20, 44, 22)}
        <path d="M22 44 Q32 51 42 44" strokeWidth={2} {...line} />
      </>
    ),
  },
  {
    id: 'bunny',
    label: 'Bunny',
    art: (
      <>
        <ellipse cx={23} cy={16} rx={6} ry={15} fill="#ece7df" {...shape} />
        <ellipse cx={41} cy={16} rx={6} ry={15} fill="#ece7df" {...shape} />
        <ellipse cx={23} cy={17} rx={2.6} ry={10} fill="#f2b8c6" />
        <ellipse cx={41} cy={17} rx={2.6} ry={10} fill="#f2b8c6" />
        <circle cx={32} cy={40} r={18} fill="#ece7df" {...shape} />
        {eyes(25, 39, 38)}
        <path d="M29.5 44 L34.5 44 L32 47Z" fill="#e88a9a" />
      </>
    ),
  },
];

const AVATARS_BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

export function AvatarArt({ id }: { id: string }) {
  return <>{AVATARS_BY_ID.get(id)?.art}</>;
}

export function Avatar({ id, size = 48 }: { id?: string; size?: number }) {
  const avatar = id ? AVATARS_BY_ID.get(id) : undefined;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {avatar?.art ?? (
        <>
          <circle cx={32} cy={32} r={30} fill="#ece7dd" stroke="#6f7b79" strokeDasharray="4 3" />
          <text x={32} y={41} textAnchor="middle" fontSize={26} fill="#4f5d5b">
            ?
          </text>
        </>
      )}
    </svg>
  );
}
