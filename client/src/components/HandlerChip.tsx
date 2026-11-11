import type { User } from '../types';
import { initials } from '../util/format';

type Props = {
  handlerName: string | null | undefined;
  users: User[];
};

function colorIndex(handlerName: string | null | undefined, users: User[]): number {
  if (!handlerName) return 0;
  const idx = users.findIndex((u) => u.name.toLowerCase() === handlerName.toLowerCase());
  if (idx < 0) {
    // Fallback: hash by name so unknown handlers still get a consistent color.
    let h = 0;
    for (const c of handlerName) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h) % 7;
  }
  return idx % 7;
}

export default function HandlerChip({ handlerName, users }: Props) {
  if (!handlerName) return <span className="dash">—</span>;
  return (
    <span className="handler">
      <span className="avatar" data-color={colorIndex(handlerName, users)}>{initials(handlerName)}</span>
      <span>{handlerName}</span>
    </span>
  );
}

export function HandlerAvatar({ name, users, large }: { name: string; users: User[]; large?: boolean }) {
  return (
    <span className={'avatar' + (large ? ' lg' : '')} data-color={colorIndex(name, users)}>
      {initials(name)}
    </span>
  );
}
