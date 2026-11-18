#pragma once
#include "WiFi.h"
class HTTPClient {
 public:
  bool begin(WiFiClient&, String) { return true; }
  void setTimeout(uint16_t) {}
  void addHeader(const String&, const String&, bool = false, bool = true) {}
  int POST(String) { return 0; }
  int GET() { return 0; }
  String getString() { return String(); }
  void end() {}
};
