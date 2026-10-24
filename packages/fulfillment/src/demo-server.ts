/** Loopback-only fake-money console. Production uses the authenticated Next route adapters. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { FileRepository } from './file-repository.ts';
import { createTestHarness, testActor } from './test-fixture.ts';
import { handlePart4 } from './http.ts';
import type { Part4Runtime, Part4Action } from './http.ts';

const port = Number(process.env.PART4_DEMO_PORT ?? 4444);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid demo port.');
const origin = `http://127.0.0.1:${port}`;
const repository = await FileRepository.load(resolve(process.env.PART4_DEMO_DATA ?? '../../.part4-data/demo.json'));
const harness = createTestHarness({ repository });
const tokens = Object.fromEntries(['buyer', 'mark', 'mel'].map(user => [user, randomBytes(24).toString('hex')]));
const users = new Map(Object.entries(tokens).map(([user, token]) => [token, user]));
const runtime: Part4Runtime = {
  service: harness.service,
  authenticate: async request => { const user = users.get(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''); return user ? testActor(user) : null; },
  authorizeMutation: async request => request.headers.get('origin') === origin,
};
const patterns: [string, Part4Action][] = [
  ['plans/([^/]+)/quotes', 'quote'], ['quotes/([^/]+)/approval', 'approve'], ['quotes/([^/]+)/book', 'book'],
  ['wallet/authorizations/([^/]+)', 'authorization'], ['plans/([^/]+)/payment', 'payment'],
  ['plans/([^/]+)/payment/handoff', 'handoff'], ['bookings/([^/]+)/report-completed', 'report-completed'],
  ['bookings/([^/]+)/reconcile', 'reconcile'], ['bookings/([^/]+)/resolve-handoff', 'resolve-handoff'], ['bookings/([^/]+)/split', 'split'],
  ['reimbursements/([^/]+)/report-sent', 'report-sent'], ['reimbursements/([^/]+)/confirm-received', 'confirm-received'],
  ['plans/([^/]+)/payment/repayment-link', 'repayment-link'], ['plans/([^/]+)/change-requests', 'change'],
];
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Part 4 test console</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;background:#faf8f2;color:#202020}button,select{font:inherit;padding:10px 14px;margin:5px;border:1px solid #aaa;border-radius:8px;background:white}button{cursor:pointer}pre{white-space:pre-wrap;background:#efeee8;padding:20px;border-radius:10px;overflow-wrap:anywhere}.notice{padding:16px;background:#fff1bd;border-radius:10px}h1{font-size:28px}</style></head><body><h1>Discovery, Booking & Payments</h1><p class="notice"><strong>TEST CONSOLE — no money moves.</strong> Users and wallet approval are simulated. The checkout runs in real Chromium against our owned fake-money page. No live theater reservation or Link purchase occurs.</p><p>Act as <select id="actor"><option>buyer</option><option>mark</option><option>mel</option></select></p><p><button id="quote">1. Quote test seats</button><button id="request">2. Request test approval</button><button id="approve">3. Buyer approves (test)</button><button id="book">4. Run checkout</button><button id="view">View my payment data</button></p><p><button id="sent">Report my share sent</button><button id="received">Buyer confirms receipt</button></p><pre id="output">Start with the buyer, create a quote, then approve and book. Switch to Mark or Mel to inspect their private request.</pre><script>
const tokens=${JSON.stringify(tokens)};let quote,approval,ownShare;const output=document.querySelector('#output');const actor=()=>document.querySelector('#actor').value;
async function api(path,body,method='POST'){const r=await fetch('/api/'+path,{method,headers:{'Authorization':'Bearer '+tokens[actor()],'Content-Type':'application/json','Idempotency-Key':'console-'+crypto.randomUUID()},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});const data=await r.json();output.textContent=JSON.stringify(data,null,2);if(!r.ok)throw Error(data.error?.message||'Request failed');return data.data}
function click(id,fn){document.querySelector('#'+id).onclick=()=>Promise.resolve().then(fn).catch(e=>{output.textContent=e.message})}
click('quote',async()=>{quote=await api('plans/test-plan/quotes',{versionId:'test-v1',optionId:'test-option',buyerUserId:'buyer',expectedRevision:1})});
click('request',async()=>{if(!quote)throw Error('Create a quote first');approval=await api('quotes/'+quote.id+'/approval',{expectedRevision:1})});
click('approve',async()=>{if(!approval)throw Error('Request approval first');await api('demo/approve',{authorizationId:approval.authorizationId})});
click('book',async()=>{if(!quote||!approval)throw Error('Quote and approve first');await api('quotes/'+quote.id+'/book',{authorizationId:approval.authorizationId,expectedRevision:1,buyerPayPalMe:'DemoBuyer'})});
click('view',async()=>{const view=await api('plans/test-plan/payment',null,'GET');ownShare=view.reimbursements?.[0]});
click('sent',async()=>{if(!ownShare)throw Error('View your private share first');await api('reimbursements/'+encodeURIComponent(ownShare.id)+'/report-sent')});
click('received',async()=>{if(!ownShare)throw Error('View the buyer ledger first');await api('reimbursements/'+encodeURIComponent(ownShare.id)+'/confirm-received')});
</script></body></html>`;

const server = createServer(async (req, res) => {
  try {
    if (!req.url || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > 32768) { res.writeHead(413); res.end(); return; } chunks.push(b); }
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    const request = new Request(url, { method: req.method, headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
    let response: Response;
    if (url.pathname === '/api/demo/approve' && req.method === 'POST') {
      const actor = await runtime.authenticate(request);
      if (actor?.userId !== 'buyer' || !await runtime.authorizeMutation(request, actor)) response = Response.json({ error: { message: 'Only the test buyer may approve.' } }, { status: 403 });
      else { const data = await request.json(); harness.wallet.approve(String(data.authorizationId)); response = Response.json({ data: { status: 'approved', mode: 'test', note: 'Simulated wallet approval; no funds authorized.' } }); }
    } else {
      const route = patterns.map(([pattern, action]) => ({ match: url.pathname.match(new RegExp(`^/api/${pattern}$`)), action })).find(value => value.match);
      response = route ? await handlePart4(route.action, request, { id: decodeURIComponent(route.match![1]) }, runtime) : Response.json({ error: { message: 'Not found.' } }, { status: 404 });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Test console operation failed. Restart with fresh test data if its simulated wallet state expired.' } })); }
});
server.listen(port, '127.0.0.1', () => console.log(`Part 4 TEST console: ${origin} (fake users/wallet; real owned browser checkout)`));
