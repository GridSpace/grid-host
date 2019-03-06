#!/bin/bash

avrdude -patmega2560 -cwiring -P/dev/ttyUSB0 -b115200 -D -Uflash:w:/home/pi/firmware/marlin-gb-118.ino.hex:i
