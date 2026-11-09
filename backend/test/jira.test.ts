import type { IncomingMessage, ServerResponse } from 'node:http';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { JiraService, parseJiraIssueKey, type JiraStatus } from '../src/jira.js';
import { Room } from '../src/rooms.js';
import { parseClientMessage, type JiraClientMessage } from '../src/validation.js';
import { connect, startServer, type TestClient } from './helpers.js';

describe('optional Jira configuration', () => {
  const env = {
    JIRA_OAUTH_CLIENT_ID: 'test-client',
    JIRA_OAUTH_CLIENT_SECRET: 'test-secret',
    JIRA_OAUTH_REDIRECT_URI: 'https://backend.example/jira/oauth/callback',
  };

  it('accepts a production HTTPS callback without requiring a global Jira site', () => {
    expect(loadConfig(env).jira).toEqual({
      clientId: 'test-client', clientSecret: 'test-secret', redirectUri: env.JIRA_OAUTH_REDIRECT_URI,
    });
  });

  it.each([
    {}, { ...env, JIRA_OAUTH_CLIENT_SECRET: '' },
    { ...env, JIRA_OAUTH_REDIRECT_URI: 'http://backend.example/jira/oauth/callback' },
    { ...env, JIRA_OAUTH_REDIRECT_URI: 'https://user:password@backend.example/jira/oauth/callback' },
    { ...env, JIRA_OAUTH_REDIRECT_URI: `${env.JIRA_OAUTH_REDIRECT_URI}?redirect=elsewhere` },
  ])('disables only Jira for invalid or missing settings', (input) => {
    const config = loadConfig(input);
    expect(config.jira).toBeUndefined();
    expect(config.maxRoomUsers).toBe(50);
  });

  it('permits HTTP only for local development callbacks', () => {
    expect(loadConfig({ ...env, JIRA_OAUTH_REDIRECT_URI: 'http://localhost:3000/jira/oauth/callback' }).jira).toBeDefined();
  });
});

const jiraConfig = {
  clientId: 'fixture-client', clientSecret: 'fixture-secret',
  redirectUri: 'https://backend.example/jira/oauth/callback',
};
const site = { id: 'cloud-one', name: 'Team Jira', url: 'https://team.atlassian.net' };
const otherSite = { id: 'cloud-two', name: 'Other Jira', url: 'https://other.atlassian.net' };
const scopes = ['read:jira-work', 'write:jira-work'];
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const message = (action: JiraClientMessage['action'], values: Record<string, unknown> = {}) =>
  ({ type: 'jira', requestId: 'fixture-request', action, ...values }) as JiraClientMessage;
const services: JiraService[] = [];
const localFetch = fetch;

afterEach(() => {
  services.splice(0).forEach((service) => service.shutdown());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  const room = new Room('fixture-room');
  const host = room.add('Facilitator');
  const member = room.add('Participant');
  const changed = vi.fn<(room: Room, status: JiraStatus) => void>();
  const state = {
    issue: { id: '10001', key: 'TEAM-7', fields: {
      summary: 'Imported story', description: null as unknown, issuetype: { name: 'Story' },
    } },
    resources: [{ ...site, scopes }, { ...otherSite, scopes }],
    fields: [{ id: 'customfield_10123', name: 'Story Points', schema: { type: 'number' } }],
    editable: { customfield_10123: { operations: ['set'] } } as Record<string, { operations: string[] }>,
    points: 3 as number | null,
    expiresIn: 3600,
  };
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === 'https://auth.atlassian.com/oauth/token') {
      return jsonResponse({ access_token: 'fixture-access-token', expires_in: state.expiresIn });
    }
    if (url.pathname === '/oauth/token/accessible-resources') return jsonResponse(state.resources);
    if (!url.href.startsWith(`https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/`)) {
      throw new Error('Unexpected upstream route');
    }
    if (url.pathname.endsWith('/field')) return jsonResponse(state.fields);
    if (url.pathname.endsWith('/editmeta')) return jsonResponse({ fields: state.editable });
    if (init?.method === 'PUT') {
      state.points = JSON.parse(String(init.body)).fields.customfield_10123 as number;
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.get('fields') === 'summary,description,issuetype') return jsonResponse(state.issue);
    if (url.pathname.endsWith('/issue/10001')) return jsonResponse({ fields: { customfield_10123: state.points } });
    throw new Error('Unexpected upstream route');
  });
  const service = new JiraService(jiraConfig, changed, request, ['https://frontend.example', 'http://localhost:5173']);
  services.push(service);
  const act = (action: JiraClientMessage['action'], values: Record<string, unknown> = {}, target = room, userId = host.id) =>
    service.action(target, userId, message(action, values));
  const writes = () => request.mock.calls.filter(([, init]) => init?.method === 'PUT');
  return { room, host, member, state, changed, request, service, act, writes };
}

async function http(service: JiraService, path: string, cookie?: string, method = 'GET') {
  const headers: Record<string, string> = {};
  let status = 200;
  let body = '';
  const response = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    writeHead(code: number, values: Record<string, string> = {}) {
      status = code;
      for (const [name, value] of Object.entries(values)) headers[name.toLowerCase()] = value;
    },
    end(value = '') { body = value; },
  };
  await service.handleHttp({ method, headers: { cookie } } as IncomingMessage,
    response as unknown as ServerResponse, new URL(path, jiraConfig.redirectUri));
  return { status, headers, body };
}

async function startOAuth(context: ReturnType<typeof fixture>, room = context.room, userId = context.host.id) {
  const connection = await context.act('connect', {}, room, userId);
  expect(connection.authorizeUrl).toBeDefined();
  const start = await http(context.service, connection.authorizeUrl!);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.location);
  const state = authorize.searchParams.get('state')!;
  const cookie = start.headers['set-cookie'].split(';')[0];
  return { start, authorize, state, cookie, startUrl: connection.authorizeUrl! };
}

async function connected(context: ReturnType<typeof fixture>) {
  const flow = await startOAuth(context);
  const callback = await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie);
  expect(callback.status).toBe(200);
  await context.act('selectSite', { siteId: site.id });
  return flow;
}

async function imported(context: ReturnType<typeof fixture>) {
  const result = await context.act('import', { input: 'TEAM-7' });
  expect(result.ticketId).toBeDefined();
  return context.room.tickets.find((ticket) => ticket.id === result.ticketId)!;
}

async function agreed(context: ReturnType<typeof fixture>) {
  await connected(context);
  const ticket = await imported(context);
  expect(context.room.selectTicket(context.host.id, ticket.id)).toBeNull();
  expect(context.room.vote(context.host.id, '2', context.room.round)).toBeNull();
  expect(context.room.vote(context.member.id, '13', context.room.round)).toBeNull();
  expect(context.room.reveal(context.host.id)).toBeNull();
  expect(ticket.agreedEstimate).toBeUndefined();
  await context.act('agree', { ticketId: ticket.id, points: 8 });
  return ticket;
}

