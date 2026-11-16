// Fake devices for every lane until real parts post. `node tools/replay.js [api-url]`
// Sends one reading per kind every 2 s for block L8-deepwell-03, slowly drifting toward trouble.
// Every 10th cycle it simulates a network cut: it holds readings, then uploads the backlog in one POST.
const API = process.argv[2] || "http://localhost:8787";
let n = 0, seq = 0, backlog = [];

function reading(device, kind, values) {
  return { id: `${device}-${String(++seq).padStart(6, "0")}`, device, block: "L8-deepwell-03",
    time: new Date().toISOString(), kind, values, source: "simulated" }; // scripted data is always tagged simulated
}

async function post(body) {
  const r = await fetch(`${API}/ingest`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

setInterval(async () => {
  n++;
  const drift = Math.min(n / 12, 1); // 0 -> 1 over ~25 s so alerts show quickly
  const batch = [
    reading("relay-07", "power", { battery_pct: Math.max(0, 90 - n), draw_w: 40 + Math.random() * 5,
      grid_hz: +(60 - 0.3 * drift + (Math.random() - 0.5) * 0.02).toFixed(3) }),
    reading("watch-01", "vitals", { hr: 78 + Math.round(Math.random() * 6), spo2: 97 - Math.round(3 * drift), temp_c: 36.8 }),
    reading("sensor-01", "water", { tds_ppm: Math.round(250 + 900 * drift), turbidity_ntu: +(1 + 5 * drift).toFixed(1) }),
    reading("sensor-01", "air", { co2_ppm: Math.round(800 + 900 * drift) }),
    reading("sensor-01", "flood", { depth_cm: +(2 + 18 * drift).toFixed(1) }),
  ];
  if (n % 10 >= 7) {               // network "cut" for 3 of every 10 cycles
    backlog.push(...batch);
    console.log(`network cut: holding ${backlog.length} readings`);
    return;
  }
  try {
    if (backlog.length) { console.log("network back: uploading backlog", await post(backlog)); backlog = []; }
    console.log(n, await post(batch));
  } catch (e) { console.log("API unreachable:", e.message); }
}, 2000);
