import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Footer } from './Footer';

describe('Footer', () => {
  it('links to the GitHub source repository', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: /source on github/i });
    expect(link).toHaveAttribute('href', 'https://github.com/msujaws/hnt-review-turnaround-time');
  });

  it('credits the author', () => {
    render(<Footer />);
    expect(screen.getByText(/created by jared wein/i)).toBeInTheDocument();
  });
});
