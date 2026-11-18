// The virtual bench: the REAL sensor_node.ino, compiled unchanged against the simulated board in board/, driven by
// a bench script on standard input. bench.mjs builds it, runs the API, and plays the bench session.
//
// Script commands, one per line (# comments ignored):
//   boot                          setup(): a power-on (flash survives between processes, RAM does not)
//   run <s>                       loop() for s virtual seconds
//   watch <s>                     the same, recording how long the alarm LED, buzzer and status LED were on
//   react <s> danger|warn|clear   run until the red LED shows that level, failing if it takes longer than s seconds
//   expect alarm danger|warn|clear      what the last watch saw on the red LED and buzzer
//   expect status solid|blinking        what the last watch saw on the blue LED
//   set <name> <value>            tds | turbidity_v (probe volts; 4.0 = clear) | depth | co2 | air_temp | humidity
//   wifi up|down                  the router (unplugging it)
//   api up|down                   the API refusing connections while Wi-Fi is up
//   serial <text>                 a line typed in the serial monitor
//   mark                          start of the serial log that `expect log` searches
//   expect log <text>             the sketch printed <text> since the mark
//   expect nolog <text>           it did not
//   say <text>                    narration in the output
// Exits 1 at the first failed expectation.
#include "sensor_node.ino"

#include <iostream>

static double wAlarm = 0, wBuzzer = 0, wStatus = 0, wTotal = 0;
static int failures = 0;

static void runFor(double seconds, bool watching) {
  uint64_t end = W().virtUs + (uint64_t)(seconds * 1e6);
  if (watching) wAlarm = wBuzzer = wStatus = wTotal = 0;
  while (W().virtUs < end) {
    int a = W().pins[PIN_ALARM_LED], b = W().pins[PIN_BUZZER], s = W().pins[PIN_STATUS_LED];
    uint64_t t0 = W().virtUs;
    loop();
    if (W().pins[PIN_ALARM_LED] && !a && alarmLevel != hollow::CLEAR)  // say what lit the red LED, for diagnosis
      std::printf("[bench] red LED on at %.1f s: tds %.1f, turbidity %.2f, co2 %.0f, flood %.2f\n", benchSeconds(), lastTds, lastTurbidity, lastCo2, lastFlood);
    double dt = (W().virtUs - t0) / 1e6;
    if (watching) { wAlarm += a * dt; wBuzzer += b * dt; wStatus += s * dt; wTotal += dt; }
  }
}

static void check(bool ok, const std::string& what) {
  std::printf("%s %s\n", ok ? "BENCH OK  " : "BENCH FAIL", what.c_str());
  if (!ok) failures++;
}

int main() {
  W().unixBase = std::atoll(benchEnv("BENCH_UNIX_BASE", "0"));
  size_t mark = 0;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty() || line[0] == '#') continue;
    std::istringstream in(line);
    std::string cmd;
    in >> cmd;
    std::string rest;
    std::getline(in, rest);
    if (!rest.empty() && rest[0] == ' ') rest.erase(0, 1);
    if (cmd == "boot") setup();
    else if (cmd == "run") runFor(std::atof(rest.c_str()), false);
    else if (cmd == "watch") runFor(std::atof(rest.c_str()), true);
    else if (cmd == "say") std::printf("\n== %s\n", rest.c_str());
    else if (cmd == "react") {
      // danger: red on; clear: red off; warn: red seen blinking (both on and off) within the time
      std::istringstream r(rest);
      double maxS;
      std::string level;
      r >> maxS >> level;
      uint64_t t0 = W().virtUs, end = t0 + (uint64_t)(maxS * 1e6);
      bool done = false;
      while (W().virtUs < end && !done) {
        loop();
        int a = W().pins[PIN_ALARM_LED];
        done = (level == "danger" && a && alarmLevel == hollow::DANGER) || (level == "clear" && !a && alarmLevel == hollow::CLEAR) ||
               (level == "warn" && alarmLevel == hollow::WARN);  // the LED blinks; the decision is what matters
      }
      char d[120];
      std::snprintf(d, sizeof d, "red LED shows %s %.1f s after the change (limit %.1f s)", level.c_str(), (W().virtUs - t0) / 1e6, maxS);
      check(done, d);
    }
    else if (cmd == "mark") mark = W().serialLog.size();
    else if (cmd == "serial") { std::printf("> %s\n", rest.c_str()); W().serialIn.push_back(rest); runFor(0.05, false); }
    else if (cmd == "wifi") W().wifiUp = rest == "up";
    else if (cmd == "api") W().apiUp = rest == "up";
    else if (cmd == "set") {
      std::istringstream r(rest);
      std::string name;
      double v;
      r >> name >> v;
      if (name == "tds") W().tdsTruePpm = v;
      else if (name == "turbidity_v") W().turbProbeVolts = v;
      else if (name == "depth") W().waterDepthCm = v;
      else if (name == "co2") W().co2 = v;
      else if (name == "air_temp") W().airTempC = v;
      else if (name == "humidity") W().humidity = v;
      else { check(false, "unknown world value " + name); }
    } else if (cmd == "expect") {
      std::istringstream r(rest);
      std::string what, arg;
      r >> what;
      std::getline(r, arg);
      if (!arg.empty() && arg[0] == ' ') arg.erase(0, 1);
      double led = wTotal ? wAlarm / wTotal : 0, buz = wTotal ? wBuzzer / wTotal : 0, st = wTotal ? wStatus / wTotal : 0;
      char d[160];
      std::snprintf(d, sizeof d, " (red LED on %.0f%%, buzzer on %.0f%%, blue LED on %.0f%% of %.0f s)", led * 100, buz * 100, st * 100, wTotal);
      if (what == "alarm" && arg == "danger") check(led > 0.95 && buz > 0.08 && buz < 0.25, std::string("alarm: danger, red steady, beeping") + d);
      else if (what == "alarm" && arg == "warn") check(led > 0.3 && led < 0.7 && buz == 0, std::string("alarm: warning, red blinking, silent") + d);
      else if (what == "alarm" && arg == "clear") check(led == 0 && buz == 0, std::string("alarm: clear, red off, silent") + d);
      else if (what == "status" && arg == "solid") check(st > 0.95, std::string("blue LED steady: the API has everything") + d);
      else if (what == "status" && arg == "blinking") check(st > 0.3 && st < 0.7, std::string("blue LED blinking: holding messages") + d);
      else if (what == "log") check(W().serialLog.find(arg, mark) != std::string::npos, "serial shows \"" + arg + "\"");
      else if (what == "nolog") check(W().serialLog.find(arg, mark) == std::string::npos, "serial never shows \"" + arg + "\"");
      else check(false, "unknown expectation: " + rest);
    } else {
      check(false, "unknown command: " + line);
    }
  }
  const char* elapsed = std::getenv("BENCH_ELAPSED");
  if (elapsed) { std::ofstream f(elapsed); f << (long long)(W().virtUs / 1000000ULL); }
  return failures ? 1 : 0;
}
