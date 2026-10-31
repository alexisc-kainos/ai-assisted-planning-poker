import type { ReactNode } from 'react';

export interface AvatarOption {
  id: string;
  label: string;
  background: string;
  art: ReactNode;
}

const eyes = (y = 30, dx = 8, cx = 32) => (
  <>
    <circle cx={cx - dx} cy={y} r={2.6} fill="#3b3346" />
    <circle cx={cx + dx} cy={y} r={2.6} fill="#3b3346" />
  </>
);

const cheeks = (y = 37, dx = 13) => (
  <>
    <circle cx={32 - dx} cy={y} r={3} fill="#f7a8b8" opacity={0.6} />
    <circle cx={32 + dx} cy={y} r={3} fill="#f7a8b8" opacity={0.6} />
  </>
);

export const AVATARS: AvatarOption[] = [
  {
    id: 'capybara',
    label: 'Capybara',
    background: '#ffe5c4',
    art: (
      <>
        <circle cx={19} cy={17} r={5} fill="#a8774f" />
        <circle cx={45} cy={17} r={5} fill="#a8774f" />
        <rect x={13} y={16} width={38} height={36} rx={16} fill="#c4915f" />
        <rect x={20} y={34} width={24} height={15} rx={7} fill="#a8774f" />
        <circle cx={27} cy={39} r={1.6} fill="#3b3346" />
        <circle cx={37} cy={39} r={1.6} fill="#3b3346" />
        {eyes(28, 9)}
      </>
    ),
  },
  {
    id: 'stork',
    label: 'Stork',
    background: '#d6ecff',
    art: (
      <>
        <circle cx={30} cy={32} r={16} fill="#ffffff" stroke="#e1e6ef" strokeWidth={1.5} />
        <path d="M40 33 L58 38 L40 39 Z" fill="#f59e6b" />
        <circle cx={34} cy={28} r={2.6} fill="#3b3346" />
        <path d="M18 20 Q24 14 30 16" stroke="#3b3346" strokeWidth={2} fill="none" strokeLinecap="round" />
        <circle cx={24} cy={37} r={3} fill="#f7a8b8" opacity={0.6} />
      </>
    ),
  },
  {
    id: 'penguin',
    label: 'Penguin',
    background: '#d4f1f4',
    art: (
      <>
        <ellipse cx={32} cy={34} rx={19} ry={20} fill="#3d4a5c" />
        <ellipse cx={32} cy={38} rx={13} ry={14} fill="#ffffff" />
        {eyes(32, 6)}
        <path d="M28 37 L36 37 L32 42 Z" fill="#f7b267" />
        {cheeks(39, 10)}
      </>
    ),
  },
  {
    id: 'cat',
    label: 'Cat',
    background: '#fde2e4',
    art: (
      <>
        <path d="M15 26 L18 10 L28 20 Z" fill="#b9b4c7" />
        <path d="M49 26 L46 10 L36 20 Z" fill="#b9b4c7" />
        <circle cx={32} cy={34} r={18} fill="#cfcadc" />
        {eyes(31, 7)}
        <path d="M30 37 L34 37 L32 39.5 Z" fill="#f28ba8" />
        <path d="M14 36 L24 37 M14 41 L24 39 M50 36 L40 37 M50 41 L40 39" stroke="#8e879e" strokeWidth={1.2} />
      </>
    ),
  },
  {
    id: 'dog',
    label: 'Dog',
    background: '#fff1c1',
    art: (
      <>
        <ellipse cx={15} cy={30} rx={6} ry={12} fill="#a4785a" />
        <ellipse cx={49} cy={30} rx={6} ry={12} fill="#a4785a" />
        <circle cx={32} cy={33} r={17} fill="#d9b48f" />
        <ellipse cx={32} cy={40} rx={8} ry={6} fill="#f3e2cf" />
        {eyes(29, 7)}
        <ellipse cx={32} cy={37} rx={3.2} ry={2.4} fill="#3b3346" />
        <path d="M30 43 Q32 48 34 43 Z" fill="#f28ba8" />
      </>
    ),
  },
  {
    id: 'fox',
    label: 'Fox',
    background: '#ffd8be',
    art: (
      <>
        <path d="M14 28 L16 9 L29 20 Z" fill="#f08a4b" />
        <path d="M50 28 L48 9 L35 20 Z" fill="#f08a4b" />
        <path d="M12 26 Q32 12 52 26 L32 52 Z" fill="#f4a261" />
        <path d="M18 32 L32 52 L46 32 Q32 38 18 32 Z" fill="#ffffff" />
        {eyes(29, 8)}
        <circle cx={32} cy={46} r={2.4} fill="#3b3346" />
      </>
    ),
  },
  {
    id: 'frog',
    label: 'Frog',
    background: '#dcf5d6',
    art: (
      <>
        <circle cx={21} cy={22} r={8} fill="#8fd18a" />
        <circle cx={43} cy={22} r={8} fill="#8fd18a" />
        <ellipse cx={32} cy={37} rx={21} ry={15} fill="#8fd18a" />
        <circle cx={21} cy={22} r={4} fill="#ffffff" />
        <circle cx={43} cy={22} r={4} fill="#ffffff" />
        {eyes(22, 11)}
        <path d="M22 40 Q32 47 42 40" stroke="#3b3346" strokeWidth={2} fill="none" strokeLinecap="round" />
        {cheeks(38, 15)}
      </>
    ),
  },
  {
    id: 'bunny',
    label: 'Bunny',
    background: '#ece4ff',
    art: (
      <>
        <ellipse cx={24} cy={14} rx={5} ry={13} fill="#ffffff" stroke="#e5ddf5" />
        <ellipse cx={40} cy={14} rx={5} ry={13} fill="#ffffff" stroke="#e5ddf5" />
        <ellipse cx={24} cy={14} rx={2.4} ry={9} fill="#f7c6d4" />
        <ellipse cx={40} cy={14} rx={2.4} ry={9} fill="#f7c6d4" />
        <circle cx={32} cy={37} r={16} fill="#ffffff" stroke="#e5ddf5" />
        {eyes(34, 6)}
        <path d="M30 39 L34 39 L32 41.5 Z" fill="#f28ba8" />
        {cheeks(41, 10)}
      </>
    ),
  },
];

const AVATARS_BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

export function Avatar({ id, size = 48 }: { id?: string; size?: number }) {
  const avatar = id ? AVATARS_BY_ID.get(id) : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx={32} cy={32} r={32} fill={avatar?.background ?? '#eeeeee'} />
      {avatar?.art ?? (
        <text x={32} y={41} textAnchor="middle" fontSize={26} fill="#8e879e">
          ?
        </text>
      )}
    </svg>
  );
}
