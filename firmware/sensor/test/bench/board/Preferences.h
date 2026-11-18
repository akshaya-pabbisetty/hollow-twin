#pragma once
#include "Arduino.h"
class Preferences {
 public:
  bool begin(const char*, bool = false, const char* = nullptr) { return true; }
  uint32_t getUInt(const char* k, uint32_t d = 0) { auto& f = flash(); return f.count(k) ? (uint32_t)std::stoul(f[k]) : d; }
  size_t putUInt(const char* k, uint32_t v) { flash()[k] = std::to_string(v); flashSave(); return 4; }
  double getDouble(const char* k, double d = NAN) { auto& f = flash(); return f.count(k) ? std::stod(f[k]) : d; }
  size_t putDouble(const char* k, double v) { char b[64]; std::snprintf(b, sizeof b, "%.17g", v); flash()[k] = b; flashSave(); return 8; }
  bool remove(const char* k) { flash().erase(k); flashSave(); return true; }
};
