// Hollow Twin sensor node (lane 3): an ESP32 that watches one block's tap water, air and tunnel floor.
//
// What it does, every 2 seconds:
//   - reads TDS and turbidity (water), CO2, temperature and humidity (air), and the flood depth;
//   - sends a CONTRACT.md message for a kind once a minute, or at once when a value moves (a salty cup arrives
//     in seconds), each one signed with the node's key so the API stores it as verified;
//   - holds messages while the API is unreachable and uploads them as one array, with their original times,
//     when it comes back (CONTRACT.md section 5);
//   - lights its red LED and buzzer from the API's own published limits, kept in flash, so it still warns the
//     people in the block when the Directorate cuts the network.
//
// Everything that decides anything is in hollow_core.h, which the laptop tests in ../test check against the
// real API. This file only touches the hardware. Board: any ESP32 DevKit, Arduino core 2.x or 3.x. No libraries
// to install. Wiring, calibration and the demo: ../README.md.
#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <time.h>

#include "config.h"
#include "hollow_core.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define USING_EXAMPLE_SECRETS 0
#else
#include "secrets.example.h"
#define USING_EXAMPLE_SECRETS 1
#endif

using hollow::Field;

// ---------------------------------------------------------------- state

static Preferences prefs;                       // flash: calibration, limits, the id counter
static hollow::IdCounter* ids = nullptr;
static hollow::Backlog backlog(BACKLOG_MAX);
static hollow::Limits limits;
static hollow::SendRule waterRule, airRule, floodRule;
static hollow::SendState waterSent, airSent, floodSent;

static double tdsK = 1.0;                          // TDS calibration factor (cal tds <ppm>)
static double clearVolts = 0;                      // turbidity probe volts in clear water (cal clear); 0 = maker's curve
static double mountHeightCm = DEFAULT_MOUNT_HEIGHT_CM;
static double waterTempC = DEFAULT_WATER_TEMP_C;

static hollow::RollingMedian turbidityFilter(5, 3);  // last 5 readings (10 s), none until 3: see hollow_core.h
static double lastTds = NAN, lastTurbidity = NAN, lastCo2 = NAN, lastAirTemp = NAN, lastHumidity = NAN, lastFlood = NAN;
static hollow::Alarm alarmLevel = hollow::CLEAR;
static bool muted = false;
static bool apiReachable = false;
static bool scdStarted = false;
static int uploadFailures = 0;
static unsigned long nextSampleAt = 0, nextUploadAt = 0, nextLimitsAt = 0, lastStatusPrint = 0;
static unsigned long sentTotal = 0;

// ---------------------------------------------------------------- time

// UTC seconds once the network clock is set; before that, seconds since boot (a 1970 time, which the API replaces
// with its receive time and marks time_estimated).
static bool clockSet() { return time(nullptr) > 1600000000; }
static int64_t nowUnix() { return clockSet() ? (int64_t)time(nullptr) : (int64_t)(millis() / 1000); }
static double uptimeS() { return millis() / 1000.0; }
// true once millis() has reached `at`, correct across millis() wrapping to 0 after 49 days
static bool due(unsigned long at) { return (long)(millis() - at) >= 0; }

// ---------------------------------------------------------------- sensors

// One analog measurement in volts at the pin: the median of three averages of ADC_SAMPLES readings, through the
// ESP32's factory-calibrated millivolt reading (default 11 dB range, about 0.15 to 3.1 V).
static double readPinVolts(int pin, int samples = ADC_SAMPLES) {
  std::vector<double> means;
  for (int m = 0; m < 3; m++) {
    uint32_t sum = 0;
    for (int i = 0; i < samples; i++) { sum += analogReadMilliVolts(pin); delayMicroseconds(50); }
    means.push_back(sum / (double)samples / 1000.0);
  }
  return hollow::median(means);
}

#if HAS_SCD40
static const uint8_t SCD_ADDR = 0x62;

static bool scdCommand(uint16_t cmd) {
  Wire.beginTransmission(SCD_ADDR);
  Wire.write((uint8_t)(cmd >> 8));
  Wire.write((uint8_t)(cmd & 0xFF));
  return Wire.endTransmission() == 0;
}

