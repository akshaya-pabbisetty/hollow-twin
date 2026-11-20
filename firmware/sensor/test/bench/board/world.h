// The simulated bench: a world the sketch's sensors read, and the board's pins, clock, flash and serial port.
// Test-only (bench.mjs). One translation unit: bench_main.cpp includes the real sensor_node.ino after these headers.
#pragma once
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <deque>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

struct World {
  // ---- physics on the bench
  double tdsTruePpm = 240;      // what is really dissolved in the cup
  double tdsProbeError = 1.08;  // this probe reads 8% high until calibrated (cal tds fixes it)
  double waterTempC = 22;
  double turbClearVolts = 4.0;  // this turbidity probe gives 4.0 V in clear water (the maker's curve assumes 4.2)
  double turbProbeVolts = 4.0;  // what it gives now
  double floorDistanceCm = 45;  // sensor to the dry floor
  double waterDepthCm = 0;
  double co2 = 650, airTempC = 24, humidity = 45;
  bool scdPresent = true;
  // ---- the network
  bool wifiUp = true;
  bool apiUp = true;           // Wi-Fi up but the API refuses connections
  std::string apiUrl;          // from BENCH_API
  // ---- the board
  uint64_t virtUs = 0;         // virtual time since this boot
  int64_t unixBase = 0;        // the wall clock at boot (BENCH_UNIX_BASE)
  std::map<int, int> pins;
  std::deque<std::string> serialIn;
  std::string serialLog;       // everything the sketch printed this boot
  int httpCalls = 0;
};
inline World& W() { static World w; return w; }

inline double benchSeconds() { return W().virtUs / 1e6; }
inline time_t bench_time(time_t* out) {
  time_t t = (time_t)(W().unixBase + (int64_t)(W().virtUs / 1000000ULL));
  if (out) *out = t;
  return t;
}

// The TDS board's output voltage for the true ppm: the inverse of the maker's formula (with the probe's error),
// found by bisection, at the water's real temperature.
inline double tdsVoltsFor(double ppm) {
  double target = ppm * W().tdsProbeError;
  double comp = 1.0 + 0.02 * (W().waterTempC - 25.0);
  double lo = 0, hi = 3.0;
  for (int i = 0; i < 60; i++) {
    double v = (lo + hi) / 2;
    double f = (133.42 * v * v * v - 255.86 * v * v + 857.39 * v) * 0.5;
    if (f < target) lo = v; else hi = v;
  }
  return (lo + hi) / 2 * comp;
}

// ---- flash (Preferences), kept in a file so it survives a reboot (a new bench process)
inline std::map<std::string, std::string>& flash() {
  static std::map<std::string, std::string> m;
  static bool loaded = false;
  if (!loaded) {
    loaded = true;
    const char* path = std::getenv("BENCH_FLASH");
    if (path) {
      std::ifstream f(path);
      std::string k, v;
      while (f >> k >> v) m[k] = v;
    }
  }
  return m;
}
inline void flashSave() {
  const char* path = std::getenv("BENCH_FLASH");
  if (!path) return;
  std::ofstream f(path);
  for (auto& kv : flash()) f << kv.first << " " << kv.second << "\n";
}