describe('room-scoped Jira authorisation', () => {
  it.each(['status', 'connect', 'disconnect', 'selectSite', 'import', 'suggest', 'agree', 'prepare', 'confirm'] as const)(
    'denies %s to members, foreign-room hosts and unknown identities before any upstream call', async (action) => {
      const context = fixture();
      const foreign = new Room('foreign-room').add('Foreign facilitator');
      for (const userId of [context.member.id, foreign.id, 'spoofed-user']) {
        await expect(context.service.action(context.room, userId, message(action, {
          siteId: site.id, input: 'TEAM-7', query: 'AL-', ticketId: 'ticket', points: 8, confirmationId: 'confirmation',
        }))).rejects.toThrow('Only the facilitator can use Jira');
      }
      expect(context.request).not.toHaveBeenCalled();
    },
  );

  it('uses single-use start codes, browser-bound cookies and scoped code exchange with no offline access', async () => {
    const context = fixture();
    const flow = await startOAuth(context);
    expect(flow.authorize.origin).toBe('https://auth.atlassian.com');
    expect(flow.authorize.searchParams.get('scope')?.split(' ')).toEqual(scopes);
    expect(flow.authorize.searchParams.get('response_type')).toBe('code');
    expect(flow.authorize.searchParams.get('redirect_uri')).toBe(jiraConfig.redirectUri);
    expect(flow.start.headers['set-cookie']).toContain('HttpOnly; SameSite=Lax; Max-Age=600; Secure');
    expect(flow.start.headers['cache-control']).toBe('no-store');
    expect((await http(context.service, flow.startUrl)).status).toBe(400);
    const path = `/jira/oauth/callback?state=${flow.state}&code=fixture-code`;
    expect((await http(context.service, path)).status).toBe(400);
    expect((await http(context.service, path, 'unrelated=value')).status).toBe(400);
    expect((await http(context.service, '/jira/oauth/callback?code=fixture-code', flow.cookie)).status).toBe(400);
    expect((await http(context.service, `/jira/oauth/callback?state=${'x'.repeat(32)}&code=fixture-code`, flow.cookie)).status).toBe(400);
    expect(context.request).not.toHaveBeenCalled();
    const callback = await http(context.service, path, flow.cookie);
    expect(callback.status).toBe(200);
    expect(callback.headers['set-cookie']).toContain('Max-Age=0');
    expect((await http(context.service, path, flow.cookie)).status).toBe(400);
    expect(context.request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(context.request.mock.calls[0][1]?.body))).toEqual({
      grant_type: 'authorization_code', client_id: jiraConfig.clientId,
      client_secret: jiraConfig.clientSecret, code: 'fixture-code', redirect_uri: jiraConfig.redirectUri,
    });
    expect(context.service.status(context.room)).toEqual({ available: true, connected: false, sites: [site, otherSite] });
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('Select an authorised Jira site first');
    await expect(context.act('selectSite', { siteId: 'unapproved' })).rejects.toThrow('Select a site authorised');
    await context.act('selectSite', { siteId: site.id });
    await expect(context.act('selectSite', { siteId: otherSite.id })).rejects.toThrow('Disconnect Jira before changing sites');
    const publicData = JSON.stringify({ callback, changes: context.changed.mock.calls, snapshot: context.room.snapshot(context.member.id) });
    for (const secret of ['fixture-access-token', jiraConfig.clientSecret, context.host.token, 'fixture-code']) {
      expect(publicData.includes(secret)).toBe(false);
    }
  });

  it.each(['error=access_denied', ''])('rejects denied or incomplete callback (%s) and consumes state', async (query) => {
    const context = fixture();
    const flow = await startOAuth(context);
    const path = `/jira/oauth/callback?state=${flow.state}&${query}`;
    expect((await http(context.service, path, flow.cookie)).status).toBe(400);
    expect((await http(context.service, `${path}&code=fixture-code`, flow.cookie)).status).toBe(400);
    expect(context.request).not.toHaveBeenCalled();
    expect(context.service.status(context.room).connected).toBe(false);
  });

  it.each(['read:jira-work', 'write:jira-work', 'offline_access'])('rejects resources with insufficient scope: %s', async (scope) => {
    const context = fixture();
    context.state.resources = [{ ...site, scopes: [scope] }];
    const flow = await startOAuth(context);
    expect((await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie)).status).toBe(400);
    expect(context.service.status(context.room)).toEqual({ available: true, connected: false });
  });

  it.each(['disconnect', 'promotion', 'rotation', 'shutdown'] as const)('cannot connect a pending callback after %s', async (event) => {
    const context = fixture();
    const flow = await startOAuth(context);
    if (event === 'disconnect') await context.act('disconnect');
    if (event === 'promotion') { context.room.markAway(context.host.id); context.service.reconcile(context.room); }
    if (event === 'rotation') { context.room.takeOver(context.host); context.service.reconcile(context.room); }
    if (event === 'shutdown') context.service.shutdown();
    expect((await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie)).status).toBe(400);
    expect(context.request).not.toHaveBeenCalled();
    expect(context.service.status(context.room).connected).toBe(false);
  });

  it('expires pending state at ten minutes and connected tokens on an explicit timer without polling', async () => {
    vi.useFakeTimers();
    const context = fixture();
    const pending = await startOAuth(context);
    vi.advanceTimersByTime(600_000);
    expect((await http(context.service, `/jira/oauth/callback?state=${pending.state}&code=fixture-code`, pending.cookie)).status).toBe(400);
    expect(context.request).not.toHaveBeenCalled();
    context.state.expiresIn = 60;
    await connected(context);
    context.changed.mockClear();
    vi.advanceTimersByTime(59_999);
    expect(context.changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.changed).toHaveBeenCalledWith(context.room, {
      available: true, connected: false, reason: 'Jira authorisation expired. Reauthorise to continue.',
    });
    expect(context.request).toHaveBeenCalledTimes(2);
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('Connect Jira first');
  });

  it('isolates room incarnations, cleanup, disconnect and a restarted service while retaining imported data', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    const second = new Room('second-room');
    const secondHost = second.add('Second facilitator');
    const flow = await startOAuth(context, second, secondHost.id);
    expect((await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie)).status).toBe(200);
    await context.act('selectSite', { siteId: site.id }, second, secondHost.id);
    context.service.clear(second);
    expect(context.service.status(context.room).connected).toBe(true);
    expect(context.service.status(new Room(second.id)).connected).toBe(false);
    await context.act('disconnect');
    expect(ticket).toEqual(before);
    expect(context.service.status(context.room).connected).toBe(false);
    await connected(context);
    context.service.shutdown();
    const restarted = new JiraService(jiraConfig, context.changed, context.request);
    services.push(restarted);
    expect(restarted.status(context.room).connected).toBe(false);
    expect(ticket).toEqual(before);
  });

  it('clears an upstream 401 without deleting local estimates or results', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    context.request.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(context.act('prepare', { ticketId: ticket.id })).rejects.toThrow('Jira authorisation expired');
    expect(context.service.status(context.room).connected).toBe(false);
    expect(ticket).toEqual(before);
  });
});

