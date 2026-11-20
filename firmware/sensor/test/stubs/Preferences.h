#pragma once
#include "Arduino.h"
class Preferences {
 public:
  bool begin(const char*, bool = false, const char* = nullptr) { return true; }
  uint32_t getUInt(const char*, uint32_t d = 0) { return d; }
  size_t putUInt(const char*, uint32_t) { return 4; }
  double getDouble(const char*, double d = NAN) { return d; }
  size_t putDouble(const char*, double) { return 8; }
  bool remove(const char*) { return true; }
};