static bool scdRead(uint16_t cmd, uint8_t* out, size_t n) {
  if (!scdCommand(cmd)) return false;
  delay(2);  // the datasheet's execution time is 1 ms
  if (Wire.requestFrom((int)SCD_ADDR, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) out[i] = (uint8_t)Wire.read();
  return true;
}

static void scdStart() {
  scdCommand(0x3F86);  // stop_periodic_measurement, in case it was left running
  delay(500);          // the datasheet's wait after stopping
  scdStarted = scdCommand(0x21B1);  // start_periodic_measurement: a new reading every 5 s
  Serial.println(scdStarted ? "SCD40: measuring every 5 s" : "SCD40: not found on I2C (check SDA/SCL and power)");
}

// true and fills the reading when a new measurement is ready
static bool scdPoll(hollow::ScdReading& r) {
  if (!scdStarted) return false;
  uint8_t st[3];
  if (!scdRead(0xE4B8, st, 3) || hollow::scdCrc(st, 2) != st[2]) return false;  // get_data_ready_status
  if ((((st[0] << 8) | st[1]) & 0x07FF) == 0) return false;                     // no new data yet
  uint8_t frame[9];
  return scdRead(0xEC05, frame, 9) && hollow::scdDecode(frame, r);             // read_measurement
}
#endif

#if HAS_FLOOD
// Distance to the water (or floor) in cm: the median of five pings, NAN if none came back.
static double pingCm() {
  std::vector<double> d;
  double airT = std::isfinite(lastAirTemp) ? lastAirTemp : 20.0;
  for (int i = 0; i < 5; i++) {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(4);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);  // 30 ms = about 5 m: further is "no echo"
    if (us > 0) d.push_back(hollow::echoToCm((double)us, airT));
    delay(60);  // let the last ping's echoes die away
  }
  return hollow::median(d);
}
#endif

// ---------------------------------------------------------------- messages

static void enqueue(const char* kind, const std::vector<Field>& fields) {
  bool persist = false;
  uint32_t counter = ids->take(persist);
  if (persist) prefs.putUInt("idnext", ids->reservedUpTo());  // written BEFORE the id is used
  hollow::Message m;
  if (!hollow::buildMessage(DEVICE_ID, BLOCK_ID, counter, hollow::isoTime(nowUnix()), kind, fields, DEVICE_KEY, m)) {
    Serial.println("ERROR: DEVICE_ID, BLOCK_ID or a value name breaks the contract's character rules");
    return;
  }
  backlog.push(hollow::messageJson(m));
  Serial.printf("queued %s %s %s\n", m.id.c_str(), kind, m.values.c_str());
}

static void sample() {
  // Reading the sensors blocks for about 0.4 s (the ultrasonic pings). Silence the buzzer first so a beep can never
  // stick on through it.
  digitalWrite(PIN_BUZZER, LOW);
#if HAS_TDS || HAS_TURBIDITY
  {
    std::vector<Field> w;
#if HAS_TDS
    double v = readPinVolts(PIN_TDS);
    lastTds = v > 0.02 ? hollow::tdsPpm(v, waterTempC, tdsK) : NAN;  // under 20 mV: probe unplugged
    w.push_back(Field{"tds_ppm", lastTds, 0});
#endif
#if HAS_TURBIDITY
    double probeV = readPinVolts(PIN_TURBIDITY, TURBIDITY_ADC_SAMPLES) * TURBIDITY_DIVIDER;
    lastTurbidity = hollow::turbidityReported(turbidityFilter.add(hollow::turbidityNtu(probeV, clearVolts)),
                                              TURBIDITY_DETECTION_LIMIT_NTU);
    w.push_back(Field{"turbidity_ntu", lastTurbidity, 0});
#endif
    bool any = false;
    for (size_t i = 0; i < w.size(); i++) any = any || std::isfinite(w[i].value);
    hollow::SendReason why = any ? hollow::sendReason(waterRule, waterSent, w, uptimeS()) : hollow::NO_SEND;
    if (why != hollow::NO_SEND) {
      enqueue("water", w);
      hollow::markSent(waterSent, w, uptimeS(), why);
    }
  }
#endif

#if HAS_SCD40
  {
    hollow::ScdReading r;
    if (scdPoll(r)) {
      lastCo2 = r.co2Ppm;
      lastAirTemp = r.tempC;
      lastHumidity = r.humidityPct;
    }
    if (std::isfinite(lastCo2)) {
      std::vector<Field> a;
      a.push_back(Field{"co2_ppm", lastCo2, 0});
      a.push_back(Field{"temp_c", lastAirTemp, 1});
      a.push_back(Field{"humidity_pct", lastHumidity, 1});
      hollow::SendReason why = hollow::sendReason(airRule, airSent, a, uptimeS());
      if (why != hollow::NO_SEND) {
        enqueue("air", a);
        hollow::markSent(airSent, a, uptimeS(), why);
      }
    }
  }
#endif

#if HAS_FLOOD
  {
    // not calibrated: no ping, no reading (a wrong mount height would report a dry floor as flooded)
    lastFlood = mountHeightCm > 0 ? hollow::floodDepthCm(mountHeightCm, pingCm()) : NAN;
    if (std::isfinite(lastFlood)) {
      std::vector<Field> f;
      f.push_back(Field{"depth_cm", lastFlood, 1});
      hollow::SendReason why = hollow::sendReason(floodRule, floodSent, f, uptimeS());
      if (why != hollow::NO_SEND) {
        enqueue("flood", f);
        hollow::markSent(floodSent, f, uptimeS(), why);
      }
    }
  }
#endif

  alarmLevel = hollow::localAlarm(limits, lastTds, lastTurbidity, lastCo2, lastFlood);
}

