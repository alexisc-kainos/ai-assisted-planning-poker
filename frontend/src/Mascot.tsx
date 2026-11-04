import riverside from './assets/riverside.jpg';
import riverside2 from './assets/riverside-2.jpg';
import riverside3 from './assets/riverside-3.jpg';
import riverside4 from './assets/riverside-4.jpg';

const SCENES = [riverside, riverside2, riverside3, riverside4];

export function Mascot({ className = 'mascot', ticketIndex = 0 }: { className?: string; ticketIndex?: number }) {
  return (
    <img
      className={className}
      src={SCENES[ticketIndex % SCENES.length]}
      alt=""
      aria-hidden="true"
      width={1376}
      height={768}
    />
  );
}
