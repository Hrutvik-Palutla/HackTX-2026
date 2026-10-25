// Synthetic, credential-redacted comparison of Meta's DNS routes and HTTP transports.
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';

const hostname = 'api.meta.ai';
const model = process.env.MUSE_MODEL ?? 'muse-spark-1.3';
const key = process.env.MODEL_API_KEY ?? '';
const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK.' }] });
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const addresses = await lookup(hostname, { all: true });
console.log(JSON.stringify({ probe: 'network-runtime', runtime: process.version, location: process.env.GITHUB_ACTIONS ? 'github-runner' : 'worker',
  revision: process.env.SOURCE_REVISION, model, addresses,
  credentialMatchesDeployment: process.argv[2] ? createHash('sha256').update(key).digest('hex') === process.argv[2] : undefined,
  proxyConfigured: ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].some(name => !!process.env[name]), nodeEnvProxy: process.env.NODE_USE_ENV_PROXY ?? 'unset' }));

async function probe(name, path, address, requestedModel = model) {
  await new Promise(resolve => {
    const options = { hostname, path, method: path === '/v1/models' ? 'GET' : 'POST', headers, agent: false, timeout: 20000 };
    if (address) {
      options.family = address.family;
      options.autoSelectFamily = false;
      options.lookup = (_host, opts, callback) => opts.all ? callback(null, [address]) : callback(null, address.address, address.family);
    }
    const request = https.request(options, response => {
      const remoteAddress = response.socket.remoteAddress;
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let result;
        try { result = JSON.parse(text); } catch { result = {}; }
        console.log(JSON.stringify({ probe: name, transport: 'https', remoteAddress, requestedModel, status: response.statusCode,
          requestId: response.headers['x-request-id'], server: response.headers.server, via: response.headers.via,
          edge: response.headers['cf-ray'], cache: response.headers['x-cache'], model: result.model,
          models: result.data?.map(item => item.id), error: result.error }));
        resolve();
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out.')));
    request.on('error', error => { console.log(JSON.stringify({ probe: name, transport: 'https', address, transportError: error.code ?? error.message })); resolve(); });
    if (options.method === 'POST') request.write(JSON.stringify({ model: requestedModel, messages: [{ role: 'user', content: 'Reply OK.' }] }));
    request.end();
  }).catch(error => console.log(JSON.stringify({ probe: name, transportError: error.message })));
}

await probe('default-catalog', '/v1/models');
for (let index = 1; index <= 3; index++) await probe(`default-completion-${index}`, '/v1/chat/completions');
for (const address of addresses.slice(0, 4)) {
  await probe(`pinned-catalog-${address.address}`, '/v1/models', address);
  await probe(`pinned-completion-${address.address}`, '/v1/chat/completions', address);
}
for (let index = 1; index <= 2; index++) {
  try {
    const response = await fetch(`https://${hostname}/v1/chat/completions`, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    console.log(JSON.stringify({ probe: `fetch-completion-${index}`, transport: 'fetch', status: response.status,
      requestId: response.headers.get('x-request-id'), server: response.headers.get('server'), model: result.model, error: result.error }));
  } catch (error) { console.log(JSON.stringify({ probe: `fetch-completion-${index}`, transportError: error.message })); }
}
for (const alternative of ['muse-spark-1.2', 'muse-spark-1.1', 'muse-wonder-1.0']) {
  for (let index = 1; index <= 2; index++) await probe(`alternative-${alternative}-${index}`, '/v1/chat/completions', undefined, alternative);
}
