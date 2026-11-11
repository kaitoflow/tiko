import { } from 'node:module';

const servicePath = '/aiserver.v1.GrokBotService/';
const acceptedNames = new Set(['ACCEPTED_BOX', 'ACCEPTED_TEMPORAL', 'DUPLICATE']);
function allowed(url, suffixes) {
  return url.protocol === 'https:' && !url.username && !url.password &&
    (!url.port || url.port === '443') && suffixes.some(s => url.hostname === s || url.hostname.endsWith('.' + s));
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}
function deliveryName(value) {
  if (typeof value === 'number') return [null, 'ACCEPTED_BOX', 'ACCEPTED_TEMPORAL', 'DUPLICATE', 'REFUSED'][value];
  return typeof value === 'string' ? value.replace(/^GROK_BOT_USER_MESSAGE_DELIVERY_/, '') : null;
}

// Grok Bot 0.78.5's native dispatcher sends person-scoped prompts through
// SendGrokBotUserMessage with the selected account's user authentication.
// A gateway/SandBox token is only suitable for the legacy box API.
// Observe the upstream CLI's successful EnsureSandBox request in memory; never
// read, write or log credentials here, and never replay a prompt on failure.
export function createPersonSendFetch(fetchImpl, {explicitGateway = false, now = Date.now} = {}) {
  let route = null;
  return async function personSendFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const headers = new Headers(init.headers);
    if (!explicitGateway && url.pathname === servicePath + 'EnsureSandBox' &&
        allowed(url, ['cursor.sh', 'cursor.com']) && init.method === 'POST') {
      route = null;
      const response = await fetchImpl(input, init);
      const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(headers.get('x-cursor-client-version') ?? '');
      if (response.ok && version && (Number(version[1]) > 0 || Number(version[2]) >= 78)) {
        const data = await response.clone().json();
        const gateway = new URL(data.gatewayUrl ?? data.gateway_url);
        if (allowed(gateway, ['cursor.sh', 'cursor.com', 'cursorvm.com']) &&
            !gateway.search && !gateway.hash && headers.has('authorization')) {
          const accountHeaders = new Headers();
          for (const key of ['authorization', 'connect-protocol-version', 'content-type',
            'x-cursor-client-type', 'x-cursor-client-version', 'x-cursor-team-id', 'x-sand-box-namespace']) {
            if (headers.has(key)) accountHeaders.set(key, headers.get(key));
          }
          route = {sendUrl: gateway.href.replace(/\/$/, '') + '/api/sendPrompt',
            backend: url.origin, accountHeaders};
        }
      }
      return response;
    }
    if (!route || url.href !== route.sendUrl || init.method !== 'POST') return fetchImpl(input, init);
    let prompt;
    try { prompt = JSON.parse(init.body); } catch { return json({message: 'Invalid prompt JSON'}, 400); }
    if (!prompt || typeof prompt.agentId !== 'string' || !prompt.agentId ||
        typeof prompt.prompt !== 'string' || !prompt.prompt ||
        typeof prompt.clientNonce !== 'string' || !prompt.clientNonce ||
        Object.keys(prompt).some(k => !['agentId', 'prompt', 'clientNonce', 'replyToId'].includes(k)) ||
        (prompt.replyToId !== undefined && typeof prompt.replyToId !== 'string')) {
      return json({message: 'Unsupported prompt fields for the native person-send adapter'}, 400);
    }
    const request = {agentId: prompt.agentId, messageId: prompt.clientNonce,
      text: prompt.prompt, sentAtMs: String(now()), sessionId: ''};
    if (prompt.replyToId !== undefined) request.replyToId = prompt.replyToId;
    const response = await fetchImpl(route.backend + servicePath + 'SendGrokBotUserMessage', {
      method: 'POST', redirect: 'error', signal: init.signal,
      headers: route.accountHeaders, body: JSON.stringify(request),
    });
    if (!response.ok) return response;
    const result = await response.json();
    const delivery = deliveryName(result.delivery);
    if (delivery === 'REFUSED') return json({message: result.refusal?.message ?? 'Prompt refused by Grok Bot',
      failureCode: result.refusal?.failureCode ?? null}, 403);
    if (!acceptedNames.has(delivery)) return json({message: 'Native prompt delivery unconfirmed; inspect this clientNonce before any retry'}, 502);
    // The backend's accepted message_id is the original clientNonce. Keep the
    // acknowledgment explicit; the CLI can still correlate it with its transcript.
    return json({accepted: true, messageId: prompt.clientNonce, nativeDelivery: delivery});
  };
}

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = createPersonSendFetch(globalThis.fetch, {
    explicitGateway: Boolean(process.env.GROK_BOT_GATEWAY_URL || process.env.GROK_BOT_GATEWAY_TOKEN),
  });
}
