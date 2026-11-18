// A stand-in for the sensor node: the same hollow_core.h the ESP32 runs, driven from text lines, so e2e.mjs can send
// its messages to the real API. Only the board's sensors and radio are missing.
//
//   sim <device> <block> <key>   then lines on standard input:
//     msg <counter> <unix seconds> <kind> <name>=<value>:<decimals> ...   -> one message as JSON
//     fmt <value> <decimals>                                              -> the number as the node writes it
//     limits <file>                                                       -> the five limits read from a GET /limits reply
//     alarm <tds> <turbidity> <co2> <flood>  (after limits; "nan" = no sensor) -> 0 clear, 1 warn, 2 danger
//   An empty <key> ("-") sends unsigned messages.
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "hollow_core.h"

using namespace hollow;

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: sim <device> <block> <key or ->\n");
    return 2;
  }
  std::string device = argv[1], block = argv[2], key = argv[3];
  if (key == "-") key = "";
  Limits limits;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd;
    in >> cmd;
    if (cmd == "msg") {
      unsigned long counter = 0;
      long long unix = 0;
      std::string kind, item;
      in >> counter >> unix >> kind;
      std::vector<Field> fields;
      while (in >> item) {
        size_t eq = item.find('='), colon = item.rfind(':');
        if (eq == std::string::npos || colon == std::string::npos || colon < eq) continue;
        Field f;
        f.key = item.substr(0, eq);
        f.value = std::strtod(item.substr(eq + 1, colon - eq - 1).c_str(), nullptr);
        f.decimals = std::atoi(item.substr(colon + 1).c_str());
        fields.push_back(f);
      }
      Message m;
      if (!buildMessage(device, block, (uint32_t)counter, isoTime(unix), kind, fields, key, m)) {
        std::cout << "ERROR bad name" << std::endl;
        continue;
      }
      std::cout << messageJson(m) << std::endl;
    } else if (cmd == "fmt") {
      double v = 0;
      int d = 0;
      in >> v >> d;
      std::cout << formatNumber(v, d) << std::endl;
    } else if (cmd == "limits") {
      std::string file;
      in >> file;
      std::ifstream f(file.c_str());
      std::stringstream all;
      all << f.rdbuf();
      int n = readLimits(all.str(), limits);
      std::cout << n << " " << limits.tdsMaxPpm << " " << limits.turbidityMax << " " << limits.co2StalePpm << " "
                << limits.co2DangerPpm << " " << limits.floodClosedCm << std::endl;
    } else if (cmd == "alarm") {
      std::string a, b, c, d;
      in >> a >> b >> c >> d;
      std::cout << (int)localAlarm(limits, std::strtod(a.c_str(), nullptr), std::strtod(b.c_str(), nullptr),
                                   std::strtod(c.c_str(), nullptr), std::strtod(d.c_str(), nullptr))
                << std::endl;
    }
  }
  return 0;
}
