import { describe, expect, it, vi } from 'vitest';

import { type BugzillaClient, createBugzillaClient, fetchBugSamples } from './bugzilla';

// Minimal BMO /rest/bug row. Field names are the API's, snake_case included.
const bugRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 2_036_233,
  summary: 'Sports widget - add starter state without countdown',
  product: 'Firefox',
  component: 'New Tab Page',
  creation_time: '2026-05-01T01:31:25Z',
  cf_last_resolved: '2026-05-04T20:27:23Z',
  ...overrides,
});

// Collapses the recorded param pairs into a lookup of key -> every value seen,
// so tests can assert repeated `component=` keys as well as scalar ones.
const valuesFor = (params: readonly (readonly [string, string])[], key: string): string[] =>
  params.filter(([name]) => name === key).map(([, value]) => value);

const clientReturning = (
  ...pages: readonly (readonly Record<string, unknown>[])[]
): { client: BugzillaClient; calls: (readonly (readonly [string, string])[])[] } => {
  const calls: (readonly (readonly [string, string])[])[] = [];
  let index = 0;
  const client: BugzillaClient = {
    get: vi.fn((path: string, params: readonly (readonly [string, string])[]) => {
      // Scope validation hits `product` first; every configured scope in these
      // tests is real, so answer with a component list that covers them.
      if (path === 'product') return Promise.resolve(productResponse(params));
      calls.push(params);
      const page = pages[index] ?? [];
      index += 1;
      return Promise.resolve({ bugs: page });
    }),
  };
  return { client, calls };
};

// Component lists for the products the tests reference, so assertScopeExists
// passes without every test having to stub it.
const COMPONENTS_BY_PRODUCT: Record<string, readonly string[]> = {
  Firefox: ['New Tab Page', 'Sharing', 'about:logins', 'IP Protection', 'Theme'],
  GeckoView: ['General', 'IME', 'Extensions', 'PDF Viewer'],
  Toolkit: ['Password Manager'],
  Core: ['Machine Learning: Frontend', 'Machine Learning: General'],
};

const productResponse = (params: readonly (readonly [string, string])[]): unknown => {
  const name = params.find(([key]) => key === 'names')?.[1] ?? '';
  const components = COMPONENTS_BY_PRODUCT[name];
  if (components === undefined) return { products: [] };
  return { products: [{ name, components: components.map((c) => ({ name: c })) }] };
};

const now = new Date('2026-08-14T12:00:00.000Z');

