import type { FC } from 'react';

import type { Brand } from '../types/brand';

export type MaterialSymbolName = Brand<string, 'MaterialSymbolName'>;

const ALLOWED_SYMBOLS = new Set<string>([
  'trending_up',
  'trending_down',
  'trending_flat',
  'schedule',
  'check_circle',
  'warning',
  'code',
  'merge_type',
]);

export const asMaterialSymbolName = (name: string): MaterialSymbolName => {
  if (!ALLOWED_SYMBOLS.has(name)) {
    throw new Error(`unknown Material Symbol name: ${name}`);
  }
  return name as MaterialSymbolName;
};

export interface IconProps {
  readonly name: MaterialSymbolName;
  readonly className?: string;
}

export const Icon: FC<IconProps> = ({ name, className }) => (
  <span aria-hidden="true" className={`material-symbols-outlined ${className ?? ''}`.trim()}>
    {name}
  </span>
);
