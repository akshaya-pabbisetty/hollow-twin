// hollow_core.h: everything the sensor node decides, with no hardware in it.
//
// The ESP32 sketch (sensor_node.ino) and the laptop tests (../test) compile this same file, so what the tests prove
// is what the board runs. Plain C++11 and the standard library only: no Arduino calls, no libraries.
//
//   1. SHA-256 and HMAC-SHA256, for the signature the API checks (api/sign.js).
//   2. Numbers written exactly as JSON.stringify writes them, so the signed text matches what the API re-signs.
//   3. The contract message (CONTRACT.md sections 1 and 2): id, device, block, time, kind, values, signature.
//   4. Sensor maths: TDS probe, turbidity probe, SCD40 CO2 sensor, ultrasonic flood depth.
//   5. When to send: on a schedule, or at once when a reading moves.
//   6. Message ids that never repeat, even after a reboot.
//   7. The backlog held while the API is unreachable, uploaded as one array (CONTRACT.md section 5).
//   8. The API's limits (GET /limits), so the node can warn locally when the network is cut.
#ifndef HOLLOW_CORE_H
#define HOLLOW_CORE_H

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

namespace hollow {

// ---------------------------------------------------------------- 1. SHA-256 and HMAC-SHA256 (FIPS 180-4, RFC 2104)

class Sha256 {
 public:
  Sha256() { reset(); }
  void reset() {
    static const uint32_t init[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                     0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    for (int i = 0; i < 8; i++) h_[i] = init[i];
    len_ = 0;
    fill_ = 0;
  }
  void update(const uint8_t* data, size_t n) {
    for (size_t i = 0; i < n; i++) {
      buf_[fill_++] = data[i];
      if (fill_ == 64) { block(buf_); fill_ = 0; }
    }
    len_ += (uint64_t)n;
  }
  void update(const std::string& s) { update((const uint8_t*)s.data(), s.size()); }
  void finish(uint8_t out[32]) {
    uint64_t bits = len_ * 8;
    uint8_t pad = 0x80;
    update(&pad, 1);
    uint8_t zero = 0;
    while (fill_ != 56) update(&zero, 1);
    uint8_t lenb[8];
    for (int i = 0; i < 8; i++) lenb[i] = (uint8_t)(bits >> (56 - 8 * i));
    update(lenb, 8);
    for (int i = 0; i < 8; i++)
      for (int j = 0; j < 4; j++) out[4 * i + j] = (uint8_t)(h_[i] >> (24 - 8 * j));
  }

 private:
  static uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
  void block(const uint8_t* p) {
    static const uint32_t k[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
    uint32_t w[64];
    for (int i = 0; i < 16; i++)
      w[i] = ((uint32_t)p[4 * i] << 24) | ((uint32_t)p[4 * i + 1] << 16) | ((uint32_t)p[4 * i + 2] << 8) | p[4 * i + 3];
    for (int i = 16; i < 64; i++) {
      uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3], e = h_[4], f = h_[5], g = h_[6], h = h_[7];
    for (int i = 0; i < 64; i++) {
      uint32_t t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i];
      uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h_[0] += a; h_[1] += b; h_[2] += c; h_[3] += d; h_[4] += e; h_[5] += f; h_[6] += g; h_[7] += h;
  }
  uint32_t h_[8];
  uint64_t len_;
  uint8_t buf_[64];
  size_t fill_;
};

inline std::string toHex(const uint8_t* p, size_t n) {
  static const char* digits = "0123456789abcdef";
  std::string s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += digits[p[i] >> 4]; s += digits[p[i] & 15]; }
  return s;
}

inline std::string sha256Hex(const std::string& msg) {
  Sha256 h;
  h.update(msg);
  uint8_t out[32];
  h.finish(out);
  return toHex(out, 32);
}

// Lowercase hex HMAC-SHA256, the form api/sign.js expects in `sig`.
inline std::string hmacSha256Hex(const std::string& key, const std::string& msg) {
  uint8_t k[64];
  std::memset(k, 0, sizeof k);
  if (key.size() > 64) {
    Sha256 h;
    h.update(key);
    h.finish(k);  // the first 32 bytes; the rest stay zero
  } else {
    std::memcpy(k, key.data(), key.size());
  }
  uint8_t ipad[64], opad[64];
  for (int i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  Sha256 inner;
  inner.update(ipad, 64);
  inner.update(msg);
  uint8_t ih[32];
  inner.finish(ih);
  Sha256 outer;
  outer.update(opad, 64);
  outer.update(ih, 32);
  uint8_t oh[32];
  outer.finish(oh);
  return toHex(oh, 32);
}

// ---------------------------------------------------------------- 2. Numbers as JSON.stringify writes them

// Rounds to `decimals` places and writes the shortest form: 412 not 412.0, 96.5 not 96.50, never "-0", never an
// exponent. The API parses what we send and signs JSON.stringify of it, so the text we sign must already be in
// that form or the signature fails. Readings here are far below 1e21, where JSON.stringify switches to exponents.
inline std::string formatNumber(double v, int decimals) {
  if (decimals < 0) decimals = 0;
  if (decimals > 6) decimals = 6;
  double p = std::pow(10.0, decimals);
  double r = std::round(v * p) / p;
  char buf[48];
  std::snprintf(buf, sizeof buf, "%.*f", decimals, r);
  std::string s(buf);
  if (s.find('.') != std::string::npos) {
    while (!s.empty() && s[s.size() - 1] == '0') s.erase(s.size() - 1);
    if (!s.empty() && s[s.size() - 1] == '.') s.erase(s.size() - 1);
  }
  if (s == "-0") s = "0";
  return s;
}

// ---------------------------------------------------------------- 3. The contract message

struct Field {
  std::string key;  // the contract's value name, e.g. "tds_ppm"
  double value;
  int decimals;     // how many decimal places the sensor honestly resolves
};

// Ids, device names, block ids and kinds are lowercase letters, digits and dashes (CONTRACT.md section 3), and value
// names add underscores. Checking it here keeps every string safe to write into JSON without escaping.
inline bool isSafeName(const std::string& s, bool allowUnderscore) {
  if (s.empty() || s.size() > 96) return false;
  for (size_t i = 0; i < s.size(); i++) {
    char c = s[i];
    bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || (allowUnderscore && c == '_');
    if (!ok) return false;
  }
  return true;
}

// The values object with keys in alphabetical order and no spaces: exactly what api/sign.js signs. Non-finite
// numbers (a sensor that returned nothing) are left out, because JSON has no way to write them.
inline std::string valuesJson(std::vector<Field> fields) {
  std::sort(fields.begin(), fields.end(), [](const Field& a, const Field& b) { return a.key < b.key; });
  std::string s = "{";
  bool first = true;
  for (size_t i = 0; i < fields.size(); i++) {
    if (!std::isfinite(fields[i].value)) continue;
    if (!first) s += ",";
    first = false;
    s += "\"" + fields[i].key + "\":" + formatNumber(fields[i].value, fields[i].decimals);
  }
  return s + "}";
}

inline std::string canonical(const std::string& id, const std::string& device, const std::string& block,
                             const std::string& time, const std::string& kind, const std::string& values) {
  return id + "|" + device + "|" + block + "|" + time + "|" + kind + "|" + values;
}

struct Message {
  std::string id, device, block, time, kind, values, sig;
};

// Builds a message ready to send. `key` empty = unsigned (the API stores it with "verified": false).
// Returns false, and leaves `out` alone, if any name breaks the contract's character rules.
inline bool buildMessage(const std::string& device, const std::string& block, uint32_t counter,
                         const std::string& time, const std::string& kind, const std::vector<Field>& fields,
                         const std::string& key, Message& out) {
  if (!isSafeName(device, false) || !isSafeName(block, false) || !isSafeName(kind, false)) return false;
  for (size_t i = 0; i < fields.size(); i++)
    if (!isSafeName(fields[i].key, true)) return false;
  char num[16];
  std::snprintf(num, sizeof num, "%06lu", (unsigned long)counter);
  Message m;
  m.id = device + "-" + num;
  m.device = device;
  m.block = block;
  m.time = time;
  m.kind = kind;
  m.values = valuesJson(fields);
  if (!key.empty()) m.sig = hmacSha256Hex(key, canonical(m.id, m.device, m.block, m.time, m.kind, m.values));
  out = m;
  return true;
}

// The message as it goes on the wire. "source": "live" because only real hardware runs this code
// (api/docs/FIRMWARE.md section 1). hops and via are not signed: relays change them on the way.
inline std::string messageJson(const Message& m) {
  std::string s = "{\"id\":\"" + m.id + "\",\"device\":\"" + m.device + "\",\"block\":\"" + m.block +
                  "\",\"time\":\"" + m.time + "\",\"kind\":\"" + m.kind + "\",\"values\":" + m.values +
                  ",\"hops\":0,\"via\":[],\"source\":\"live\"";
  if (!m.sig.empty()) s += ",\"sig\":\"" + m.sig + "\"";
  return s + "}";
}

// UTC "YYYY-MM-DDTHH:MM:SSZ" from seconds since 1970 (Howard Hinnant's civil-from-days; no gmtime needed).
// Before the clock is set from the network the board counts from 1970; the API stores such a time as its
// receive time and marks it time_estimated (CONTRACT.md section 1.3), so nothing is lost.
inline std::string isoTime(int64_t unixSeconds) {
  int64_t days = unixSeconds >= 0 ? unixSeconds / 86400 : (unixSeconds - 86399) / 86400;
  int64_t secs = unixSeconds - days * 86400;
  int64_t z = days + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = yoe + era * 400;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  int64_t d = doy - (153 * mp + 2) / 5 + 1;
  int64_t mo = mp + (mp < 10 ? 3 : -9);
  if (mo <= 2) y += 1;
  char buf[32];
  std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02dZ", (int)y, (int)mo, (int)d, (int)(secs / 3600),
                (int)(secs % 3600 / 60), (int)(secs % 60));
  return buf;
}

// ---------------------------------------------------------------- 4. Sensor maths

inline double median(std::vector<double> v) {
  if (v.empty()) return NAN;
  std::sort(v.begin(), v.end());
  size_t n = v.size();
  return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2.0;
}

// TDS probe (DFRobot Gravity SEN0244; its board outputs 0 to 2.3 V). The maker's conversion: compensate the voltage
// to 25 C (2% per degree), then a cubic fit to ppm, times 0.5 (the maker's EC-to-TDS factor). `k` is the
// calibration factor from one known solution (calibrateTdsK); 1.0 until calibrated. The maker rates the probe
// 0 to 1000 ppm, +/- 10% of full scale; above 1000 ppm the number still rises with saltiness but is less exact.
inline double tdsPpm(double volts, double waterTempC, double k) {
  if (!(volts > 0)) return 0;
  double comp = 1.0 + 0.02 * (waterTempC - 25.0);
  double v = volts / comp;
  double ppm = (133.42 * v * v * v - 255.86 * v * v + 857.39 * v) * 0.5 * k;
  return ppm < 0 ? 0 : ppm;
}

// One-point calibration, as the maker's own library does it: probe in a solution of known TDS (a 1413 uS/cm
// conductivity standard is about 707 ppm at the 0.5 factor), k = known / reading-at-k-1.
inline double calibrateTdsK(double volts, double waterTempC, double knownPpm) {
  double raw = tdsPpm(volts, waterTempC, 1.0);
  if (!(raw > 1) || !(knownPpm > 0)) return 1.0;  // probe dry or not connected: keep k = 1
  double k = knownPpm / raw;
  return (k < 0.25 || k > 4.0) ? 1.0 : k;          // a factor that far off is a wiring fault, not a calibration
}

// Turbidity probe (DFRobot SEN0189, 5 V; the voltage FALLS as water gets cloudier). The maker's fit,
// NTU = -1120.4 V^2 + 5742.3 V - 4352.9, holds from 2.5 V (about 3000 NTU) to 4.2 V (clear, about 0 NTU) at the
// probe's own 5 V output. Real probes read clear water at different voltages, so the clear-cup calibration scales
// the measured voltage until clear water sits at 4.2 V. `probeVolts` is the probe's output before the divider.
inline double turbidityNtu(double probeVolts, double clearVolts) {
  if (!(probeVolts > 0)) return NAN;
  double v = clearVolts > 0.5 ? probeVolts * 4.2 / clearVolts : probeVolts;
  if (v >= 4.2) return 0;
  if (v <= 2.5) return 3000;
  double ntu = -1120.4 * v * v + 5742.3 * v - 4352.9;
  return ntu < 0 ? 0 : ntu;
}

// SCD40 CO2 sensor, spoken to directly over I2C from its datasheet (Sensirion SCD4x), so no library version can
// break the build. Every 16-bit word the sensor sends is followed by this CRC-8 (polynomial 0x31, start 0xFF).
inline uint8_t scdCrc(const uint8_t* data, size_t n) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
  }
  return crc;
}

