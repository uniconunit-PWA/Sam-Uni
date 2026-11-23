import React from 'react';
import { getStatusMeta, isNoPipeCancelledStatus } from '../types/meter';

interface NoPipeWarningIconProps {
  className?: string;
  withHalo?: boolean;
}

export const NoPipeWarningIcon: React.FC<NoPipeWarningIconProps> = ({
  className = 'w-4 h-4 shrink-0',
  withHalo = false,
}) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    className={`${className} ${
      withHalo ? 'drop-shadow-[0_0_2px_rgba(255,255,255,0.95)]' : ''
    }`}
  >
    {/* Left radiating warning rays */}
    <path d="M10.8 10.2 L5.9 6.6 A0.95 0.95 0 1 1 7.2 5.2 Z" fill="#EF4444" />
    <path d="M9.5 13.3 L2.6 11.6 A1.05 1.05 0 1 1 3.3 9.6 Z" fill="#EF4444" />
    <path d="M8.2 16.5 L2.5 17.3 A0.85 0.85 0 1 1 2.5 15.6 Z" fill="#EF4444" />
    {/* Right radiating warning rays */}
    <path d="M21.2 10.2 L26.1 6.6 A0.95 0.95 0 1 0 24.8 5.2 Z" fill="#EF4444" />
    <path d="M22.5 13.3 L29.4 11.6 A1.05 1.05 0 1 0 28.7 9.6 Z" fill="#EF4444" />
    <path d="M23.8 16.5 L29.5 17.3 A0.85 0.85 0 1 0 29.5 15.6 Z" fill="#EF4444" />
    {/* Red rounded warning triangle */}
    <path
      d="M16 5.2 C16.75 5.2 17.4 5.6 17.8 6.35 L26.5 23.6 C27.15 24.9 26.2 26.5 24.7 26.5 L7.3 26.5 C5.8 26.5 4.85 24.9 5.5 23.6 L14.2 6.35 C14.6 5.6 15.25 5.2 16 5.2 Z"
      fill="#EF4444"
    />
    {/* White exclamation mark */}
    <path
      d="M16 11.1 C16.9 11.1 17.45 11.75 17.35 12.7 L16.75 19.35 C16.7 19.95 16.38 20.35 16 20.35 C15.62 20.35 15.3 19.95 15.25 19.35 L14.65 12.7 C14.55 11.75 15.1 11.1 16 11.1 Z"
      fill="#FFFFFF"
    />
    <circle cx="16" cy="23.25" r="1.45" fill="#FFFFFF" />
  </svg>
);

interface StatusSymbolProps {
  status: string;
  size?: 'sm' | 'md';
  shape?: 'circle' | 'square';
  className?: string;
}

export const StatusSymbol: React.FC<StatusSymbolProps> = ({
  status,
  size = 'sm',
  shape = 'circle',
  className = '',
}) => {
  if (isNoPipeCancelledStatus(status)) {
    return (
      <NoPipeWarningIcon
        className={`${size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'} shrink-0 ${className}`}
      />
    );
  }
  const meta = getStatusMeta(status);
  const dim = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2';
  const radius = shape === 'square' ? 'rounded-sm' : 'rounded-full';
  return (
    <span
      className={`${dim} ${radius} shrink-0 inline-block ${meta.dotClass} ${className}`}
    />
  );
};
