// Sends the sample messages to an API so you can test without hardware.
// Each round gives every sample a fresh id and the current time.
// Usage: node tools/replay.mjs [url] [seconds between rounds] [rounds]
//   node tools/replay.mjs                                  -> http://localhost:8788/ingest, every 2 s, forever
//   node tools/replay.mjs https://your-api.example/ingest 5 10
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || 'http://localhost:8788/ingest';
const every = Number(process.argv[3] || 2) * 1000;
const rounds = Number(process.argv[4] || Infinity);
const dir = fileURLToPath(new URL('../contract/samples/', import.meta.url));
const samples = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(dir + f, 'utf8')));

let round = 0;
async function send() {
  round++;
  const now = new Date().toISOString();
  const batch = samples.map(s => ({ ...s, id: `${s.device}-replay-${round}-${s.kind}`, time: now }));
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
    console.log(`round ${round}: ${res.status} ${await res.text()}`);
  } catch (e) {
    console.log(`round ${round}: could not reach ${url} (${e.message})`);
  }
  if (round < rounds) setTimeout(send, every);
}
send();