struct ScdReading {
  double co2Ppm, tempC, humidityPct;
};

// The 9 bytes of read_measurement (0xEC05): three words, each followed by its CRC. Returns false on any bad CRC
// or on CO2 = 0 (the sensor's "no data yet").
inline bool scdDecode(const uint8_t b[9], ScdReading& out) {
  uint16_t w[3];
  for (int i = 0; i < 3; i++) {
    if (scdCrc(b + 3 * i, 2) != b[3 * i + 2]) return false;
    w[i] = (uint16_t)((b[3 * i] << 8) | b[3 * i + 1]);
  }
  if (w[0] == 0) return false;
  out.co2Ppm = w[0];
  out.tempC = -45.0 + 175.0 * w[1] / 65535.0;
  out.humidityPct = 100.0 * w[2] / 65535.0;
  return true;
}

// Ultrasonic flood depth: the sensor hangs a known height above the tunnel floor, pointing down; the water depth is
// that height minus the distance to the surface. Sound speed depends on air temperature (331.3 + 0.606 T m/s).
inline double echoToCm(double echoMicros, double airTempC) {
  double cmPerMicro = (331.3 + 0.606 * airTempC) / 10000.0;
  return echoMicros * cmPerMicro / 2.0;
}

// Depth from the median distance. A distance a little longer than the mount height is noise on a dry floor: 0.
inline double floodDepthCm(double mountHeightCm, double distanceCm) {
  if (!(distanceCm > 0) || !(mountHeightCm > 0)) return NAN;
  double d = mountHeightCm - distanceCm;
  return d < 0 ? 0 : d;
}

