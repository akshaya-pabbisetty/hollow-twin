// Stand-in for the ESP32 Arduino core, ONLY for a syntax check of sensor_node.ino on a laptop (check_sketch.sh).
// Signatures copied from arduino-esp32 (2.x and 3.x). Nothing here runs on a board, and passing this check does not
// prove the real core accepts the sketch: build it in the Arduino IDE for that.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
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
  String substring(unsigned int a) const { return String(s_.substr(a)); }
  String substring(unsigned int a, unsigned int b) const { return String(s_.substr(a, b - a)); }
  void trim() {}
  float toFloat() const { return (float)atof(s_.c_str()); }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator==(const char* o) const { return s_ == o; }
  friend String operator+(const String& a, const String& b) { return String(a.s_ + b.s_); }
 private:
  std::string s_;
};
class HardwareSerial {
 public:
  void begin(unsigned long) {}
  size_t printf(const char*, ...) __attribute__((format(printf, 2, 3))) { return 0; }
  size_t println(const char*) { return 0; }
  int available() { return 0; }
  String readStringUntil(char) { return String(); }
};
extern HardwareSerial Serial;
unsigned long millis();
void delay(uint32_t);
void delayMicroseconds(uint32_t);
void pinMode(uint8_t, uint8_t);
void digitalWrite(uint8_t, uint8_t);
uint32_t analogReadMilliVolts(uint8_t);
unsigned long pulseIn(uint8_t, uint8_t, unsigned long);
