// The SCD40 on I2C, answering the four commands the sketch uses exactly as the datasheet describes: a new
// measurement every 5 s after start_periodic_measurement, data-ready status, and 9-byte frames with CRC-8.
#pragma once
#include "Arduino.h"
class TwoWire {
 public:
  bool begin(int, int, uint32_t = 0) { return true; }
  void beginTransmission(uint8_t addr) { addr_ = addr; tx_.clear(); }
  size_t write(uint8_t b) { tx_.push_back(b); return 1; }
  uint8_t endTransmission() {
    if (addr_ != 0x62 || !W().scdPresent) return 2;  // NACK: nobody at that address
    if (tx_.size() != 2) return 4;
    uint16_t cmd = (uint16_t)((tx_[0] << 8) | tx_[1]);
    rx_.clear();
    if (cmd == 0x21B1) { running_ = true; startUs_ = W().virtUs; lastReadUs_ = W().virtUs; }
    else if (cmd == 0x3F86) running_ = false;
    else if (cmd == 0xE4B8) word(ready() ? 0x8006 : 0x8000);
    else if (cmd == 0xEC05) {
      if (!ready()) return 0;  // the real sensor answers with nothing useful before data is ready
      lastReadUs_ = W().virtUs;
      word((uint16_t)W().co2);
      word((uint16_t)std::lround((W().airTempC + 45.0) * 65535.0 / 175.0));
      word((uint16_t)std::lround(W().humidity * 65535.0 / 100.0));
    } else return 4;
    return 0;
  }
  uint8_t requestFrom(int addr, int n) {
    if (addr != 0x62 || !W().scdPresent || (int)rx_.size() < n) return 0;
    return (uint8_t)n;
  }
  int read() { if (rx_.empty()) return -1; int b = rx_.front(); rx_.erase(rx_.begin()); return b; }

 private:
  bool ready() const { return running_ && W().virtUs - lastReadUs_ >= 5000000ULL; }
  void word(uint16_t w) {
    uint8_t b[2] = {(uint8_t)(w >> 8), (uint8_t)(w & 0xFF)};
    uint8_t crc = 0xFF;
    for (int i = 0; i < 2; i++) { crc ^= b[i]; for (int k = 0; k < 8; k++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1); }
    rx_.push_back(b[0]); rx_.push_back(b[1]); rx_.push_back(crc);
  }
  uint8_t addr_ = 0;
  std::vector<uint8_t> tx_, rx_;
  bool running_ = false;
  uint64_t startUs_ = 0, lastReadUs_ = 0;
};
static TwoWire Wire;
