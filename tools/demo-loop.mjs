// Keeps a hosted API supplied with scripted traffic, so the public twin always has something arriving.
// It plays the API's own scenario scripts in a loop. Everything they send is tagged "simulated".
//
//   node tools/demo-loop.mjs [apiUrl] [minutes between rounds] [--fast] [--rounds N]
//   node tools/demo-loop.mjs                                  -> http://localhost:8787, a round every 10 minutes
//   node tools/demo-loop.mjs https://your-api.example 5
//
// If the API needs a key, set INGEST_KEY in the environment.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const [api = 'http://localhost:8787', minutes = '10'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--rounds');
const fast = flags.includes('--fast');
const rounds = args.includes('--rounds') ? Number(args[args.indexOf('--rounds') + 1]) : Infinity;
const scenario = fileURLToPath(new URL('../api/tools/scenario.js', import.meta.url));
const SHOTS = ['blackout', 'networkcut']; // the two that show the claims: a warning before the dark, a check-in across a cut

const stamp = () => new Date().toISOString().slice(11, 19);
const play = shot => new Promise(resolve => {
  const child = spawn(process.execPath, [scenario, shot, api, ...(fast ? ['--fast'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
  child.on('exit', code => resolve(code));
  child.on('error', () => resolve(-1));
});

for (let round = 1; round <= rounds; round++) {
  for (const shot of SHOTS) {
    const code = await play(shot);
    // On a server that already holds data some of a scenario's own checks can fail; the traffic is still sent.
    console.log(`${stamp()}  round ${round}  ${shot.padEnd(10)} ${code === 0 ? 'sent, all checks passed' : code === 1 ? 'sent (some of its checks did not pass on this server)' : `could not run (exit ${code})`}`);
  }
  if (round < rounds) await new Promise(r => setTimeout(r, Number(minutes) * 60000));
}
