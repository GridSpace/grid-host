#!/bin/bash

export HOME=/home/pi
export NODE=$HOME/node/bin/node

export TTY=/dev/ttyUSB0
export BAUD=250000
export SOCKET=4000
export WEBPORT=4080

cd $HOME/grid-host/
while /bin/true; do
	echo "--- starting ---"
	$NODE src/serial.js --port=${TTY} --baud=${BAUD} --webport=${WEBPORT} --webdir=web/marlin --listen=${SOCKET} --dir=$HOME/cache
	echo "--- exited ---"
done