// ---------------------------------------------------------------- the API

// https (a hosted API) or http (a laptop on the bench). The hosted certificate is not pinned: the node has no
// clock or certificate store worth trusting at boot, and the signature, not TLS, is what proves the reading.
static int httpRequest(const char* method, const String& path, const String& body, String* reply) {
  // The board waits here. Silence the buzzer first so a beep can never stick on through a slow network, and keep
  // the waits short: an API that is down costs a few seconds, not the alarm.
  digitalWrite(PIN_BUZZER, LOW);
  String url = String(API_URL) + path;
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  bool https = url.startsWith("https://");
  if (https) secure.setInsecure();
  if (!(https ? http.begin(secure, url) : http.begin(plain, url))) return 0;
  http.setConnectTimeout(3000);
  http.setTimeout(5000);
  if (String(INGEST_KEY).length()) http.addHeader("x-api-key", INGEST_KEY);
  int code;
  if (String(method) == "POST") {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(body);
  } else {
    code = http.GET();
  }
  if (code > 0 && reply) *reply = http.getString();
  http.end();
  return code > 0 ? code : 0;
}

static void upload() {
  if (!backlog.size() || WiFi.status() != WL_CONNECTED || !due(nextUploadAt)) return;
  size_t n = backlog.size() < (size_t)BATCH_MAX ? backlog.size() : (size_t)BATCH_MAX;
  String reply;
  int code = httpRequest("POST", "/ingest", String(backlog.batch(n).c_str()), &reply);
  hollow::Outcome o = hollow::afterReply(code);
  if (o == hollow::SENT || o == hollow::DISCARD) {
    backlog.pop(n);
    sentTotal += n;
    uploadFailures = 0;
    apiReachable = true;
    nextUploadAt = millis();
    Serial.printf("API %d: %u message(s) %s. %s\n", code, (unsigned)n, o == hollow::SENT ? "sent" : "refused",
                  reply.substring(0, 200).c_str());
    if (reply.indexOf("\"problems\"") >= 0) Serial.println("  the API refused some: read the reply above (a wrong DEVICE_KEY shows as a forgery)");
  } else {
    uploadFailures++;
    apiReachable = false;
    nextUploadAt = millis() + (unsigned long)(hollow::backoffS(uploadFailures) * 1000);
    if (code == 401) Serial.println("API 401: INGEST_KEY is wrong or missing");
    else if (code == 429) Serial.println("API 429: too many messages, waiting");
    else Serial.printf("API unreachable (%d): holding %u message(s), retry in %.0f s\n", code, (unsigned)backlog.size(),
                       hollow::backoffS(uploadFailures));
  }
}

static void saveLimits() {
  prefs.putDouble("l_tds", limits.tdsMaxPpm);
  prefs.putDouble("l_ntu", limits.turbidityMax);
  prefs.putDouble("l_co2w", limits.co2StalePpm);
  prefs.putDouble("l_co2d", limits.co2DangerPpm);
  prefs.putDouble("l_flood", limits.floodClosedCm);
}

static void refreshLimits() {
  if (WiFi.status() != WL_CONNECTED || !due(nextLimitsAt)) return;
  String reply;
  int code = httpRequest("GET", "/limits", "", &reply);
  if (code == 200 && hollow::readLimits(std::string(reply.c_str()), limits) == 5) {
    saveLimits();
    apiReachable = true;
    nextLimitsAt = millis() + LIMITS_REFRESH_MS;
    Serial.printf("limits from the API: TDS %.0f ppm, turbidity %.1f NTU, CO2 %.0f/%.0f ppm, flood %.0f cm\n",
                  limits.tdsMaxPpm, limits.turbidityMax, limits.co2StalePpm, limits.co2DangerPpm, limits.floodClosedCm);
  } else {
    nextLimitsAt = millis() + 60000UL;  // try again in a minute; the copy in flash stays in use
  }
}

