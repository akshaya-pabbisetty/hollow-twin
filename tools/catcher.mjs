// Stand-in for the real API until lane 1 ships it.
// POST /ingest takes one message or an array, drops duplicate ids, logs each one.
// GET /live streams every accepted message as server-sent events.
// Usage: node tools/catcher.mjs [port]   (default 8788)
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 8788);
const logFile = fileURLToPath(new URL('./received.ndjson', import.meta.url));
const seen = new Set();
const listeners = new Set();
const KINDS = new Set(['power', 'vitals', 'button', 'checkin', 'water', 'air', 'flood', 'tunnel', 'surface']);

function problems(m) {
  const out = [];
  for (const f of ['id', 'device', 'block', 'time', 'kind', 'values']) if (m[f] === undefined) out.push(`missing ${f}`);
  if (m.kind && !KINDS.has(m.kind)) out.push(`unknown kind "${m.kind}"`);
  if (m.time && Number.isNaN(Date.parse(m.time))) out.push('time is not ISO 8601');
  return out;
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (req.method === 'GET' && req.url === '/live') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (req.method === 'POST' && req.url === '/ingest') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let msgs;
      try { msgs = [].concat(JSON.parse(body)); } catch { res.writeHead(400, cors); return res.end('{"error":"body is not JSON"}'); }
      let accepted = 0, duplicates = 0;
      const rejected = [];
      for (const m of msgs) {
        const p = problems(m);
        if (p.length) { rejected.push({ id: m.id ?? null, problems: p }); continue; }
        if (seen.has(m.id)) { duplicates++; continue; }
        seen.add(m.id); accepted++;
        appendFileSync(logFile, JSON.stringify(m) + '\n');
        console.log(`${m.time}  ${m.kind.padEnd(8)} ${m.block.padEnd(20)} ${m.device}  ${JSON.stringify(m.values)}${m.hops ? `  (${m.hops} hops)` : ''}`);
        for (const l of listeners) l.write(`event: reading\ndata: ${JSON.stringify(m)}\n\n`);
      }
      for (const r of rejected) console.log(`REJECTED ${r.id}: ${r.problems.join(', ')}`);
      res.writeHead(rejected.length && !accepted ? 422 : 200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted, duplicates, rejected }));
    });
    return;
  }

  res.writeHead(404, cors); res.end();
}).listen(port, () => console.log(`catcher on http://localhost:${port}  (POST /ingest, GET /live)`));
