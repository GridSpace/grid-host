# Grid:Host -- multi-target file sender

`Grid:Host` is a multi-target file sender with pluggable gcode
translation. this is primarily intended as a print target for
[KIRI:MOTO](https://grid.space/kiri/) to enable sending of files
to networked 3d printers and cnc mills.

It is different from OctoPrint in that it is mainly designed with
multiple targets in mind rather than acting as a host for a single
printer. It is vastly simpler to setup and run delegating the more
complex integration tasks to modules or external programs like
Octoprint.


## Usage:

    bin/grid-host [options]


## Options:

`--port` Port for HTTP (defaults to 8111)

`--https-port` Port for HTTPS (defaults to none/off)

`--ssl-cert` File path for SSL server cert (required for HTTPS)

`--ssl-key` File path for SSL server key (required for HTTPS)

`--config` path to config file (overrides command-line options)

`--target` device target in the form [name:host-name-or-address]


## Sample Config File:

rename etc/config.json.sample to etc/config.json

currently built-in filter types:

* gx - flashforge finder printers
* n2 - raise3d n-series printers
* x3g - gcode to x3g conversion using GPX for Makerbots
* scp - file copy via scp to host target
* post - http post to target (flashair wifi sd cards, etc)


## Generate a Self-Signed Cert

    openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout etc/ssl.key -out etc/ssl.crt


## Generate Certs using Cerbot

	certbot --text --agree-tos --email your@address -d local.grid.space --manual --preferred-challenges dns --expand --renew-by-default --manual-public-ip-logging-ok --config-dir `pwd`/tmp/cb --work-dir `pwd`/tmp/cb --logs-dir `pwd`/tmp/cb certonly


## Starting Grid:Host

    bin/grid-host -config etc/config.json
