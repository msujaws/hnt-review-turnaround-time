import { describe, expect, it } from 'vitest';

import { bugzillaBuglistUrl, bugzillaBugUrl, bugzillaScopeLabel } from './bugzillaLinks';

describe('bugzillaBugUrl', () => {
  it('links a bug by id', () => {
    expect(bugzillaBugUrl(2_036_233)).toBe('https://bugzilla.mozilla.org/show_bug.cgi?id=2036233');
  });
});

describe('bugzillaBuglistUrl', () => {
  // The panel links this so a reader can audit the number the metric reports.
  // It has to reproduce the collector's query, or the audit lies.
  it('reproduces a single-component scope', () => {
    const url = new URL(bugzillaBuglistUrl([{ product: 'Firefox', components: ['New Tab Page'] }]));
    expect(url.pathname).toBe('/buglist.cgi');
    expect(url.searchParams.getAll('product')).toEqual(['Firefox']);
    expect(url.searchParams.getAll('component')).toEqual(['New Tab Page']);
    expect(url.searchParams.getAll('resolution')).toEqual(['FIXED']);
  });

  it('emits one repeated component param per component', () => {
    const url = new URL(
      bugzillaBuglistUrl([
        {
          product: 'Core',
          components: ['Machine Learning: Frontend', 'Machine Learning: Models'],
        },
      ]),
    );
    expect(url.searchParams.getAll('component')).toEqual([
      'Machine Learning: Frontend',
      'Machine Learning: Models',
    ]);
    // Colons and spaces must survive encoding or the link 404s.
    expect(url.search).toContain('Machine+Learning%3A+Frontend');
  });

  it('omits the component param for a whole-product scope', () => {
    const url = new URL(bugzillaBuglistUrl([{ product: 'GeckoView' }]));
    expect(url.searchParams.getAll('product')).toEqual(['GeckoView']);
    expect(url.searchParams.getAll('component')).toEqual([]);
  });

  it('unions several scopes into one query', () => {
    const url = new URL(
      bugzillaBuglistUrl([
        { product: 'Toolkit', components: ['Password Manager'] },
        { product: 'Firefox', components: ['about:logins'] },
      ]),
    );
    expect(url.searchParams.getAll('product')).toEqual(['Toolkit', 'Firefox']);
    expect(url.searchParams.getAll('component')).toEqual(['Password Manager', 'about:logins']);
  });
});

describe('bugzillaScopeLabel', () => {
  it('reads as product :: component', () => {
    expect(bugzillaScopeLabel([{ product: 'Firefox', components: ['New Tab Page'] }])).toBe(
      'Firefox :: New Tab Page',
    );
  });

  it('names only the product for a whole-product scope', () => {
    expect(bugzillaScopeLabel([{ product: 'GeckoView' }])).toBe('GeckoView');
  });

  it('joins several components and scopes', () => {
    expect(
      bugzillaScopeLabel([
        { product: 'Firefox', components: ['New Tab Page', 'Sharing'] },
        { product: 'GeckoView' },
      ]),
    ).toBe('Firefox :: New Tab Page, Firefox :: Sharing, GeckoView');
  });
});
