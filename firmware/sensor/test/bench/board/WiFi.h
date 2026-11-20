#pragma once
#include "Arduino.h"
typedef enum { WL_IDLE_STATUS = 0, WL_CONNECTED = 3, WL_DISCONNECTED = 6 } wl_status_t;
typedef enum { WIFI_OFF = 0, WIFI_STA = 1 } wifi_mode_t;
class IPAddress { public: String toString() const { return String("10.0.0.42"); } };
class WiFiClass {
 public:
  bool mode(wifi_mode_t) { return true; }
  bool setAutoReconnect(bool) { return true; }
  wl_status_t begin(const char*, const char*) { return status(); }
  wl_status_t status() { return W().wifiUp ? WL_CONNECTED : WL_DISCONNECTED; }
  IPAddress localIP() { return IPAddress(); }
};
static WiFiClass WiFi;
class WiFiClient { public: virtual ~WiFiClient() {} };
inline void configTime(long, int, const char*, const char* = nullptr, const char* = nullptr) {}
