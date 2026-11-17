// Fake devices for one block, for when no hardware is posting:  node tools/replay.js [api-url]
// Sends one contract message of each sensor kind every 2 s for block l8-bore-bend, slowly drifting toward trouble:
// the mains sag, the supply drops, the battery runs down, the air and the water get worse.
// Every 10th cycle it acts out a network cut: it holds its messages, then uploads the backlog in one POST with
// hops and via filled in (CONTRACT.md section 5).
// (The team's tools/replay.mjs at the top of the repository sends the fixed contract samples instead.)
const API = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const BLOCK = "l8-bore-bend", RELAY = `relay-${BLOCK}`, SENSOR = `sensor-${BLOCK}`, WATCH = "watch-0042";
const RUN = Date.now().toString(36); // ids stay unique when the script is restarted against the same server
let n = 0, seq = 0, backlog = [], battery_wh = 2600;

function message(device, kind, values) {
  return { id: `${device}-${RUN}-${String(++seq).padStart(6, "0")}`, device, block: BLOCK,
    time: new Date().toISOString(), kind, values, hops: 0, via: [], source: "simulated" }; // scripted data is always tagged simulated
}

async function post(body) {
  const r = await fetch(`${API}/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

setInterval(async () => {
  n++;
  const drift = Math.min(n / 12, 1); // 0 -> 1 over ~25 s so alerts show quickly
  const draw_w = 96, supply_w = Math.round(96 * (1 - drift));
  battery_wh = Math.max(0, battery_wh - (draw_w - supply_w) * 2); // each cycle stands for two hours on the battery
  const batch = [
    message(RELAY, "power", { battery_wh, draw_w, supply_w, grid_hz: +(60 - 0.3 * drift + (Math.random() - 0.5) * 0.02).toFixed(3) }),
    message(WATCH, "vitals", { hr_bpm: 78 + Math.round(Math.random() * 6), spo2_pct: 97 - Math.round(3 * drift), temp_c: 36.8 }),
    message(SENSOR, "water", { tds_ppm: Math.round(250 + 900 * drift), turbidity_ntu: +(1 + 5 * drift).toFixed(1) }),
    message(SENSOR, "air", { co2_ppm: Math.round(800 + 900 * drift), temp_c: +(27 + 8 * drift).toFixed(1), humidity_pct: Math.round(50 + 20 * drift) }),
    message(SENSOR, "flood", { depth_cm: +(2 + 18 * drift).toFixed(1) }),
  ];
  if (n % 10 >= 7) {               // network "cut" for 3 of every 10 cycles
    backlog.push(...batch.map((m) => ({ ...m, hops: 1, via: [RELAY] })));
    console.log(`network cut: holding ${backlog.length} messages`);
    return;
  }
  try {
    if (backlog.length) { console.log("network back: uploading backlog", await post(backlog)); backlog = []; }
    console.log(n, await post(batch));
  } catch (e) { console.log("API unreachable:", e.message); }
}, 2000);
