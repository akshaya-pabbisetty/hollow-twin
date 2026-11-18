#!/bin/sh
# Syntax check of sensor_node.ino against stand-ins for the ESP32 core (test/stubs), in every sensor combination
# and two language standards. It catches mistakes in the sketch itself; only the Arduino IDE (or arduino-cli) with
# the real ESP32 core proves the board build. Run from firmware/sensor/test.
set -e
CXX=${CXX:-g++}
for std in gnu++11 gnu++17; do
  for flags in "" "-DHAS_TDS=0" "-DHAS_TURBIDITY=0" "-DHAS_SCD40=0" "-DHAS_FLOOD=0" "-DHAS_TDS=0 -DHAS_TURBIDITY=0" "-DHAS_SCD40=0 -DHAS_FLOOD=0"; do
    $CXX -std=$std -fsyntax-only -Wall -Wextra -Werror -Wno-unused-function -Istubs -I../sensor_node $flags -x c++ ../sensor_node/sensor_node.ino
  done
done
echo "sketch: syntax OK in 7 sensor combinations x 2 standards (against stand-in headers, not the real ESP32 core)"
