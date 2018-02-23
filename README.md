# grid-host: multi-target file sender for 3d printers and cnc mills

`grid-host` is a multi-target file sender with pluggable gcode
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

`--port` Port for HTTP (defaults to 8081)

`--https-port` Port for HTTPS (defaults to none/off)

`--ssl-cert` File path for SSL server cert (required for HTTPS)

`--ssl-key` File path for SSL server key (required for HTTPS)

`--config` path to config file (overrides command-line options)

`--target` device target in the form [name:host-name-or-address]

## Sample Config File:

```
{
	"port": 8080,
	"https-port": 8443,
	"ssl-cert": "/path/to/cert",
	"ssl-key": "/path/to/key",
	"targets": {
		"my_target": {
			"host": "host-name-or-address",
			"filter": "gpx"
		}
	},
	"filters": {
		"gpx": {
			"path": "path_to_gpx",
			"args": [ "{file_in}", "{file_out}" ]
		}
	},
}
```

## Generate a Self-Signed Cert

```openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout ssl.key -out ssl.crt```