// ---------------------------------------------------------------- lights and buzzer

static void indicate() {
  unsigned long t = millis();
  // status: solid = API reachable and nothing waiting; blinking = holding messages or offline. Wi-Fi down counts as
  // offline at once, not only after the next upload fails, so unplugging the router shows on the board immediately.
  bool holding = backlog.size() > 0 || !apiReachable || WiFi.status() != WL_CONNECTED;
  digitalWrite(PIN_STATUS_LED, holding ? ((t / 250) % 2) : HIGH);
  // alarm: danger = solid red and a 250 ms beep every 1.25 s; warning = slow red blink, no sound. The beep's
  // rhythm is deliberately not a divisor of the 2 s sampling, so the 0.4 s sensor read can never swallow every beep.
  if (alarmLevel == hollow::DANGER) {
    digitalWrite(PIN_ALARM_LED, HIGH);
    digitalWrite(PIN_BUZZER, (!muted && (t % 1250) < 250) ? HIGH : LOW);
  } else if (alarmLevel == hollow::WARN) {
    digitalWrite(PIN_ALARM_LED, (t / 1000) % 2);
    digitalWrite(PIN_BUZZER, LOW);
  } else {
    digitalWrite(PIN_ALARM_LED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// ---------------------------------------------------------------- serial commands (115200 baud, newline)

static void printStatus() {
  Serial.printf("%s in %s | clock %s | Wi-Fi %s | API %s | queued %u, sent %lu, dropped %lu\n", DEVICE_ID, BLOCK_ID,
                clockSet() ? hollow::isoTime(nowUnix()).c_str() : "not set yet",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "down",
                apiReachable ? "reachable" : "not reached", (unsigned)backlog.size(), sentTotal, backlog.dropped());
  Serial.printf("  water: TDS %.0f ppm (k %.3f%s, water %.1f C), turbidity %.1f NTU (%s)\n", lastTds, tdsK,
                tdsK == 1.0 ? ", maker's default: run cal tds" : "", waterTempC, lastTurbidity,
                clearVolts > 0.5 ? "calibrated" : "NOT SENT until you run cal clear");
  Serial.printf("  air: CO2 %.0f ppm, %.1f C, %.1f %% | flood: %.1f cm (%s)\n", lastCo2, lastAirTemp, lastHumidity,
                lastFlood, mountHeightCm > 0 ? "calibrated" : "NOT SENT until you run cal floor");
  Serial.printf("  alarm: %s%s | signed: %s\n", alarmLevel == hollow::DANGER ? "DANGER" : alarmLevel == hollow::WARN ? "warning" : "clear",
                muted ? " (muted)" : "", String(DEVICE_KEY).length() ? "yes" : "NO (set DEVICE_KEY in secrets.h)");
}

static void command(String line) {
  line.trim();
  int sp = line.indexOf(' ');
  String cmd = sp < 0 ? line : line.substring(0, sp);
  String arg = sp < 0 ? "" : line.substring(sp + 1);
  arg.trim();
  if (cmd == "status" || cmd == "") {
    printStatus();
#if HAS_TDS
  } else if (cmd == "cal" && arg.startsWith("tds")) {
    // probe in a solution of known TDS: cal tds 707
    double known = arg.substring(3).toFloat();
    double v = readPinVolts(PIN_TDS);
    double k = hollow::calibrateTdsK(v, waterTempC, known);
    if (known <= 0 || k == 1.0) {
      Serial.printf("not calibrated: give the solution's ppm (cal tds 707) with the probe in it (read %.3f V)\n", v);
    } else {
      tdsK = k;
      prefs.putDouble("tds_k", tdsK);
      Serial.printf("TDS calibrated: k = %.3f (%.3f V reads %.0f ppm)\n", tdsK, v, hollow::tdsPpm(v, waterTempC, tdsK));
    }
#endif
#if HAS_TURBIDITY
  } else if (cmd == "cal" && arg == "clear") {
    // turbidity probe in clean, clear water
    double v = readPinVolts(PIN_TURBIDITY, TURBIDITY_ADC_SAMPLES) * TURBIDITY_DIVIDER;
    if (v < 2.5) {
      Serial.printf("not calibrated: %.2f V is too low for clear water (check the divider and that the probe is in clear water)\n", v);
    } else {
      clearVolts = v;
      turbidityFilter.clear();  // readings from before calibration mean nothing now
      prefs.putDouble("clear_v", clearVolts);
      Serial.printf("turbidity calibrated: clear water = %.2f V at the probe\n", clearVolts);
    }
#endif
#if HAS_FLOOD
  } else if (cmd == "cal" && arg == "floor") {
    // sensor in place over a dry floor
    double d = pingCm();
    if (!std::isfinite(d) || d < 2) {
      Serial.println("not calibrated: no echo (check the wiring and that nothing is in front of the sensor)");
    } else {
      mountHeightCm = d;
      prefs.putDouble("mount_cm", mountHeightCm);
      Serial.printf("flood sensor: %.1f cm above the dry floor\n", mountHeightCm);
    }
#endif
  } else if (cmd == "cal" && arg == "reset") {
    tdsK = 1.0;
    clearVolts = 0;
    turbidityFilter.clear();
    mountHeightCm = DEFAULT_MOUNT_HEIGHT_CM;
    prefs.remove("tds_k");
    prefs.remove("clear_v");
    prefs.remove("mount_cm");
    Serial.println("calibration reset to defaults");
  } else if (cmd == "watertemp") {
    double t = arg.toFloat();
    if (t > 0 && t < 60) { waterTempC = t; prefs.putDouble("water_c", waterTempC); Serial.printf("water temperature %.1f C\n", t); }
    else Serial.println("give the water temperature in C: watertemp 21");
  } else if (cmd == "send") {
    waterSent = hollow::SendState();
    airSent = hollow::SendState();
    floodSent = hollow::SendState();
    Serial.println("sending every reading now");
  } else if (cmd == "mute") {
    muted = !muted;
    Serial.println(muted ? "buzzer muted (the red LED still shows danger)" : "buzzer on");
  } else {
    Serial.println("commands: status | cal tds <ppm> | cal clear | cal floor | cal reset | watertemp <C> | send | mute");
  }
}

// ---------------------------------------------------------------- setup and loop

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\nHollow Twin sensor node %s in %s\n", DEVICE_ID, BLOCK_ID);
  if (USING_EXAMPLE_SECRETS) Serial.println("WARNING: no secrets.h: copy secrets.example.h to secrets.h and fill it in");

  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_ALARM_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
#if HAS_FLOOD
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
#endif

  prefs.begin("hollow", false);
  ids = new hollow::IdCounter(prefs.getUInt("idnext", 0), 100);
  tdsK = prefs.getDouble("tds_k", 1.0);
  clearVolts = prefs.getDouble("clear_v", 0);
  mountHeightCm = prefs.getDouble("mount_cm", DEFAULT_MOUNT_HEIGHT_CM);
  waterTempC = prefs.getDouble("water_c", DEFAULT_WATER_TEMP_C);
  limits.tdsMaxPpm = prefs.getDouble("l_tds", limits.tdsMaxPpm);
  limits.turbidityMax = prefs.getDouble("l_ntu", limits.turbidityMax);
  limits.co2StalePpm = prefs.getDouble("l_co2w", limits.co2StalePpm);
  limits.co2DangerPpm = prefs.getDouble("l_co2d", limits.co2DangerPpm);
  limits.floodClosedCm = prefs.getDouble("l_flood", limits.floodClosedCm);

  waterRule.periodS = PERIOD_S; waterRule.minGapS = MIN_GAP_S;
  waterRule.deltas.push_back(DELTA_TDS_PPM);        // same order as the fields in sample()
  waterRule.deltas.push_back(DELTA_TURBIDITY_NTU);
#if !HAS_TDS
  waterRule.deltas.erase(waterRule.deltas.begin());  // turbidity alone
#endif
  airRule.periodS = PERIOD_S; airRule.minGapS = MIN_GAP_S;
  airRule.deltas.push_back(DELTA_CO2_PPM);
  airRule.deltas.push_back(DELTA_AIR_TEMP_C);
  airRule.deltas.push_back(DELTA_HUMIDITY_PCT);
  floodRule.periodS = PERIOD_S; floodRule.minGapS = MIN_GAP_S;
  floodRule.deltas.push_back(DELTA_FLOOD_CM);

#if HAS_SCD40
  Wire.begin(PIN_SDA, PIN_SCL);
  scdStart();
#endif

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // UTC; sets the clock once Wi-Fi is up
  printStatus();  // says which sensors still need calibrating before they send anything
  Serial.println("type `status` or `help` in the serial monitor (115200 baud, newline)");
}

void loop() {
  if (Serial.available()) command(Serial.readStringUntil('\n'));
  unsigned long t = millis();
  if (due(nextSampleAt)) {
    nextSampleAt = t + SAMPLE_MS;
    sample();
  }
  refreshLimits();
  upload();
  indicate();
  if (t - lastStatusPrint >= 60000UL) { lastStatusPrint = t; printStatus(); }
  delay(10);
}
