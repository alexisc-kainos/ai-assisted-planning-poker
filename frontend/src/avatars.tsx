import type { ReactNode } from 'react';
import capybara from './assets/avatars/capybara.jpg';
import stork from './assets/avatars/stork.jpg';
import penguin from './assets/avatars/penguin.jpg';
import cat from './assets/avatars/cat.jpg';
import dog from './assets/avatars/dog.jpg';
import fox from './assets/avatars/fox.jpg';
import owl from './assets/avatars/owl.jpg';
import mouse from './assets/avatars/mouse.jpg';
import sloth from './assets/avatars/sloth.jpg';
import tiger from './assets/avatars/tiger.jpg';
import chimpanzee from './assets/avatars/chimpanzee.jpg';
import elephant from './assets/avatars/elephant.jpg';
import lion from './assets/avatars/lion.jpg';
import zebra from './assets/avatars/zebra.jpg';
import koala from './assets/avatars/koala.jpg';
import panda from './assets/avatars/panda.jpg';
import giraffe from './assets/avatars/giraffe.jpg';
import redPanda from './assets/avatars/red-panda.jpg';
import woodlandFox from './assets/avatars/woodland-fox.jpg';
import bat from './assets/avatars/bat.jpg';

export interface AvatarOption {
  id: string;
  label: string;
  image?: string;
  art?: ReactNode;
}

export const AVATARS: AvatarOption[] = [
  { id: 'capybara', label: 'Capybara', image: capybara },
  { id: 'stork', label: 'Stork', image: stork },
  { id: 'penguin', label: 'Penguin', image: penguin },
  { id: 'cat', label: 'Cat', image: cat },
  { id: 'dog', label: 'Dog', image: dog },
  { id: 'fox', label: 'Fox', image: fox },
  { id: 'owl', label: 'Owl', image: owl },
  { id: 'mouse', label: 'Mouse', image: mouse },
  { id: 'sloth', label: 'Sloth', image: sloth },
  { id: 'tiger', label: 'Tiger', image: tiger },
  { id: 'chimpanzee', label: 'Chimpanzee', image: chimpanzee },
  { id: 'elephant', label: 'Elephant', image: elephant },
  { id: 'lion', label: 'Lion', image: lion },
  { id: 'zebra', label: 'Zebra', image: zebra },
  { id: 'koala', label: 'Koala', image: koala },
  { id: 'panda', label: 'Panda', image: panda },
  { id: 'giraffe', label: 'Giraffe', image: giraffe },
  { id: 'red-panda', label: 'Red panda', image: redPanda },
  { id: 'woodland-fox', label: 'Woodland fox', image: woodlandFox },
  { id: 'bat', label: 'Bat', image: bat },
];

const INK = '#23302f';
const shape = { stroke: '#3a4a48', strokeWidth: 1.1, strokeLinejoin: 'round' as const };
const line = { fill: 'none', stroke: INK, strokeLinecap: 'round' as const };

const eyes = (cx1: number, cx2: number, cy: number, r = 2.4) => (
  <>
    <circle cx={cx1} cy={cy} r={r} fill={INK} />
    <circle cx={cx2} cy={cy} r={r} fill={INK} />
  </>
);

const LEGACY_AVATARS: AvatarOption[] = [
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

const AVATARS_BY_ID = new Map([...AVATARS, ...LEGACY_AVATARS].map((avatar) => [avatar.id, avatar]));

export function Avatar({ id, size = 48 }: { id?: string; size?: number }) {
  const avatar = id ? AVATARS_BY_ID.get(id) : undefined;
  if (avatar?.image) {
    return <img className="avatar" src={avatar.image} alt="" width={size} height={size} />;
  }

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
