import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { asMaterialSymbolName, Icon } from './Icon';

describe('asMaterialSymbolName', () => {
  it('accepts a known symbol name', () => {
    expect(asMaterialSymbolName('trending_up')).toBe('trending_up');
  });

  it('rejects an unknown symbol name', () => {
    expect(() => asMaterialSymbolName('definitely_not_a_symbol')).toThrow();
  });
});

describe('Icon', () => {
  it('renders a Material Symbols span with the icon name as text', () => {
    render(<Icon name={asMaterialSymbolName('trending_up')} />);
    const element = screen.getByText('trending_up');
    expect(element).toHaveClass('material-symbols-outlined');
    expect(element).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges an additional className', () => {
    render(<Icon name={asMaterialSymbolName('schedule')} className="text-emerald-400" />);
    const element = screen.getByText('schedule');
    expect(element).toHaveClass('material-symbols-outlined');
    expect(element).toHaveClass('text-emerald-400');
  });
});
