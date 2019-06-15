#!/bin/bash

[ -z "$1" ] && echo "missing host name" && exit

echo "HOST NAME=${1}"
sudo echo "${1}" > /etc/hostname
sudo echo "127.0.0.1 ${1}" >> /etc/hosts
sudo hostname "${1}"

echo "updated host name. reboot required"
