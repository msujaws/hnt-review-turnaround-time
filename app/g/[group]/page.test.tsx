import { describe, expect, it, vi } from 'vitest';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound, useRouter: () => ({ push: vi.fn() }) }));

import GroupPage, { generateStaticParams } from './page';

describe('group route', () => {
  it('statically generates every known group', () => {
    expect(generateStaticParams().map((p) => p.group)).toEqual([
      'home-newtab',
      'ip-protection',
      'desktop-theme',
      'sharing',
      'geckoview',
      'credential-management',
    ]);
  });

  it('calls notFound for an unknown group id', async () => {
    await expect(
      GroupPage({ params: Promise.resolve({ group: 'does-not-exist' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