// ---------------------------------------------------------------- 5. When to send

// A kind is sent when its period has passed, or at once (but no more often than minGapS) when any value has moved
// by at least its delta since the last message. So a salty cup reaches the API seconds after it goes in, while a
// quiet tap line costs one message a minute.
struct SendRule {
  double periodS;
  double minGapS;
  std::vector<double> deltas;  // one per field, same order as the fields
};

struct SendState {
  bool sentOnce;
  double lastSentS;
  std::vector<double> lastValues;
  SendState() : sentOnce(false), lastSentS(0) {}
};

inline bool shouldSend(const SendRule& rule, const SendState& st, const std::vector<Field>& now, double nowS) {
  if (!st.sentOnce) return true;
  double since = nowS - st.lastSentS;
  if (since >= rule.periodS) return true;
  if (since < rule.minGapS) return false;
  for (size_t i = 0; i < now.size() && i < st.lastValues.size() && i < rule.deltas.size(); i++) {
    double a = st.lastValues[i], b = now[i].value;
    if (std::isfinite(a) != std::isfinite(b)) return true;  // a sensor came back or went away
    if (std::isfinite(a) && std::fabs(b - a) >= rule.deltas[i]) return true;
  }
  return false;
}

inline void markSent(SendState& st, const std::vector<Field>& now, double nowS) {
  st.sentOnce = true;
  st.lastSentS = nowS;
  st.lastValues.clear();
  for (size_t i = 0; i < now.size(); i++) st.lastValues.push_back(now[i].value);
}

