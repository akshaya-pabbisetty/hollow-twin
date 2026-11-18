// Simulated ESP32 Arduino core for the virtual bench (bench.mjs). Same signatures as arduino-esp32; behind them,
// the world in world.h. Test-only.
#pragma once
#include "world.h"
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
// the sketch's time(nullptr) reads the bench's wall clock, so virtual minutes are real minutes to the API
#define time(x) bench_time(x)

class String {
 public:
  String() {}
  String(const char* c) : s_(c ? c : "") {}
  String(const std::string& s) : s_(s) {}
  const char* c_str() const { return s_.c_str(); }
  unsigned int length() const { return s_.size(); }
  bool startsWith(const String& p) const { return s_.compare(0, p.s_.size(), p.s_) == 0; }
  int indexOf(const char* p) const { size_t i = s_.find(p); return i == std::string::npos ? -1 : (int)i; }
  int indexOf(char c) const { size_t i = s_.find(c); return i == std::string::npos ? -1 : (int)i; }
  String substring(unsigned int a) const { return a >= s_.size() ? String() : String(s_.substr(a)); }
  String substring(unsigned int a, unsigned int b) const { return a >= s_.size() ? String() : String(s_.substr(a, b - a)); }
  void trim() {
    size_t a = s_.find_first_not_of(" \t\r\n"), b = s_.find_last_not_of(" \t\r\n");
    s_ = a == std::string::npos ? "" : s_.substr(a, b - a + 1);
  }
  float toFloat() const { return (float)atof(s_.c_str()); }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator==(const char* o) const { return s_ == o; }
  friend String operator+(const String& a, const String& b) { return String(a.s_ + b.s_); }
  const std::string& str() const { return s_; }
 private:
  std::string s_;
};

class HardwareSerial {
 public:
  void begin(unsigned long) {}
  size_t printf(const char* fmt, ...) __attribute__((format(printf, 2, 3))) {
    char buf[2048];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    W().serialLog += buf;
    std::fputs(buf, stdout);
    return n > 0 ? (size_t)n : 0;
  }
  size_t println(const char* s) { return printf("%s\n", s); }
  int available() { return W().serialIn.empty() ? 0 : 1; }
  String readStringUntil(char) {
    std::string s = W().serialIn.front();
    W().serialIn.pop_front();
    return String(s);
  }
};
static HardwareSerial Serial;

inline unsigned long millis() { return (unsigned long)(W().virtUs / 1000ULL); }
inline void delay(uint32_t ms) { W().virtUs += (uint64_t)ms * 1000ULL; }
inline void delayMicroseconds(uint32_t us) { W().virtUs += us; }
inline void pinMode(uint8_t, uint8_t) {}
inline void digitalWrite(uint8_t pin, uint8_t v) { W().pins[pin] = v ? 1 : 0; }

// ESP32 ADC with factory calibration, 11 dB: about 0.15 to 3.1 V, a little noise.
inline uint32_t analogReadMilliVolts(uint8_t pin) {
  static uint32_t seed = 12345;
  seed = seed * 1103515245u + 12345u;
  double noise = ((seed >> 16) % 11) - 5.0;  // +/- 5 mV per reading, a noisy ESP32 ADC
  double v = 0;
  if (pin == 34) v = tdsVoltsFor(W().tdsTruePpm);
  // through the 10k/20k divider, drifting 1 mV per 5 minutes after boot (warm-up and temperature)
  if (pin == 35) v = W().turbProbeVolts / 1.5 + 0.001 * (W().virtUs / 300e6);
  double mv = v * 1000.0 + noise;
  if (mv < 0) mv = 0;
  if (mv > 3100) mv = 3100;
  return (uint32_t)mv;
}

// Ultrasonic: the echo comes back from the water surface (or the dry floor) at the speed of sound in this air.
inline unsigned long pulseIn(uint8_t, uint8_t, unsigned long timeoutUs) {
  double d = W().floorDistanceCm - W().waterDepthCm;
  double cmPerUs = (331.3 + 0.606 * W().airTempC) / 10000.0;
  double us = 2.0 * d / cmPerUs;
  if (d <= 0 || us > timeoutUs) { W().virtUs += timeoutUs; return 0; }
  W().virtUs += (uint64_t)us;
  return (unsigned long)us;
}