describe('fetchBugSamples', () => {
  it('extracts a filed-to-resolved sample from a single component scope', async () => {
    const { client } = clientReturning([bugRow()]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples).toEqual([
      {
        source: 'bugzilla',
        id: 2_036_233,
        summary: 'Sports widget - add starter state without countdown',
        product: 'Firefox',
        component: 'New Tab Page',
        filedAt: '2026-05-01T01:31:25Z',
        resolvedAt: '2026-05-04T20:27:23Z',
      },
    ]);
  });

  it('queries only resolution=FIXED so DUPLICATE and WONTFIX never count', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(valuesFor(calls[0] ?? [], 'resolution')).toEqual(['FIXED']);
  });

  it('anchors the lookback window on cf_last_resolved, not creation_time', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    const params = calls[0] ?? [];
    expect(valuesFor(params, 'f1')).toEqual(['cf_last_resolved']);
    expect(valuesFor(params, 'o1')).toEqual(['greaterthan']);
    // 2026-08-14 minus 90 days.
    expect(valuesFor(params, 'v1')).toEqual(['2026-05-16']);
  });

  it('emits one repeated component param per component in a scope', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page', 'Sharing'] }],
      lookbackDays: 90,
      now,
    });
    const params = calls[0] ?? [];
    expect(valuesFor(params, 'product')).toEqual(['Firefox']);
    expect(valuesFor(params, 'component')).toEqual(['New Tab Page', 'Sharing']);
  });

  it('omits the component param entirely for a whole-product scope', async () => {
    const { client, calls } = clientReturning([bugRow({ product: 'GeckoView', component: 'IME' })]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'GeckoView' }],
      lookbackDays: 90,
      now,
    });
    const params = calls[0] ?? [];
    expect(valuesFor(params, 'product')).toEqual(['GeckoView']);
    expect(valuesFor(params, 'component')).toEqual([]);
    expect(result.samples[0]?.component).toBe('IME');
  });

  it('treats an empty components list as a whole-product scope', async () => {
    const { client, calls } = clientReturning([bugRow({ product: 'GeckoView' })]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'GeckoView', components: [] }],
      lookbackDays: 90,
      now,
    });
    expect(valuesFor(calls[0] ?? [], 'component')).toEqual([]);
  });

  it('issues one query per scope and concatenates the results', async () => {
    const { client, calls } = clientReturning(
      [bugRow({ id: 1, product: 'Toolkit', component: 'Password Manager' })],
      [bugRow({ id: 2, product: 'Firefox', component: 'about:logins' })],
    );
    const result = await fetchBugSamples({
      client,
      scopes: [
        { product: 'Toolkit', components: ['Password Manager'] },
        { product: 'Firefox', components: ['about:logins'] },
      ],
      lookbackDays: 90,
      now,
    });
    expect(calls).toHaveLength(2);
    expect(result.samples.map((s) => s.id)).toEqual([1, 2]);
  });

  it('dedupes by bug id when two scopes overlap', async () => {
    const { client } = clientReturning([bugRow({ id: 7 })], [bugRow({ id: 7 })]);
    const result = await fetchBugSamples({
      client,
      // A whole-product scope overlapping one of its own components.
      scopes: [{ product: 'Firefox' }, { product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples.map((s) => s.id)).toEqual([7]);
  });

  it('skips a bug with no cf_last_resolved', async () => {
    const { client } = clientReturning([bugRow({ cf_last_resolved: null }), bugRow({ id: 9 })]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples.map((s) => s.id)).toEqual([9]);
  });

  it('skips a bug whose cf_last_resolved is absent rather than null', async () => {
    const row = bugRow();
    delete row.cf_last_resolved;
    const { client } = clientReturning([row]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples).toEqual([]);
  });

  it('skips a bug resolved at or before it was filed', async () => {
    const { client } = clientReturning([
      bugRow({ id: 1, creation_time: '2026-05-04T20:27:23Z' }),
      bugRow({ id: 2, creation_time: '2026-05-05T00:00:00Z' }),
      bugRow({ id: 3 }),
    ]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples.map((s) => s.id)).toEqual([3]);
  });

  it('pages until a short page comes back', async () => {
    const full = Array.from({ length: 500 }, (_, index) => bugRow({ id: index + 1 }));
    const { client, calls } = clientReturning(full, [bugRow({ id: 501 })]);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples).toHaveLength(501);
    expect(calls).toHaveLength(2);
    expect(valuesFor(calls[0] ?? [], 'offset')).toEqual(['0']);
    expect(valuesFor(calls[1] ?? [], 'offset')).toEqual(['500']);
  });

  it('stops paging on an empty page', async () => {
    const { client, calls } = clientReturning([bugRow()], []);
    const result = await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(result.samples).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('requests exactly the fields the sample needs', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
      now,
    });
    expect(valuesFor(calls[0] ?? [], 'include_fields')).toEqual([
      'id,summary,product,component,creation_time,cf_last_resolved',
    ]);
  });

  it('throws when the response is not shaped like a bug search', async () => {
    const client: BugzillaClient = {
      get: vi.fn((path: string, params: readonly (readonly [string, string])[]) =>
        path === 'product'
          ? Promise.resolve(productResponse(params))
          : Promise.resolve({ error: 'nope' }),
      ),
    };
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow();
  });

  it('throws when a bug row has a malformed timestamp', async () => {
    const { client } = clientReturning([bugRow({ creation_time: 'yesterday' })]);
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow();
  });

  it('throws rather than truncating when the page cap is exhausted', async () => {
    // Every page comes back full, so paging never terminates on its own.
    const full = Array.from({ length: 500 }, (_, index) => bugRow({ id: index + 1 }));
    const client: BugzillaClient = {
      get: vi.fn((path: string, params: readonly (readonly [string, string])[]) =>
        path === 'product'
          ? Promise.resolve(productResponse(params))
          : Promise.resolve({ bugs: full }),
      ),
    };
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow(/Firefox/);
  });

  it('surfaces a Bugzilla error body', async () => {
    const client: BugzillaClient = {
      get: vi.fn((path: string, params: readonly (readonly [string, string])[]) =>
        path === 'product'
          ? Promise.resolve(productResponse(params))
          : Promise.resolve({ error: true, message: 'Something went wrong' }),
      ),
    };
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'Core', components: ['Machine Learning: Frontend'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow(/Something went wrong/);
  });

  // BMO answers a bad product or component with HTTP 200 and {"bugs":[]}, so
  // without this guard a renamed component reports zero fixed bugs forever and
  // nothing says why. These two are the load-bearing cases for that.
  it('throws when a configured component does not exist in the product', async () => {
    const { client } = clientReturning([bugRow()]);
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'Core', components: ['Machine Learning: Sever'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow(/no component\(s\) "Machine Learning: Sever"/);
  });

  it('throws when a configured product does not exist', async () => {
    const { client } = clientReturning([bugRow()]);
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'NoSuchProduct' }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow(/product "NoSuchProduct" does not exist/);
  });

  it('names the known components so a rename is diagnosable from the log', async () => {
    const { client } = clientReturning([bugRow()]);
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'GeckoView', components: ['Nonexistent'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow(/Known components: Extensions, General, IME, PDF Viewer/);
  });

  it('validates before querying, so a bad scope issues no bug search', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await expect(
      fetchBugSamples({
        client,
        scopes: [{ product: 'GeckoView', components: ['Nonexistent'] }],
        lookbackDays: 90,
        now,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('returns no samples and issues no query when there are no scopes', async () => {
    const { client, calls } = clientReturning();
    const result = await fetchBugSamples({ client, scopes: [], lookbackDays: 90, now });
    expect(result.samples).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('defaults now to the current time when omitted', async () => {
    const { client, calls } = clientReturning([bugRow()]);
    await fetchBugSamples({
      client,
      scopes: [{ product: 'Firefox', components: ['New Tab Page'] }],
      lookbackDays: 90,
    });
    // Can't pin the value without freezing the clock; assert it is a date.
    expect(valuesFor(calls[0] ?? [], 'v1')[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  }) as unknown as Response;

// Records the URLs the client requests. Typed as a string-taking function so the
// recorded values stay plain strings — createBugzillaClient always builds a
// string URL, and keeping it that way avoids stringifying a URL or Request.
const recordingFetch = (response: Response): { fetchFn: typeof fetch; urls: readonly string[] } => {
  const urls: string[] = [];
  const fetchFn = (url: string): Promise<Response> => {
    urls.push(url);
    return Promise.resolve(response);
  };
  return { fetchFn: fetchFn as unknown as typeof fetch, urls };
};

describe('createBugzillaClient', () => {
  it('GETs /rest/bug with repeated params preserved in the query string', async () => {
    const { fetchFn, urls } = recordingFetch(okResponse({ bugs: [] }));
    const client = createBugzillaClient({ origin: 'https://bmo.example', fetchFn });
    await client.get('bug', [
      ['product', 'Firefox'],
      ['component', 'New Tab Page'],
      ['component', 'Sharing'],
    ]);
    expect(urls).toEqual([
      'https://bmo.example/rest/bug?product=Firefox&component=New+Tab+Page&component=Sharing',
    ]);
  });

  it('returns the parsed JSON body', async () => {
    const { fetchFn } = recordingFetch(okResponse({ bugs: [{ id: 1 }] }));
    const client = createBugzillaClient({ origin: 'https://bmo.example', fetchFn });
    await expect(client.get('bug', [['product', 'Firefox']])).resolves.toEqual({
      bugs: [{ id: 1 }],
    });
  });

  it('throws with the status on a non-ok response', async () => {
    const { fetchFn } = recordingFetch({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    } as unknown as Response);
    const client = createBugzillaClient({ origin: 'https://bmo.example', fetchFn });
    await expect(client.get('bug', [['product', 'Firefox']])).rejects.toThrow(/503/);
  });

  it('defaults to the production Bugzilla origin', async () => {
    const { fetchFn, urls } = recordingFetch(okResponse({ bugs: [] }));
    const client = createBugzillaClient({ fetchFn });
    await client.get('bug', [['product', 'Firefox']]);
    expect(urls).toEqual(['https://bugzilla.mozilla.org/rest/bug?product=Firefox']);
  });
});
