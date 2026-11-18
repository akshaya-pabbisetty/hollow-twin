// Unit tests for sensor_node/hollow_core.h, the logic the ESP32 runs. Build and run (needs g++ or clang++):
//
//   g++ -std=c++11 -Wall -Wextra -Werror -pedantic -I../sensor_node core_test.cpp -o core_test
//   ./core_test
//
// or `node e2e.mjs`, which also builds and runs this first.
#include <cstdio>
#include <string>
#include <vector>

#include "hollow_core.h"

using namespace hollow;

static int failures = 0, checks = 0;
#define CHECK(cond)                                                               \
  do {                                                                            \
    checks++;                                                                     \
    if (!(cond)) { failures++; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } \
  } while (0)
#define CHECK_EQ(a, b)                                                            \
  do {                                                                            \
    checks++;                                                                     \
    std::string x_ = (a), y_ = (b);                                               \
    if (x_ != y_) { failures++; std::printf("FAIL %s:%d  %s\n   got  %s\n   want %s\n", __FILE__, __LINE__, #a, x_.c_str(), y_.c_str()); } \
  } while (0)
#define CHECK_NEAR(a, b, tol)                                                     \
  do {                                                                            \
    checks++;                                                                     \
    double x_ = (a), y_ = (b);                                                    \
    if (!(std::fabs(x_ - y_) <= (tol))) { failures++; std::printf("FAIL %s:%d  %s = %.6f, want %.6f\n", __FILE__, __LINE__, #a, x_, y_); } \
  } while (0)

static void testSha256() {
  // FIPS 180-4 examples
  CHECK_EQ(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  CHECK_EQ(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK_EQ(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
           "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  CHECK_EQ(sha256Hex(std::string(1000000, 'a')), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  // lengths around the 55/56/64-byte padding edges
  CHECK_EQ(sha256Hex(std::string(55, 'x')), sha256Hex(std::string(55, 'x')));
}

static void testHmac() {
  // RFC 4231 test case 2 and test case 6 (a key longer than the block size)
  CHECK_EQ(hmacSha256Hex("Jefe", "what do ya want for nothing?"),
           "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  CHECK_EQ(hmacSha256Hex(std::string(131, '\xaa'), "Test Using Larger Than Block-Size Key - Hash Key First"),
           "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  // The API's published test vector (api/sign.js TEST_VECTOR, api/docs/FIRMWARE.md): the firmware must match it.
  std::vector<Field> f;
  f.push_back(Field{"battery_wh", 412, 0});
  f.push_back(Field{"draw_w", 96.5, 1});
  f.push_back(Field{"supply_w", 40, 0});
  f.push_back(Field{"grid_hz", 59.97, 2});
  std::string values = valuesJson(f);
  CHECK_EQ(values, "{\"battery_wh\":412,\"draw_w\":96.5,\"grid_hz\":59.97,\"supply_w\":40}");
  std::string c = canonical("relay-l8-bore-bend-000123", "relay-l8-bore-bend", "l8-bore-bend", "2026-11-01T14:02:11Z", "power", values);
  CHECK_EQ(c, "relay-l8-bore-bend-000123|relay-l8-bore-bend|l8-bore-bend|2026-11-01T14:02:11Z|power|{\"battery_wh\":412,\"draw_w\":96.5,\"grid_hz\":59.97,\"supply_w\":40}");
  CHECK_EQ(hmacSha256Hex("hollow-test-key-0001", c), "7c9356baf24afb1dc3ab1d01b4abb9e1e7b3135569c75edbe010c44b33c40aea");
}

static void testNumbers() {
  CHECK_EQ(formatNumber(412, 0), "412");
  CHECK_EQ(formatNumber(412.0, 2), "412");
  CHECK_EQ(formatNumber(96.50, 2), "96.5");
  CHECK_EQ(formatNumber(59.97, 2), "59.97");
  CHECK_EQ(formatNumber(0.0, 1), "0");
  CHECK_EQ(formatNumber(-0.04, 1), "0");  // rounds to -0: written as 0, as JSON.stringify(-0) does
  CHECK_EQ(formatNumber(-3.25, 1), "-3.3");
  CHECK_EQ(formatNumber(1234.5678, 1), "1234.6");
  CHECK_EQ(formatNumber(0.1, 3), "0.1");
  CHECK_EQ(formatNumber(1e9 + 0.4, 0), "1000000000");
}

static void testTimeAndMessage() {
  CHECK_EQ(isoTime(0), "1970-01-01T00:00:00Z");
  CHECK_EQ(isoTime(951782400), "2000-02-29T00:00:00Z");
  CHECK_EQ(isoTime(1700000000), "2023-11-14T22:13:20Z");
  CHECK_EQ(isoTime(1795536000), "2026-11-24T16:00:00Z");  // checked with Python datetime
  CHECK_EQ(isoTime(1795046399), "2026-11-18T23:59:59Z");
  CHECK_EQ(isoTime(4107542400LL), "2100-03-01T00:00:00Z");  // 2100 is not a leap year

  std::vector<Field> f;
  f.push_back(Field{"turbidity_ntu", 1.24, 1});
  f.push_back(Field{"tds_ppm", 241.6, 0});
  Message m;
  CHECK(buildMessage("sensor-l7-chalk-cut", "l7-chalk-cut", 42, "2026-11-18T20:00:00Z", "water", f, "k", m));
  CHECK_EQ(m.id, "sensor-l7-chalk-cut-000042");
  CHECK_EQ(m.values, "{\"tds_ppm\":242,\"turbidity_ntu\":1.2}");
  CHECK_EQ(m.sig, hmacSha256Hex("k", canonical(m.id, m.device, m.block, m.time, m.kind, m.values)));
  CHECK_EQ(messageJson(m),
           "{\"id\":\"sensor-l7-chalk-cut-000042\",\"device\":\"sensor-l7-chalk-cut\",\"block\":\"l7-chalk-cut\","
           "\"time\":\"2026-11-18T20:00:00Z\",\"kind\":\"water\",\"values\":{\"tds_ppm\":242,\"turbidity_ntu\":1.2},"
           "\"hops\":0,\"via\":[],\"source\":\"live\",\"sig\":\"" + m.sig + "\"}");
  // unsigned when there is no key
  Message u;
  CHECK(buildMessage("sensor-l7-chalk-cut", "l7-chalk-cut", 7, "2026-11-18T20:00:00Z", "water", f, "", u));
  CHECK(u.sig.empty());
  CHECK(messageJson(u).find("\"sig\"") == std::string::npos);
  // a missing sensor value is left out instead of written as nan
  std::vector<Field> g;
  g.push_back(Field{"co2_ppm", 812, 0});
  g.push_back(Field{"humidity_pct", NAN, 1});
  CHECK_EQ(valuesJson(g), "{\"co2_ppm\":812}");
  // names that break the contract's character rules are refused, never escaped into JSON
  Message bad;
  CHECK(!buildMessage("Sensor-L7", "l7-chalk-cut", 1, "t", "water", f, "", bad));
  CHECK(!buildMessage("sensor-l7", "l7\"chalk", 1, "t", "water", f, "", bad));
  std::vector<Field> h;
  h.push_back(Field{"tds\"ppm", 1, 0});
  CHECK(!buildMessage("sensor-l7", "l7-chalk-cut", 1, "t", "water", h, "", bad));
  CHECK(isSafeName("depth_cm", true));
  CHECK(!isSafeName("depth_cm", false));
}

static void testSensors() {
  // TDS: 1 V at 25 C is the maker's cubic: (133.42 - 255.86 + 857.39) * 0.5
  CHECK_NEAR(tdsPpm(1.0, 25, 1.0), 367.475, 1e-9);
  // warmer water conducts more, so the same voltage means less dissolved solids
  CHECK(tdsPpm(1.0, 35, 1.0) < tdsPpm(1.0, 25, 1.0));
  CHECK_NEAR(tdsPpm(0, 25, 1.0), 0, 0);
  // calibrating in a 707 ppm standard makes that same voltage read 707
  double k = calibrateTdsK(1.2, 22, 707);
  CHECK_NEAR(tdsPpm(1.2, 22, k), 707, 1e-6);
  CHECK_NEAR(calibrateTdsK(0.0, 25, 707), 1.0, 0);   // dry probe: no calibration
  CHECK_NEAR(calibrateTdsK(1.0, 25, 50), 1.0, 0);    // k = 0.14: a wiring fault, refused

  // turbidity: clear water reads 0 at its own calibrated voltage, cloudier water reads more, capped at 3000
  CHECK_NEAR(turbidityNtu(3.9, 3.9), 0, 0);
  CHECK_NEAR(turbidityNtu(4.3, 3.9), 0, 0);
  CHECK(turbidityNtu(3.7, 3.9) > 0);
  CHECK(turbidityNtu(3.3, 3.9) > turbidityNtu(3.7, 3.9));
  CHECK_NEAR(turbidityNtu(2.5 * 3.9 / 4.2, 3.9), 3000, 1e-9);
  CHECK_NEAR(turbidityNtu(1.0, 3.9), 3000, 0);
  CHECK(std::isnan(turbidityNtu(0, 3.9)));
  // uncalibrated: the maker's curve as is; 4.2 V is its clear point
  CHECK_NEAR(turbidityNtu(4.2, 0), 0, 0);
  CHECK_NEAR(turbidityNtu(3.0, 0), -1120.4 * 9 + 5742.3 * 3 - 4352.9, 1e-9);

  // SCD40: the datasheet's CRC example (0xBEEF -> 0x92), and a decoded measurement
  const uint8_t beef[2] = {0xBE, 0xEF};
  CHECK(scdCrc(beef, 2) == 0x92);
  uint8_t frame[9] = {0x03, 0x2A, 0, 0x66, 0x66, 0, 0x5E, 0xB8, 0};  // 810 ppm, 25.0 C, 37.0 %
  frame[2] = scdCrc(frame, 2);
  frame[5] = scdCrc(frame + 3, 2);
  frame[8] = scdCrc(frame + 6, 2);
  ScdReading r;
  CHECK(scdDecode(frame, r));
  CHECK_NEAR(r.co2Ppm, 810, 0);
  CHECK_NEAR(r.tempC, -45 + 175.0 * 0x6666 / 65535.0, 1e-9);
  CHECK_NEAR(r.humidityPct, 100.0 * 0x5EB8 / 65535.0, 1e-9);
  frame[8] ^= 1;  // one flipped bit
  CHECK(!scdDecode(frame, r));
  uint8_t empty[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
  empty[2] = scdCrc(empty, 2); empty[5] = scdCrc(empty + 3, 2); empty[8] = scdCrc(empty + 6, 2);
  CHECK(!scdDecode(empty, r));  // CO2 0 = no data yet

  // flood: 1000 us of echo at 20 C, there and back
  CHECK_NEAR(echoToCm(1000, 20), (331.3 + 0.606 * 20) / 10000.0 * 1000 / 2, 1e-9);
  CHECK_NEAR(floodDepthCm(60, 44), 16, 1e-9);
  CHECK_NEAR(floodDepthCm(60, 60.8), 0, 0);   // noise on a dry floor
  CHECK(std::isnan(floodDepthCm(60, 0)));     // no echo
  CHECK_NEAR(median(std::vector<double>{5, 1, 9, 3}), 4, 0);
  CHECK(std::isnan(median(std::vector<double>())));
}

static std::vector<Field> water(double tds, double ntu) {
  std::vector<Field> f;
  f.push_back(Field{"tds_ppm", tds, 0});
  f.push_back(Field{"turbidity_ntu", ntu, 1});
  return f;
}

static void testSendRule() {
  SendRule rule;
  rule.periodS = 60;
  rule.minGapS = 3;
  rule.deltas.push_back(50);   // tds
  rule.deltas.push_back(1.0);  // turbidity
  SendState st;
  CHECK(shouldSend(rule, st, water(250, 1), 0));  // the first reading always goes
  markSent(st, water(250, 1), 0);
  CHECK(!shouldSend(rule, st, water(260, 1.2), 10));   // small moves wait for the period
  CHECK(shouldSend(rule, st, water(260, 1.2), 60));    // the period
  CHECK(!shouldSend(rule, st, water(1400, 1), 2));     // a big move inside the minimum gap waits
  CHECK(shouldSend(rule, st, water(1400, 1), 3));      // ... then goes at once: the salty cup
  CHECK(shouldSend(rule, st, water(250, 2.5), 3));     // either value can trigger it
  CHECK(shouldSend(rule, st, water(250, NAN), 3));     // a probe that disappears is news too
}

static void testIds() {
  IdCounter c(0, 100);
  bool persist = false;
  CHECK(c.take(persist) == 1);
  CHECK(persist);                 // first id of a block: the block is written first
  CHECK(c.reservedUpTo() == 101);
  uint32_t last = 0;
  for (int i = 0; i < 150; i++) last = c.take(persist);
  CHECK(last == 151);
  // reboot: start from what was written; the new ids are all above every id used before
  IdCounter after(c.reservedUpTo(), 100);
  CHECK(after.take(persist) > last);
}

static void testBacklog() {
  Backlog b(3);
  CHECK_EQ(b.batch(0), "[]");
  b.push("{\"a\":1}");
  b.push("{\"a\":2}");
  CHECK_EQ(b.batch(0), "[{\"a\":1},{\"a\":2}]");
  CHECK_EQ(b.batch(1), "[{\"a\":1}]");
  b.push("{\"a\":3}");
  b.push("{\"a\":4}");  // full: the oldest goes, and is counted
  CHECK(b.size() == 3);
  CHECK(b.dropped() == 1);
  CHECK_EQ(b.batch(0), "[{\"a\":2},{\"a\":3},{\"a\":4}]");
  b.pop(2);
  CHECK_EQ(b.batch(0), "[{\"a\":4}]");
  b.pop(5);
  CHECK(b.size() == 0);

  CHECK(afterReply(200) == SENT);
  CHECK(afterReply(422) == DISCARD);
  CHECK(afterReply(0) == RETRY);
  CHECK(afterReply(401) == RETRY);
  CHECK(afterReply(429) == RETRY);
  CHECK(afterReply(503) == RETRY);
  CHECK_NEAR(backoffS(1), 2, 0);
  CHECK_NEAR(backoffS(3), 8, 0);
  CHECK_NEAR(backoffS(20), 60, 0);
}

static void testLimits() {
  Limits l;
  std::string json =
      "{\"water_tds_max_ppm\":{\"value\":900,\"unit\":\"ppm\",\"op\":\">\"},"
      "\"water_turbidity_max_ntu\":{\"value\":4.5,\"unit\":\"NTU\"},"
      "\"air_co2_stale_ppm\":{\"unit\":\"ppm\",\"value\":1100},"
      "\"plausible_air_co2_ppm\":{\"value\":[0,1000000]},"
      "\"flood_depth_closed_cm\":{\"value\":12,\"unit\":\"cm\"}}";
  CHECK(readLimits(json, l) == 4);  // air_co2_danger_ppm is missing: it keeps its default
  CHECK_NEAR(l.tdsMaxPpm, 900, 0);
  CHECK_NEAR(l.turbidityMax, 4.5, 0);
  CHECK_NEAR(l.co2StalePpm, 1100, 0);
  CHECK_NEAR(l.co2DangerPpm, 5000, 0);
  CHECK_NEAR(l.floodClosedCm, 12, 0);
  double x = -1;
  CHECK(!findLimit("{\"other\":{\"value\":3}}", "water_tds_max_ppm", x));
  CHECK(!findLimit("{\"water_tds_max_ppm\":{\"unit\":\"ppm\"},\"x\":{\"value\":3}}", "water_tds_max_ppm", x));
  CHECK_NEAR(x, -1, 0);

  Limits d;
  CHECK(localAlarm(d, 250, 1, 800, 2) == CLEAR);
  CHECK(localAlarm(d, 1400, 1, 800, 2) == DANGER);   // salty: do not drink
  CHECK(localAlarm(d, 250, 7, 800, 2) == DANGER);    // cloudy: do not drink
  CHECK(localAlarm(d, 250, 1, 1200, 2) == WARN);     // stale air
  CHECK(localAlarm(d, 250, 1, 6000, 2) == DANGER);   // dangerous air
  CHECK(localAlarm(d, 250, 1, 800, 16) == WARN);     // flooded
  CHECK(localAlarm(d, NAN, NAN, NAN, NAN) == CLEAR); // absent sensors never alarm
}

int main() {
  testSha256();
  testHmac();
  testNumbers();
  testTimeAndMessage();
  testSensors();
  testSendRule();
  testIds();
  testBacklog();
  testLimits();
  std::printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
