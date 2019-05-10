#!/bin/bash

[ -z "$1" ] && echo "missing ssid" && exit
[ -z "$2" ] && echo "missing psk" && exit

echo "SSID=${1}"
echo "PSK=${2}"

sudo cat > /etc/wpa_supplicant/wpa_supplicant.conf << EOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

network={
    ssid="${1}"
    psk="${2}"
}
EOF

sudo cat /etc/wpa_supplicant/wpa_supplicant.conf

echo "updated wifi settings. reboot required"
