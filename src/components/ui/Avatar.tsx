import type { UserProfile } from '../../types';

interface AvatarProps {
  user?: Pick<UserProfile, 'photoURL' | 'displayName'> | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  rounded?: 'full' | '2xl' | 'xl';
}

const sizeMap = {
  xs: 'w-6 h-6 text-[8px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-16 h-16 text-sm',
  xl: 'w-32 h-32 text-xl',
};

const roundedMap = {
  full: 'rounded-full',
  '2xl': 'rounded-2xl',
  xl: 'rounded-xl',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ user, size = 'md', className = '', rounded = 'full' }: AvatarProps) {
  const sizeClass = sizeMap[size];
  const roundedClass = roundedMap[rounded];

  if (!user) {
    return (
      <div
        className={`${sizeClass} ${roundedClass} bg-slate-200 flex items-center justify-center ${className}`}
      />
    );
  }

  if (user.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName}
        className={`${sizeClass} ${roundedClass} object-cover bg-slate-100 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} bg-paper-warm text-navy flex items-center justify-center font-bold ${className}`}
    >
      {getInitials(user.displayName)}
    </div>
  );
}