// ---------------------------------------------------------------- 6. Message ids that never repeat

// Ids are <device>-<counter>, and the API drops a repeated id as a duplicate, so a counter that restarts at 1 after
// a reboot would silently lose messages. Writing the counter to flash on every message wears the flash, so the
// node reserves ids in blocks: it stores "next free block" once per `blockSize` messages, and after a reboot it
// starts from the stored value. At worst a reboot skips the unused part of a block; it never repeats an id.
class IdCounter {
 public:
  IdCounter(uint32_t storedNext, uint32_t blockSize) : next_(storedNext ? storedNext : 1), blockSize_(blockSize ? blockSize : 1) {
    reservedUpTo_ = next_;
  }
  // The next id. `persist` is set true when the caller must write reservedUpTo() to flash BEFORE using the id.
  uint32_t take(bool& persist) {
    persist = false;
    if (next_ >= reservedUpTo_) {
      reservedUpTo_ = next_ + blockSize_;
      persist = true;
    }
    return next_++;
  }
  uint32_t reservedUpTo() const { return reservedUpTo_; }

 private:
  uint32_t next_, blockSize_, reservedUpTo_;
};

// ---------------------------------------------------------------- 7. The backlog

// Messages wait here until the API takes them. When the network is cut they pile up, then go up as ONE array, oldest
// first, with their original times (CONTRACT.md section 5). If it fills, the oldest go first and are counted.
class Backlog {
 public:
  explicit Backlog(size_t capacity) : cap_(capacity ? capacity : 1), dropped_(0) {}
  void push(const std::string& json) {
    if (q_.size() >= cap_) { q_.pop_front(); dropped_++; }
    q_.push_back(json);
  }
  size_t size() const { return q_.size(); }
  unsigned long dropped() const { return dropped_; }
  // The first n messages as a JSON array (n = 0 or more than the backlog = all of it).
  std::string batch(size_t n) const {
    if (n == 0 || n > q_.size()) n = q_.size();
    std::string s = "[";
    for (size_t i = 0; i < n; i++) { if (i) s += ","; s += q_[i]; }
    return s + "]";
  }
  void pop(size_t n) { while (n-- && !q_.empty()) q_.pop_front(); }