describe('Jira OAuth popup completion', () => {
  it.each([
    ['https://frontend.example/planning-poker/', 'https://frontend.example'],
    ['http://localhost:5173/planning-poker/', 'http://localhost:5173'],
    ['https://frontend.example/a<b&c\"d\'e/', 'https://frontend.example'],
  ])('closes before the validated fallback and preserves the app path: %s', async (base, origin) => {
    const context = fixture();
    const target = new URL(base);
    target.search = '?room=fixture-room&code=untrusted-code&token=untrusted-token&redirect=https://evil.example';
    const connection = await context.service.action(context.room, context.host.id,
      message('connect', { returnUrl: target.href }), origin);
    const start = await http(context.service, connection.authorizeUrl!);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookie = start.headers['set-cookie'].split(';')[0];
    const path = `/jira/oauth/callback?state=${state}&code=fixture-code`;
    const callback = await http(context.service, path, cookie);
    target.search = '?room=fixture-room';
    expect(callback.status).toBe(200);
    expect(callback.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(callback.headers['cache-control']).toBe('no-store');
    expect(callback.headers['referrer-policy']).toBe('no-referrer');
    expect(callback.headers.location).toBeUndefined();
    const script = /<script nonce="([\w-]+)">([^]*?)<\/script>/.exec(callback.body);
    expect(script).not.toBeNull();
    expect(callback.headers['content-security-policy']).toBe(
      `default-src 'none'; script-src 'nonce-${script![1]}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    const escaped = target.href.replaceAll('&', '&amp;').replaceAll("'", '&#39;');
    expect(callback.body).toContain(`<a href="${escaped}" rel="noreferrer">`);
    const close = vi.fn();
    const replace = vi.fn();
    const schedule = vi.fn<(callback: () => void, delay: number) => void>();
    runInNewContext(script![2], { window: { close }, location: { replace }, setTimeout: schedule });
    expect(close).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(schedule.mock.invocationCallOrder[0]);
    expect(replace).not.toHaveBeenCalled();
    schedule.mock.calls[0][0]();
    expect(replace).toHaveBeenCalledExactlyOnceWith(target.href);
    for (const secret of [state, 'fixture-code', 'fixture-access-token', 'untrusted-code', 'untrusted-token', jiraConfig.clientSecret]) {
      expect(callback.body).not.toContain(secret);
    }
    const replay = await http(context.service, path, cookie);
    expect(replay.status).toBe(400);
    expect(replay.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(replay.headers.location).toBeUndefined();
    expect(replay.body).not.toMatch(/<script|location\.replace|frontend\.example/);
    expect(context.request).toHaveBeenCalledTimes(2);
  });

  it('still closes for legacy clients without inventing a redirect target', async () => {
    const context = fixture();
    const flow = await startOAuth(context);
    const callback = await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie);
    expect(callback.status).toBe(200);
    expect(callback.body).toContain('window.close();');
    expect(callback.body).not.toMatch(/setTimeout|location\.replace|<a /);
    expect(callback.headers['content-security-policy']).toMatch(/script-src 'nonce-[\w-]+'/);
  });

  it.each([
    ['https://evil.example/?room=fixture-room', 'https://frontend.example'],
    ['https://unallowed.example/?room=fixture-room', 'https://unallowed.example'],
    ['https://frontend.example/?room=fixture-room', 'http://localhost:5173'],
    ['https://frontend.example/?room=fixture-room', undefined],
    ['https://frontend.example/?room=another-room', 'https://frontend.example'],
    ['https://frontend.example/', 'https://frontend.example'],
    ['https://user:password@frontend.example/?room=fixture-room', 'https://frontend.example'],
    ['http://frontend.example/?room=fixture-room', 'http://frontend.example'],
    ['javascript:alert(1)', 'null'],
    ['https://frontend.example/?room=fixture-room#fragment', 'https://frontend.example'],
    ['not a URL', 'https://frontend.example'],
  ])('rejects an unsafe or mismatched return URL before OAuth: %s (%s)', async (returnUrl, origin) => {
    const context = fixture();
    await expect(context.service.action(context.room, context.host.id, message('connect', { returnUrl }), origin))
      .rejects.toThrow('return URL must be this planning room on an allowed app origin');
    expect(context.request).not.toHaveBeenCalled();
    expect(context.changed).not.toHaveBeenCalled();
  });

  it.each([null, 42, '', ' ', 'x'.repeat(2_049)])('rejects invalid return URL metadata at the parser boundary: %s', (returnUrl) => {
    expect(parseClientMessage(JSON.stringify(message('connect', { returnUrl }))).ok).toBe(false);
  });

  it('accepts a bounded URL without trusting client-supplied room or origin fields', () => {
    const returnUrl = 'https://frontend.example/?room=fixture-room&extra='.padEnd(2_048, 'x');
    expect(returnUrl).toHaveLength(2_048);
    expect(parseClientMessage(JSON.stringify(message('connect', {
      returnUrl, room: 'spoofed-room', origin: 'https://evil.example',
    })))).toEqual({ ok: true, message: message('connect', { returnUrl }) });
  });

  it('keeps denied callbacks plaintext with no fallback even when a return URL was validated', async () => {
    const context = fixture();
    const connection = await context.service.action(context.room, context.host.id,
      message('connect', { returnUrl: 'https://frontend.example/?room=fixture-room' }), 'https://frontend.example');
    const start = await http(context.service, connection.authorizeUrl!);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookie = start.headers['set-cookie'].split(';')[0];
    const denied = await http(context.service, `/jira/oauth/callback?state=${state}&error=access_denied`, cookie);
    expect(denied.status).toBe(400);
    expect(denied.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(denied.headers.location).toBeUndefined();
    expect(denied.body).not.toMatch(/<script|location\.replace|frontend\.example/);
    expect(context.request).not.toHaveBeenCalled();
  });
});

describe('Jira issue-key autocomplete', () => {
  it.each(['al-', 'team-12', `${'a'.repeat(62)}-`, `${'a'.repeat(62)}-1`])('normalises a bounded key prefix: %s', (query) => {
    expect(parseClientMessage(JSON.stringify(message('suggest', { query })))).toEqual({
      ok: true, message: message('suggest', { query: query.toUpperCase() }),
    });
  });

  it.each([undefined, null, 12, '', 'AL', '-1', '1AL-', 'AL-x', ' AL-', 'AL-\n',
    'https://team.atlassian.net/browse/AL-1', 'AL- OR project = OTHER', 'AL\" OR project=OTHER-',
    `${'A'.repeat(64)}-`,
  ])('rejects invalid prefixes at parser and service boundaries without network: %s', async (query) => {
    const context = fixture();
    await connected(context);
    context.request.mockClear();
    expect(parseClientMessage(JSON.stringify(message('suggest', { query }))).ok).toBe(false);
    await expect(context.act('suggest', { query })).rejects.toThrow();
    expect(context.request).not.toHaveBeenCalled();
    expect(context.room.tickets).toEqual([]);
  });

  it.each(['al-', 'TEAM-', 'team_2-1'])('queries only the connected cloud and project for %s without importing or writing', async (query) => {
    const context = fixture();
    await connected(context);
    const before = structuredClone(context.room.snapshot(context.host.id));
    context.changed.mockClear();
    context.request.mockClear();
    const key = `${query.toUpperCase()}2`;
    context.request.mockResolvedValueOnce(jsonResponse({ sections: [{ id: 'cs', issues: [
      { key, summaryText: 'Existing task & plain text', summary: '<b>HTML summary</b>', keyHtml: '<b>fake key</b>', issuetype: { name: 'Task' } },
    ] }] }));
    expect(await context.act('suggest', { query })).toEqual({ suggestions: [{ key, summary: 'Existing task & plain text' }] });
    expect(context.request).toHaveBeenCalledOnce();
    const [input, init] = context.request.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(`https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/issue/picker`);
    expect([...url.searchParams.entries()]).toEqual([
      ['query', query.toUpperCase()], ['showSubTasks', 'false'],
      ['currentJQL', `project = "${query.split('-')[0].toUpperCase()}" ORDER BY key ASC`],
    ]);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-access-token' });
    expect(init?.redirect).toBe('error');
    expect(context.room.snapshot(context.host.id)).toEqual(before);
    expect(context.changed).not.toHaveBeenCalled();
    expect(context.writes()).toHaveLength(0);
  });

  it('requires both a token and a selected site', async () => {
    const context = fixture();
    await expect(context.act('suggest', { query: 'AL-' })).rejects.toThrow('Connect Jira first');
    const flow = await startOAuth(context);
    await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie);
    context.request.mockClear();
    await expect(context.act('suggest', { query: 'AL-' })).rejects.toThrow('Select an authorised Jira site first');
    expect(context.request).not.toHaveBeenCalled();
  });

  it.each([{ sections: [] }, { sections: [{ id: 'cs', issues: [] }] },
    { sections: [{ id: 'hs', issues: [{ key: 'AL-1', summaryText: 'History only' }] }] },
  ])('returns no invented keys when Current Search has no matches: %j', async (response) => {
    const context = fixture();
    await connected(context);
    context.request.mockResolvedValueOnce(jsonResponse(response));
    expect(await context.act('suggest', { query: 'AL-' })).toEqual({ suggestions: [] });
  });

  it.each([null, [], {}, { sections: null }, { sections: {} }])('rejects malformed picker metadata: %j', async (response) => {
    const context = fixture();
    await connected(context);
    context.request.mockResolvedValueOnce(jsonResponse(response));
    await expect(context.act('suggest', { query: 'AL-' })).rejects.toThrow('invalid issue suggestions');
    expect(context.service.status(context.room).connected).toBe(true);
    expect(context.room.tickets).toEqual([]);
  });

  it('filters history, malformed and foreign keys, duplicates and imported issues, then sorts numerically and limits to ten', async () => {
    const context = fixture();
    await connected(context);
    await imported(context);
    const before = structuredClone(context.room.snapshot(context.host.id));
    context.request.mockResolvedValueOnce(jsonResponse({ sections: [
      null, { id: 'cs', issues: {} },
      { id: 'hs', issues: [{ key: 'TEAM-1', summaryText: 'History' }] },
      { issues: [{ key: 'TEAM-2', summaryText: 'Missing section id' }] },
      { id: 'cs', issues: [
        null, {}, { key: 12 }, { key: 'TEAM-' }, { key: '<b>TEAM-1</b>' }, { key: 'TEAM-1/2' },
        { key: 'TEAM-7', summaryText: 'Already imported' }, { key: 'OTHER-1' }, { key: 'TEAM_X-1' },
        { key: `TEAM-${'1'.repeat(124)}` },
        ...[100, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 3].map((number) => ({
          key: `TEAM-${number}`, summaryText: `Issue ${number}`,
        })),
        { key: 'team-3', summaryText: 'Duplicate plain summary', summary: '<b>Ignore HTML</b>' },
      ] },
    ] }));
    expect(await context.act('suggest', { query: 'TEAM-' })).toEqual({ suggestions: [
      { key: 'TEAM-3', summary: 'Duplicate plain summary' },
      ...[10, 11, 12, 13, 14, 15, 16, 17, 18].map((number) => ({ key: `TEAM-${number}`, summary: `Issue ${number}` })),
    ] });
    expect(context.room.snapshot(context.host.id)).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });

  it('matches numeric prefixes exactly and never substitutes rendered HTML for missing plain summaries', async () => {
    const context = fixture();
    await connected(context);
    context.request.mockResolvedValueOnce(jsonResponse({ sections: [{ id: 'cs', issues: [
      { key: 'AL-1', summary: '<b>Do not use</b>', keyHtml: 'AL-999' },
      { key: 'AL-10', summaryText: 42 }, { key: 'AL-11', summaryText: 'x'.repeat(300) },
      { key: 'AL-2', summaryText: 'Other prefix' }, { key: 'AL_1-1', summaryText: 'Other project' },
    ] }] }));
    expect(await context.act('suggest', { query: 'AL-1' })).toEqual({ suggestions: [
      { key: 'AL-1', summary: '' }, { key: 'AL-10', summary: '' }, { key: 'AL-11', summary: 'x'.repeat(255) },
    ] });
  });

  it.each([401, 403, 429])('handles upstream %i without mutating the room', async (status) => {
    const context = fixture();
    await connected(context);
    await imported(context);
    const before = structuredClone(context.room.snapshot(context.host.id));
    context.request.mockResolvedValueOnce(jsonResponse({}, status));
    await expect(context.act('suggest', { query: 'AL-' })).rejects.toThrow(
      status === 401 ? 'Jira authorisation expired' : status === 403 ? 'not permitted' : 'rate limiting',
    );
    expect(context.service.status(context.room).connected).toBe(status !== 401);
    expect(context.room.snapshot(context.host.id)).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });

  it('aborts superseded reads and discards late results without blocking an import', async () => {
    const context = fixture();
    await connected(context);
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = context.act('suggest', { query: 'AL-' });
    const signal = context.request.mock.calls.at(-1)![1]!.signal!;
    expect(signal.aborted).toBe(false);
    context.request.mockResolvedValueOnce(jsonResponse({ sections: [{ id: 'cs', issues: [{ key: 'TEAM-2', summaryText: 'Latest' }] }] }));
    expect(await context.act('suggest', { query: 'TEAM-' })).toEqual({ suggestions: [{ key: 'TEAM-2', summary: 'Latest' }] });
    expect(signal.aborted).toBe(true);
    await imported(context);
    const before = structuredClone(context.room.snapshot(context.host.id));
    release(jsonResponse({ sections: [{ id: 'cs', issues: [{ key: 'AL-1', summaryText: 'Stale' }] }] }));
    expect(await pending).toEqual({ suggestions: [] });
    expect(context.room.snapshot(context.host.id)).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });

  it('allows autocomplete while an import holds the mutation lock', async () => {
    const context = fixture();
    await connected(context);
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = context.act('import', { input: 'TEAM-7' });
    context.request.mockResolvedValueOnce(jsonResponse({ sections: [{ id: 'cs', issues: [{ key: 'AL-2', summaryText: 'Existing' }] }] }));
    expect(await context.act('suggest', { query: 'AL-' })).toEqual({ suggestions: [{ key: 'AL-2', summary: 'Existing' }] });
    release(jsonResponse(context.state.issue));
    expect((await pending).ticketId).toBeDefined();
    expect(context.writes()).toHaveLength(0);
  });

  it.each(['disconnect', 'host-change', 'token-rotation', 'expiry', 'room-replaced'] as const)(
    'does not leak a late picker result after %s', async (event) => {
      vi.useFakeTimers();
      const context = fixture();
      await connected(context);
      let release!: (response: Response) => void;
      context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
      const pending = context.act('suggest', { query: 'AL-' });
      const rejected = expect(pending).rejects.toThrow('connection changed or expired');
      const signal = context.request.mock.calls.at(-1)![1]!.signal!;
      if (event === 'disconnect') await context.act('disconnect');
      if (event === 'host-change') context.room.markAway(context.host.id);
      if (event === 'token-rotation') context.room.takeOver(context.host);
      if (event === 'expiry') vi.advanceTimersByTime(3_600_000);
      if (event === 'room-replaced') {
        context.service.clear(context.room);
        expect(context.service.status(new Room(context.room.id)).connected).toBe(false);
      }
      if (event === 'disconnect' || event === 'expiry' || event === 'room-replaced') expect(signal.aborted).toBe(true);
      release(jsonResponse({ sections: [{ id: 'cs', issues: [{ key: 'AL-1', summaryText: 'Private stale issue' }] }] }));
      await rejected;
      expect(signal.aborted).toBe(true);
      expect(context.room.tickets).toEqual([]);
      expect(context.service.status(context.room).connected).toBe(false);
    },
  );

  it('isolates two rooms and selected clouds, including cancellation and imported-key filtering', async () => {
    const context = fixture();
    await connected(context);
    await imported(context);
    const second = new Room('second-room');
    const secondHost = second.add('Second facilitator');
    const flow = await startOAuth(context, second, secondHost.id);
    await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie);
    await context.act('selectSite', { siteId: otherSite.id }, second, secondHost.id);
    context.request.mockClear();
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = context.act('suggest', { query: 'TEAM-' });
    const firstSignal = context.request.mock.calls[0][1]!.signal!;
    context.request.mockImplementationOnce(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(`/ex/jira/${otherSite.id}/rest/api/3/issue/picker`);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-access-token' });
      return jsonResponse({ sections: [{ id: 'cs', issues: [{ key: 'TEAM-7', summaryText: 'Other cloud issue' }] }] });
    });
    expect(await context.act('suggest', { query: 'TEAM-' }, second, secondHost.id)).toEqual({
      suggestions: [{ key: 'TEAM-7', summary: 'Other cloud issue' }],
    });
    await context.act('disconnect', {}, second, secondHost.id);
    expect(firstSignal.aborted).toBe(false);
    expect(new URL(String(context.request.mock.calls[0][0])).pathname).toBe(`/ex/jira/${site.id}/rest/api/3/issue/picker`);
    release(jsonResponse({ sections: [{ id: 'cs', issues: [
      { key: 'TEAM-7', summaryText: 'Imported here' }, { key: 'TEAM-8', summaryText: 'First cloud issue' },
    ] }] }));
    expect(await pending).toEqual({ suggestions: [{ key: 'TEAM-8', summary: 'First cloud issue' }] });
    expect(context.room.tickets).toHaveLength(1);
    expect(second.tickets).toEqual([]);
    expect(context.writes()).toHaveLength(0);
  });
});

describe('Jira import contracts', () => {
  it.each(['team-7', ' TEAM-7 ', `${site.url}/browse/team-7`])('parses an allowed issue input: %s', (input) => {
    expect(parseJiraIssueKey(input, site.url)).toBe('TEAM-7');
  });

  it.each([
    `${otherSite.url}/browse/TEAM-7`, 'https://team.atlassian.net.evil.example/browse/TEAM-7',
    'http://team.atlassian.net/browse/TEAM-7', 'https://user:pass@team.atlassian.net/browse/TEAM-7',
    `${site.url}/rest/api/3/issue/TEAM-7`, `${site.url}/browse/TEAM-7/extra`, 'TEAM', 'TEAM-7/8',
  ])('rejects invalid or foreign issue input without network: %s', async (input) => {
    const context = fixture();
    await connected(context);
    context.request.mockClear();
    await expect(context.act('import', { input })).rejects.toThrow('Provide an issue key or Jira issue URL');
    expect(context.request).not.toHaveBeenCalled();
    expect(context.room.tickets).toEqual([]);
  });

  it.each([101, 255])('preserves an exact %i-character summary and rich ADF beyond manual limits', async (length) => {
    const context = fixture();
    await connected(context);
    const description = { type: 'doc', version: 1, content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Long description '.repeat(60), marks: [{ type: 'strong' }] },
        { type: 'mention', attrs: { id: 'fixture-person', text: '@Person' } },
      ] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
        { type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: 'sample' }] },
      ] }] }] },
    ] };
    context.state.issue.fields.summary = ` ${'x'.repeat(length - 2)} `;
    context.state.issue.fields.description = description;
    const ticket = await imported(context);
    expect(ticket.title).toBe(context.state.issue.fields.summary);
    expect(ticket.descriptionAdf).toEqual(description);
    expect(ticket.jira).toEqual({ cloudId: site.id, issueId: '10001', key: 'TEAM-7', url: `${site.url}/browse/TEAM-7` });
    expect(context.room.snapshot(context.member.id).tickets[0]).toEqual(ticket);
    const before = structuredClone(ticket);
    expect(context.room.editTicket(context.host.id, ticket.id, 'Changed', 'Changed', 'spike')).toBe('Imported Jira details are read-only');
    expect(ticket).toEqual(before);
    await expect(context.act('import', { input: `${site.url}/browse/TEAM-7` })).rejects.toThrow('already in the room');
    expect(context.room.tickets).toHaveLength(1);
    expect(context.writes()).toHaveLength(0);
  });

  it.each(['Story', 'sToRy', 'Spike', 'SPIKE', 'Bug', 'bUg', 'Task', 'TASK'])('maps %s explicitly and normalises null description', async (type) => {
    const context = fixture();
    await connected(context);
    context.state.issue.fields.issuetype.name = type;
    const ticket = await imported(context);
    expect(ticket.type).toBe(type.toLowerCase());
    expect(ticket.descriptionAdf).toEqual({ type: 'doc', version: 1, content: [] });
  });

  it.each(['Epic', ''])('rejects unmapped %s atomically', async (type) => {
    const context = fixture();
    await connected(context);
    context.state.issue.fields.issuetype.name = type;
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('Only Story, Spike, Bug and Task are supported');
    expect(context.room.tickets).toEqual([]);
  });

  it('rejects a 256-character summary, malformed ADF and the eleventh ticket without mutation', async () => {
    const context = fixture();
    await connected(context);
    context.state.issue.fields.summary = 'x'.repeat(256);
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('exceeds 255 characters');
    context.state.issue.fields.summary = 'Valid summary';
    context.state.issue.fields.description = { type: 'doc', version: 2, content: [] };
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('Jira description is invalid');
    expect(context.room.tickets).toEqual([]);
    context.state.issue.fields.description = null;
    for (let index = 0; index < 10; index += 1) {
      expect(context.room.addTicket(context.host.id, { type: 'story', title: `Manual ${index}`, description: '' })).toBeNull();
    }
    const before = structuredClone(context.room.tickets);
    await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('at most 10 tickets');
    expect(context.room.tickets).toEqual(before);
    expect(context.room.editTicket(context.host.id, before[0].id, 'Manual edit', '')).toBeNull();
  });
});

describe('explicit agreed estimates and guarded Jira writes', () => {
  it('requires an explicit estimate, previews old and new values, and writes only the bound issue and field', async () => {
    const context = fixture();
    await connected(context);
    const ticket = await imported(context);
    context.room.selectTicket(context.host.id, ticket.id);
    context.room.vote(context.host.id, '2', context.room.round);
    context.room.vote(context.member.id, '13', context.room.round);
    await expect(context.act('agree', { ticketId: ticket.id, points: 8 })).rejects.toThrow('Reveal this story');
    context.room.reveal(context.host.id);
    expect(ticket.agreedEstimate).toBeUndefined();
    await expect(context.act('prepare', { ticketId: ticket.id })).rejects.toThrow('Choose and agree a numeric story-deck value first');
    await context.act('agree', { ticketId: ticket.id, points: 8 });
    const votes = structuredClone(ticket.result);
    const { preview } = await context.act('prepare', { ticketId: ticket.id });
    expect(preview).toEqual({
      id: expect.any(String), issueKey: 'TEAM-7', issueUrl: `${site.url}/browse/TEAM-7`,
      siteName: site.name, fieldId: 'customfield_10123', fieldName: 'Story Points', currentPoints: 3, points: 8,
    });
    expect(context.writes()).toHaveLength(0);
    const parsed = parseClientMessage(JSON.stringify(message('confirm', {
      confirmationId: preview!.id, ticketId: 'foreign-ticket', fieldId: 'customfield_unrelated', points: 13,
    })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== 'jira') throw new Error('Expected parsed Jira confirmation');
    expect(parsed.message).toEqual(message('confirm', { confirmationId: preview!.id }));
    expect(await context.service.action(context.room, context.host.id, parsed.message)).toEqual({ written: true });
    const writes = context.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(`https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/issue/10001`);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ fields: { customfield_10123: 8 } });
    expect(writes[0][1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-access-token' });
    expect(ticket.agreedEstimate).toBe(8);
    expect(ticket.result).toEqual(votes);
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('already used');
    expect(context.writes()).toHaveLength(1);
  });

  it.each([0, -1, 4, 7.5, 21, NaN, Infinity, 'coffee', '8', null])('rejects a non-deck agreed value (%s) at service and parser boundaries', async (points) => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    expect(parseClientMessage(JSON.stringify(message('agree', { ticketId: ticket.id, points }))).ok).toBe(false);
    await expect(context.act('agree', { ticketId: ticket.id, points })).rejects.toThrow('Choose a numeric value from the story deck');
    expect(ticket).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });

  it.each([1, 2, 3, 5, 8, 13, 20])('accepts explicit story deck value %i without deriving an average', async (points) => {
    const context = fixture();
    const ticket = await agreed(context);
    await context.act('agree', { ticketId: ticket.id, points });
    expect(ticket.agreedEstimate).toBe(points);
    expect(ticket.result?.votes).toEqual({ [context.host.id]: '2', [context.member.id]: '13' });
    expect(context.writes()).toHaveLength(0);
  });

  it.each(['spike', 'manual'] as const)('rejects agreement and preparation for %s tickets', async (kind) => {
    const context = fixture();
    await connected(context);
    let ticket;
    if (kind === 'spike') {
      context.state.issue.fields.issuetype.name = 'Spike';
      ticket = await imported(context);
    } else {
      context.room.addTicket(context.host.id, { type: 'story', title: 'Manual', description: '' });
      ticket = context.room.tickets[0];
    }
    context.room.selectTicket(context.host.id, ticket.id);
    context.room.reveal(context.host.id);
    for (const action of ['agree', 'prepare'] as const) {
      await expect(context.act(action, { ticketId: ticket.id, points: 8 })).rejects.toThrow('Only linked stories');
    }
    expect(context.writes()).toHaveLength(0);
  });

  it.each(['bug', 'task'] as const)('allows agreement and preparation for linked %s tickets', async (type) => {
    const context = fixture();
    await connected(context);
    context.state.issue.fields.issuetype.name = type;
    const ticket = await imported(context);
    context.room.selectTicket(context.host.id, ticket.id);
    context.room.vote(context.host.id, '8', context.room.round);
    context.room.reveal(context.host.id);
    await expect(context.act('agree', { ticketId: ticket.id, points: 8 })).resolves.toEqual({ ticketId: ticket.id });
    expect(ticket.agreedEstimate).toBe(8);
    const { preview } = await context.act('prepare', { ticketId: ticket.id });
    expect(preview).toMatchObject({ fieldId: 'customfield_10123', points: 8 });
  });

  it.each(['missing', 'read-only', 'wrong-schema', 'unrelated-name'] as const)('rejects %s points metadata without changing estimates', async (kind) => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    if (kind === 'missing') context.state.fields = [];
    if (kind === 'read-only') context.state.editable.customfield_10123.operations = ['add'];
    if (kind === 'wrong-schema') context.state.fields[0].schema.type = 'string';
    if (kind === 'unrelated-name') context.state.fields[0].name = 'Business value';
    await expect(context.act('prepare', { ticketId: ticket.id })).rejects.toThrow('No editable story-points field');
    expect(ticket).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });

  it('returns only eligible candidates for ambiguous metadata and never guesses a field', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    context.state.fields.push(
      { id: 'customfield_10124', name: 'Story point estimate', schema: { type: 'number' } },
      { id: 'customfield_noise', name: 'Customer value', schema: { type: 'number' } },
      { id: 'customfield_locked', name: 'Story Points', schema: { type: 'number' } },
    );
    context.state.editable.customfield_10124 = { operations: ['set'] };
    context.state.editable.customfield_noise = { operations: ['set'] };
    expect(await context.act('prepare', { ticketId: ticket.id })).toEqual({ fields: [
      { id: 'customfield_10123', name: 'Story Points' },
      { id: 'customfield_10124', name: 'Story point estimate' },
    ] });
    await expect(context.act('prepare', { ticketId: ticket.id, fieldId: 'customfield_noise' })).rejects.toThrow('not editable');
    const { preview } = await context.act('prepare', { ticketId: ticket.id, fieldId: 'customfield_10123' });
    expect(preview?.fieldId).toBe('customfield_10123');
    expect(context.writes()).toHaveLength(0);
  });

  it('previews null points without coercion', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    context.state.points = null;
    expect((await context.act('prepare', { ticketId: ticket.id })).preview?.currentPoints).toBeNull();
    expect(context.writes()).toHaveLength(0);
  });

  it('rejects external points races, consumes the confirmation, and requires a fresh read and preview', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    const { preview } = await context.act('prepare', { ticketId: ticket.id });
    context.state.points = 5;
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('Jira points changed since the preview');
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('already used');
    expect(context.writes()).toHaveLength(0);
    expect(ticket.agreedEstimate).toBe(8);
    const fresh = await context.act('prepare', { ticketId: ticket.id });
    expect(fresh.preview?.currentPoints).toBe(5);
    expect(fresh.preview?.id).not.toBe(preview!.id);
  });

  it.each(['unknown-id', 'reset', 'new-estimate', 'switch', 'remove', 'field-locked', 'expired'] as const)(
    'invalidates confirmation for %s before PUT', async (event) => {
      vi.useFakeTimers();
      const context = fixture();
      const ticket = await agreed(context);
      const { preview } = await context.act('prepare', { ticketId: ticket.id });
      if (event === 'reset') context.room.reset(context.host.id);
      if (event === 'new-estimate') await context.act('agree', { ticketId: ticket.id, points: 5 });
      if (event === 'switch') {
        context.room.addTicket(context.host.id, { type: 'story', title: 'Another story', description: '' });
        context.room.selectTicket(context.host.id, context.room.tickets[1].id);
      }
      if (event === 'remove') context.room.removeTicket(context.host.id, ticket.id);
      if (event === 'field-locked') context.state.editable = {};
      if (event === 'expired') vi.advanceTimersByTime(120_000);
      const expected = {
        'unknown-id': 'Confirmation expired or was already used', reset: 'Reveal this story',
        'new-estimate': 'Confirmation expired or was already used', switch: 'Reveal this story',
        remove: 'Only linked stories', 'field-locked': 'no longer editable', expired: 'Confirmation expired or was already used',
      }[event];
      await expect(context.act('confirm', { confirmationId: event === 'unknown-id' ? 'unknown' : preview!.id })).rejects.toThrow(expected);
      expect(context.writes()).toHaveLength(0);
    },
  );

  it.each([403, 404, 429])('preserves local results and estimate after a definite PUT rejection (%i)', async (status) => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    const { preview } = await context.act('prepare', { ticketId: ticket.id });
    const normal = context.request.getMockImplementation()!;
    context.request.mockImplementation((input, init) => init?.method === 'PUT'
      ? Promise.resolve(jsonResponse({}, status)) : normal(input, init));
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow(
      status === 403 ? 'not permitted' : status === 404 ? 'not found' : 'rate limiting',
    );
    expect(ticket).toEqual(before);
    expect(context.writes()).toHaveLength(1);
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('already used');
    expect(context.writes()).toHaveLength(1);
  });

  it.each(['network', 'timeout', 'verification-mismatch', 'verification-failure'] as const)(
    'marks %s after PUT uncertain, never retries automatically, and explicitly prepares with a fresh read', async (failure) => {
      const context = fixture();
      const ticket = await agreed(context);
      const before = structuredClone(ticket);
      const { preview } = await context.act('prepare', { ticketId: ticket.id });
      const normal = context.request.getMockImplementation()!;
      let written = false;
      context.request.mockImplementation(async (input, init) => {
        if (init?.method === 'PUT') {
          written = true;
          if (failure === 'network' || failure === 'timeout') {
            context.state.points = 8;
            if (failure === 'network') throw new TypeError('Fixture network loss');
            throw new DOMException('Fixture timeout', 'TimeoutError');
          }
          if (failure === 'verification-mismatch') return new Response(null, { status: 204 });
        } else if (written && failure === 'verification-failure') {
          throw new TypeError('Fixture verification failure');
        }
        return normal(input, init);
      });
      expect(await context.act('confirm', { confirmationId: preview!.id })).toEqual({ written: false, uncertain: true });
      expect(ticket).toEqual(before);
      expect(context.writes()).toHaveLength(1);
      const calls = context.request.mock.calls.length;
      await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('already used');
      expect(context.request).toHaveBeenCalledTimes(calls);
      context.request.mockImplementation(normal);
      const fresh = await context.act('prepare', { ticketId: ticket.id });
      expect(context.request).toHaveBeenCalledTimes(calls + 3);
      expect(fresh.preview?.currentPoints).toBe(context.state.points);
      expect(fresh.preview?.id).not.toBe(preview!.id);
      expect(context.writes()).toHaveLength(1);
    },
  );

  it.each(['permission', 'network', 'invalid-json'] as const)('preserves the agreed estimate on pre-write %s failures', async (failure) => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    if (failure === 'permission') context.request.mockResolvedValueOnce(jsonResponse({}, 403));
    if (failure === 'network') context.request.mockRejectedValueOnce(new TypeError('Fixture network failure'));
    if (failure === 'invalid-json') context.request.mockResolvedValueOnce(new Response('{invalid'));
    await expect(context.act('prepare', { ticketId: ticket.id })).rejects.toThrow(
      failure === 'permission' ? 'not permitted' : 'could not be reached or returned an invalid response',
    );
    expect(ticket).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });
});

describe('Jira safety bounds and asynchronous invalidation', () => {
  it.each([262_144, 262_145])('handles exactly %i serialized ADF bytes without truncation', async (bytes) => {
    const context = fixture();
    await connected(context);
    const document = { type: 'doc', version: 1, content: [{ type: 'text', text: '' }] };
    document.content[0].text = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(document)));
    expect(Buffer.byteLength(JSON.stringify(document))).toBe(bytes);
    context.state.issue.fields.description = document;
    if (bytes === 262_144) {
      expect((await imported(context)).descriptionAdf).toEqual(document);
    } else {
      await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('256 KiB safety limit');
      expect(context.room.tickets).toEqual([]);
    }
  });

  it.each([64, 65])('handles ADF depth %i at the declared nesting boundary', async (depth) => {
    const context = fixture();
    await connected(context);
    let node: { type: string; content?: unknown[]; text?: string } = { type: 'text', text: 'Nested' };
    for (let index = 1; index < depth; index += 1) node = { type: 'paragraph', content: [node] };
    const document = { type: 'doc', version: 1, content: [node] };
    context.state.issue.fields.description = document;
    if (depth === 64) expect((await imported(context)).descriptionAdf).toEqual(document);
    else {
      await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('nesting safety limit');
      expect(context.room.tickets).toEqual([]);
    }
  });

  it.each([20_000, 20_001])('handles %i ADF nodes at the declared count boundary', async (count) => {
    const context = fixture();
    await connected(context);
    const document = { type: 'doc', version: 1, content: Array.from({ length: count - 1 }, () => ({ type: 'x' })) };
    expect(Buffer.byteLength(JSON.stringify(document))).toBeLessThan(262_144);
    context.state.issue.fields.description = document;
    if (count === 20_000) expect((await imported(context)).descriptionAdf).toEqual(document);
    else {
      await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('nesting safety limit');
      expect(context.room.tickets).toEqual([]);
    }
  });

  it.each(['disconnect', 'host-change', 'token-rotation', 'expiry'] as const)(
    'does not import an in-flight response after %s', async (event) => {
      vi.useFakeTimers();
      const context = fixture();
      await connected(context);
      let release!: (response: Response) => void;
      context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
      const pending = context.act('import', { input: 'TEAM-7' });
      const rejected = expect(pending).rejects.toThrow('connection changed or expired');
      await expect(context.act('import', { input: 'TEAM-7' })).rejects.toThrow('already in progress');
      if (event === 'disconnect') await context.act('disconnect');
      if (event === 'host-change') context.room.markAway(context.host.id);
      if (event === 'token-rotation') context.room.takeOver(context.host);
      if (event === 'expiry') vi.advanceTimersByTime(3_600_000);
      release(jsonResponse(context.state.issue));
      await rejected;
      expect(context.room.tickets).toEqual([]);
      expect(context.service.status(context.room).connected).toBe(false);
    },
  );

  it('rechecks ticket capacity after the import response arrives', async () => {
    const context = fixture();
    await connected(context);
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = context.act('import', { input: 'TEAM-7' });
    const rejected = expect(pending).rejects.toThrow('at most 10 tickets');
    for (let index = 0; index < 10; index += 1) {
      context.room.addTicket(context.host.id, { type: 'story', title: `Manual ${index}`, description: '' });
    }
    release(jsonResponse(context.state.issue));
    await rejected;
    expect(context.room.tickets).toHaveLength(10);
    expect(context.room.tickets.every((ticket) => !ticket.jira)).toBe(true);
  });

  it('does not resurrect a disconnected session when token exchange completes late', async () => {
    const context = fixture();
    const flow = await startOAuth(context);
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const callback = http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie);
    await context.act('disconnect');
    release(jsonResponse({ access_token: 'fixture-access-token', expires_in: 3600 }));
    expect((await callback).status).toBe(400);
    expect(context.request).toHaveBeenCalledTimes(1);
    expect(context.service.status(context.room).connected).toBe(false);
  });

  it('serializes double confirmation clicks and sends at most one PUT', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    const { preview } = await context.act('prepare', { ticketId: ticket.id });
    let release!: (response: Response) => void;
    context.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = context.act('confirm', { confirmationId: preview!.id });
    await expect(context.act('confirm', { confirmationId: preview!.id })).rejects.toThrow('already in progress');
    release(jsonResponse(context.state.fields));
    expect(await pending).toEqual({ written: true });
    expect(context.writes()).toHaveLength(1);
  });

  it('rejects a linked story after reconnecting to a different authorised cloud', async () => {
    const context = fixture();
    const ticket = await agreed(context);
    const before = structuredClone(ticket);
    await context.act('disconnect');
    context.state.resources = [{ ...otherSite, scopes }];
    const flow = await startOAuth(context);
    expect((await http(context.service, `/jira/oauth/callback?state=${flow.state}&code=fixture-code`, flow.cookie)).status).toBe(200);
    for (const action of ['agree', 'prepare'] as const) {
      await expect(context.act(action, { ticketId: ticket.id, points: 8 })).rejects.toThrow("Reconnect to this ticket's Jira site");
    }
    expect(ticket).toEqual(before);
    expect(context.writes()).toHaveLength(0);
  });
});

describe('Jira socket and HTTP boundaries', () => {
  it.each(['room close and ID reuse', 'server shutdown and restart'] as const)(
    'forgets connected access and pending OAuth after %s', async (lifecycle) => {
      const context = fixture();
      context.state.resources = [{ ...site, scopes }];
      vi.stubGlobal('fetch', context.request);
      const options = { jira: jiraConfig, roomCloseGraceMs: 10, shutdownGraceMs: 100 };
      let server = await startServer(options);
      const servers = new Set([server.app]);
      const clients: TestClient[] = [];
      const roomIds = ['lifecycle-access', 'lifecycle-callback', 'lifecycle-start'];
      const join = async (roomId: string) => {
        const client = await connect(server.port, { room: roomId, name: 'Facilitator' });
        clients.push(client);
        await client.next('welcome');
        return client;
      };
      const begin = async (client: TestClient) => {
        client.send(message('connect'));
        const connection = await client.next('jira');
        expect(connection.ok).toBe(true);
        const url = new URL(connection.data.authorizeUrl);
        return `${url.pathname}${url.search}`;
      };
      const start = async (path: string) => {
        const response = await localFetch(`http://127.0.0.1:${server.port}${path}`, { redirect: 'manual' });
        expect(response.status).toBe(302);
        const state = new URL(response.headers.get('location')!).searchParams.get('state');
        const cookie = response.headers.get('set-cookie')!.split(';')[0];
        return { path: `/jira/oauth/callback?state=${state}&code=fixture-code`, cookie };
      };
      const callback = (flow: { path: string; cookie: string }) => localFetch(
        `http://127.0.0.1:${server.port}${flow.path}`, { headers: { Cookie: flow.cookie } },
      );
      try {
        const host = await join(roomIds[0]);
        const completed = await start(await begin(host));
        expect((await callback(completed)).status).toBe(200);
        host.send(message('import', { input: 'TEAM-7' }));
        expect(await host.next('jira')).toMatchObject({ ok: true, data: { ticketId: expect.any(String) } });
        host.send(message('status'));
        expect(await host.next('jira')).toMatchObject({ ok: true, data: { status: { connected: true } } });
        const pending = await start(await begin(await join(roomIds[1])));
        const unusedStart = await begin(await join(roomIds[2]));

        if (lifecycle === 'room close and ID reuse') {
          await Promise.all(clients.map((client) => client.close()));
          await vi.waitFor(async () => {
            for (const roomId of roomIds) {
              const response = await localFetch(`http://127.0.0.1:${server.port}/rooms/${roomId}`);
              expect(await response.json()).toMatchObject({ exists: false });
            }
          }, { timeout: 2_000, interval: 10 });
        } else {
          await server.app.shutdown();
          servers.delete(server.app);
          server = await startServer(options);
          servers.add(server.app);
        }

        const calls = context.request.mock.calls.length;
        for (const roomId of roomIds) {
          const replacement = await join(roomId);
          expect(await replacement.next('state')).toMatchObject({ tickets: [] });
          replacement.send(message('status'));
          expect(await replacement.next('jira')).toMatchObject({
            ok: true, data: { status: { available: true, connected: false } },
          });
          replacement.send(message('import', { input: 'TEAM-7' }));
          expect(await replacement.next('jira')).toMatchObject({ ok: false, error: expect.stringContaining('Connect Jira first') });
        }
        expect((await callback(completed)).status).toBe(400);
        expect((await callback(pending)).status).toBe(400);
        expect((await localFetch(`http://127.0.0.1:${server.port}${unusedStart}`, { redirect: 'manual' })).status).toBe(400);
        expect(context.request).toHaveBeenCalledTimes(calls);
      } finally {
        try {
          await Promise.all(clients.map((client) => client.close()));
        } finally {
          await Promise.all([...servers].map((app) => app.shutdown()));
        }
      }
    },
  );

  it('keeps Jira responses private, blocks spoofed socket roles and legacy routes, and invalidates OAuth on host disconnect', async () => {
    const context = fixture();
    context.state.resources = [{ ...site, scopes }];
    vi.stubGlobal('fetch', context.request);
    const { app, port } = await startServer({ jira: jiraConfig, shutdownGraceMs: 100 });
    const clients: TestClient[] = [];
    try {
      const host = await connect(port, { room: 'socket-room', name: 'Facilitator' });
      clients.push(host);
      const welcome = await host.next('welcome');
      const member = await connect(port, { room: 'socket-room', name: 'Participant' });
      clients.push(member);
      const memberWelcome = await member.next('welcome');
      const foreign = await connect(port, { room: 'foreign-room', name: 'Foreign facilitator' });
      clients.push(foreign);
      const foreignWelcome = await foreign.next('welcome');
      const observed: unknown[][] = [[], [], []];
      clients.forEach((client, index) => client.ws.on('message', (raw) => observed[index].push(JSON.parse(raw.toString()))));
      for (const action of ['status', 'connect', 'disconnect', 'selectSite', 'import', 'suggest', 'agree', 'prepare', 'confirm'] as const) {
        member.send(message(action, {
          userId: welcome.userId, siteId: site.id, input: 'TEAM-7', query: 'AL-', ticketId: 'ticket', points: 8, confirmationId: 'confirmation',
        }));
        expect(await member.next('jira')).toMatchObject({ ok: false, error: 'Only the facilitator can use Jira' });
      }
      expect(context.request).not.toHaveBeenCalled();
      host.send(message('connect'));
      const connection = await host.next('jira');
      expect(connection.ok).toBe(true);
      const startUrl = new URL(connection.data.authorizeUrl);
      const start = await localFetch(`http://127.0.0.1:${port}${startUrl.pathname}${startUrl.search}`, { redirect: 'manual' });
      expect(start.status).toBe(302);
      const state = new URL(start.headers.get('location')!).searchParams.get('state');
      const cookie = start.headers.get('set-cookie')!.split(';')[0];
      const callback = await localFetch(`http://127.0.0.1:${port}/jira/oauth/callback?state=${state}&code=fixture-code`, {
        headers: { Cookie: cookie },
      });
      expect(callback.status).toBe(200);
      host.send(message('import', { input: 'TEAM-7' }));
      expect(await host.next('jira')).toMatchObject({ ok: true, data: { ticketId: expect.any(String) } });
      let shared = await member.next('state');
      while (!shared.tickets.length) shared = await member.next('state');
      expect(shared.tickets[0]).toMatchObject({ title: 'Imported story', jira: { key: 'TEAM-7' } });
      foreign.send(message('status', { room: 'socket-room' }));
      expect(await foreign.next('jira')).toMatchObject({ ok: true, data: { status: { available: true, connected: false } } });
      member.send(message('status'));
      await member.next('jira');
      expect(observed[1].some((value) => (value as { type: string }).type === 'jiraStatus')).toBe(false);
      expect(observed[2].some((value) => (value as { type: string }).type === 'jiraStatus')).toBe(false);
      const publicData = JSON.stringify(observed);
      for (const secret of ['fixture-access-token', jiraConfig.clientSecret, welcome.token, memberWelcome.token, foreignWelcome.token]) {
        expect(publicData.includes(secret)).toBe(false);
      }
      expect(JSON.stringify(observed.slice(1)).includes(connection.data.authorizeUrl)).toBe(false);
      for (const [path, method] of [
        ['/jira/ticket?key=TEAM-7', 'GET'], ['/jira/ticket/TEAM-7/story-points', 'PUT'], ['/jira/oauth/start', 'POST'],
      ]) {
        expect((await localFetch(`http://127.0.0.1:${port}${path}`, { method })).status).toBe(404);
      }
      host.send(message('connect'));
      const pending = await host.next('jira');
      const pendingUrl = new URL(pending.data.authorizeUrl);
      const pendingStart = await localFetch(`http://127.0.0.1:${port}${pendingUrl.pathname}${pendingUrl.search}`, { redirect: 'manual' });
      const pendingState = new URL(pendingStart.headers.get('location')!).searchParams.get('state');
      const pendingCookie = pendingStart.headers.get('set-cookie')!.split(';')[0];
      await host.close();
      let promoted = await member.next('state');
      while (promoted.hostId !== memberWelcome.userId) promoted = await member.next('state');
      const calls = context.request.mock.calls.length;
      expect((await localFetch(`http://127.0.0.1:${port}/jira/oauth/callback?state=${pendingState}&code=fixture-code`, {
        headers: { Cookie: pendingCookie },
      })).status).toBe(400);
      expect(context.request).toHaveBeenCalledTimes(calls);
      member.send(message('status'));
      expect(await member.next('jira')).toMatchObject({ ok: true, data: { status: { connected: false } } });
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await app.shutdown();
    }
  });
});