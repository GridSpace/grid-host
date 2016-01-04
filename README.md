# grid-print: a simple 3d print file sender

`grid-print` is a simple 3d print sender with optional gcode
translation. this is primarily intended as a print target for
[KIRI:MOTO](https://grid.space/kiri/)
to enable sending of files to FlashAir SD cards.

## Usage:

    bin/grid-print [options]

## Options:

`--port` Port for HTTP (defaults to 8081)

`--https-port` Port for HTTPS (defaults to none/off)

`--ssl-cert` File path for SSL server cert (required for HTTPS)

`--ssl-key` File path for SSL server key (required for HTTPS)

`--config` path to config file (overrides command-line options)

`--target` print target in the form [name:host-name-or-address]

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