 private:
  std::deque<std::string> q_;
  size_t cap_;
  unsigned long dropped_;
};

// What to do with the backlog after the API answers a batch, the same rules as the Pi relay (firmware/relay/relay.py).
enum Outcome { SENT, DISCARD, RETRY };
inline Outcome afterReply(int httpStatus) {
  if (httpStatus == 200) return SENT;     // stored, or recognised as duplicates: done either way
  if (httpStatus == 422) return DISCARD;  // nothing could be stored, and sending the same messages again will not help
  return RETRY;                           // 0 (no connection), 401 (key), 429 (rate limit), 5xx: keep and try later
}

// Waits between failed uploads: 2 s, doubling, at most 60 s. Reset after a success.
inline double backoffS(int failures) {
  double s = 2.0;
  for (int i = 1; i < failures && s < 60; i++) s *= 2;
  return s > 60 ? 60 : s;
}

// ---------------------------------------------------------------- 8. The API's limits, kept on the node

// The node warns on its own light and buzzer, even when the Directorate cuts the network, using the same published
// limits the API uses (api/shared/limits.json, served at GET /limits). These defaults are those values on Nov 18;
// the node refreshes them from the API whenever it can and keeps the last good copy in flash.
struct Limits {
  double tdsMaxPpm;      // water_tds_max_ppm: WHO acceptability, 1000
  double turbidityMax;   // water_turbidity_max_ntu: US EPA, 5
  double co2StalePpm;    // air_co2_stale_ppm: Health Canada, 1000
  double co2DangerPpm;   // air_co2_danger_ppm: OSHA / NIOSH, 5000
  double floodClosedCm;  // flood_depth_closed_cm: US NWS, 15
  Limits() : tdsMaxPpm(1000), turbidityMax(5), co2StalePpm(1000), co2DangerPpm(5000), floodClosedCm(15) {}
};

// Finds "<name>":{ ... "value":<number> in the GET /limits JSON. A small scan, not a JSON parser: the response is
// tens of kilobytes and the node needs five numbers. Returns false and leaves `out` alone if it is not there.
inline bool findLimit(const std::string& json, const std::string& name, double& out) {
  std::string tag = "\"" + name + "\":";
  size_t at = json.find(tag);
  if (at == std::string::npos) return false;
  size_t open = json.find('{', at + tag.size());
  size_t close = json.find('}', at + tag.size());
  if (open == std::string::npos || close == std::string::npos || open > close) return false;
  size_t v = json.find("\"value\":", open);
  if (v == std::string::npos || v > close) return false;
  const char* start = json.c_str() + v + 8;
  char* end = nullptr;
  double d = std::strtod(start, &end);
  if (end == start || !std::isfinite(d)) return false;
  out = d;
  return true;
}

// Reads all five; a missing one keeps its current value. Returns how many were found.
inline int readLimits(const std::string& json, Limits& lim) {
  int n = 0;
  n += findLimit(json, "water_tds_max_ppm", lim.tdsMaxPpm);
  n += findLimit(json, "water_turbidity_max_ntu", lim.turbidityMax);
  n += findLimit(json, "air_co2_stale_ppm", lim.co2StalePpm);
  n += findLimit(json, "air_co2_danger_ppm", lim.co2DangerPpm);
  n += findLimit(json, "flood_depth_closed_cm", lim.floodClosedCm);
  return n;
}

// The local alarm: 0 = all clear, 1 = warn (stale air, flooded tunnel), 2 = danger (water unsafe to drink,
// dangerous air). The same levels the API gives these readings. NAN = that sensor is absent: it never alarms.
enum Alarm { CLEAR = 0, WARN = 1, DANGER = 2 };
inline Alarm localAlarm(const Limits& l, double tds, double turbidity, double co2, double floodCm) {
  if ((tds > l.tdsMaxPpm) || (turbidity > l.turbidityMax) || (co2 > l.co2DangerPpm)) return DANGER;
  if ((co2 > l.co2StalePpm) || (floodCm > l.floodClosedCm)) return WARN;
  return CLEAR;
}

}  // namespace hollow

#endif  // HOLLOW_CORE_H
