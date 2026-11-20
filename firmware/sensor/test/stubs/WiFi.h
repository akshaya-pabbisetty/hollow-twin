#pragma once
#include "Arduino.h"
typedef enum { WL_IDLE_STATUS = 0, WL_CONNECTED = 3 } wl_status_t;
typedef enum { WIFI_OFF = 0, WIFI_STA = 1 } wifi_mode_t;
class IPAddress { public: String toString() const { return String(); } };
class WiFiClass {
 public:
  bool mode(wifi_mode_t) { return true; }
  bool setAutoReconnect(bool) { return true; }
  wl_status_t begin(const char*, const char*) { return WL_IDLE_STATUS; }
  wl_status_t status() { return WL_IDLE_STATUS; }
  IPAddress localIP() { return IPAddress(); }
};
extern WiFiClass WiFi;
class WiFiClient { public: virtual ~WiFiClient() {} };
void configTime(long, int, const char*, const char* = nullptr, const char* = nullptr);
