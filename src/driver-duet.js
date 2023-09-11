const http = require('http');

// https://github.com/Duet3D/RepRapFirmware/wiki/HTTP-requests.md

const driver = {
    name: "duet",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
        if ('password' in device) {
            retval = driver.auth(device).then(
                function(res){
                    if( !( 'error' in res) ){
                        return driver.send_file(device, entry)
                    }
                })
        } else {
            retval = driver.send_data(device, entry)
        }

        retval = retval.then(
            function(res){
                if( !('error' in res) ){
                       return driver.select_for_printing(device, entry)
                }
            }
        )

        if ('start-printing' in device){
            val = device['start-printing'].toLowerCase()
            if ( val == "yes" || val == "true" ){
                retval = retval.then(
                    function(res){
                        if( !('error' in res) ){
                               return driver.start_printing(device)
                        }
                    }
                )
            }
        }
        return retval
    },

    auth: (device) => {
        return new Promise((resolve, reject) => {
            if ('password' in device) {
            // log in first. Duet stores me IP on login,
            // so other calls don't need a session key
            //
            // duet also only stores one session per IP as
            // long as we don't ask for a session key, so
            // we won't fill up the session table
            let authreq = http.request({
                host: device.host,
                port: device.port || 80,
                path: `/rr_connect?password=${device.password}`,
                method: 'GET',
                headers: {
                'Host': device.host,
                'Content-Type': 'text/plain'
                }
            }, res => {
                let { statusCode, headers } = res;
                if (statusCode !== 200) {
                    return resolve({error: statusCode});
                }
                let buf;
                res.on('data', chunk => {
                if (buf) {
                    buf = Buffer.concat([buf, chunk]);
                } else {
                    buf = chunk;
                }
                });
                res.on('end', () => {
                try {
                    let resp = JSON.parse(buf.toString());
                    // Duet replies with err == 0 if the password
                    // is correct *or* if no password is required
                    if( resp.err == 1 ){
                        console.log(`Failed to authenticate to ${device.name}`)
                        resolve({error: 401})
                    } else if( resp.err == 2 ){
                        console.log(`${device.name} has run out of available sessions`)
                        resolve({error: 500})
                    } else if( resp.err != 0 ){
                        console.log(`Unknown error authorizing to ${device.name}.`)
                        resolve({error: 500})
                    }
                    resolve({success: true})
                } catch (error) {
                    console.log("Error in duet.auth");
                    resolve({error});
                }
                });
            });
            authreq.on('error', error => {
                console.log({error});
            })
                authreq.end();
            } else {
                return resolve({error: 401})
            }
        })
    },

    send_file: (device, entry) => {
        return new Promise((resolve, reject) => {
            console.log({send:device, entry: entry.name, size: entry.data.length});
            let req = http.request({
                host: device.host,
                port: device.port || 80,
                path: `/rr_upload?name=0:/gcodes/${entry.name}`,
                method: 'POST',
                headers: {
                    'Host': device.host,
                    'Content-Type': 'text/plain',
                    'Content-Length': entry.data.length
                }
            }, res => {
                let { statusCode, headers } = res;
                if (statusCode !== 200) {
                    return resolve({error: statusCode});
                }
                let buf;
                res.on('data', chunk => {
                    if (buf) {
                        buf = Buffer.concat([buf, chunk]);
                    } else {
                        buf = chunk;
                    }
                });
                res.on('end', () => {
                    try {
                        let resp = JSON.parse(buf.toString());
                        resolve(resp);
                    } catch (error) {
                        resolve({error});
                    }
                });
            });
            req.on('error', error => {
                console.log("Error in duet.send_file");
                console.log({error});
            })
            req.write(entry.data);
            req.end();
        });
    },

    select_for_printing: (device, entry) => {
        return driver._run_get_command(device, `/rr_gcode?gcode=M23+0:/gcodes/${entry.name}`, "select_for_printing")
    },

    start_printing: (device, entry) => {
        return driver._run_get_command(device, '/rr_gcode?gcode=M24', "start_printing")
    },

    _run_get_command: (device, cmd, method_name) => {
        return new Promise((resolve, reject) => {
            let req = http.request({
                host: device.host,
                port: device.port || 80,
                path: cmd,
                method: 'GET',
                headers: {
                    'Host': device.host,
                    'Content-Type': 'text/plain'
                }
            }, res => {
                let { statusCode, headers } = res;
                if (statusCode !== 200) {
                    return resolve({error: statusCode});
                }
                let buf;
                res.on('data', chunk => {
                    if (buf) {
                        buf = Buffer.concat([buf, chunk]);
                    } else {
                        buf = chunk;
                    }
                });
                res.on('end', () => {
                    try {
                        let resp = JSON.parse(buf.toString());
                        resolve(resp);
                    } catch (error) {
                        resolve({error});
                    }
                });
            });
            req.on('error', error => {
                console.log(`Error in duet.${method_name}`);
                console.log({error});
            })
            req.end();
        });
    },

    cancel: (device) => {
        return new Promise((resolve, reject) => {
            console.log({cancel:device});
            resolve({});
        });
    },

    status: (device) => {
        return new Promise((resolve, reject) => {
            http.get(`http://${device.host}:${device.port||80}/rr_model`, res => {
                let { statusCode, headers } = res;
                if (statusCode !== 200) {
                    return resolve({error: statusCode});
                }
                let buf;
                res.on('data', chunk => {
                    if (buf) {
                        buf = Buffer.concat([buf, chunk]);
                    } else {
                        buf = chunk;
                    }
                });
                res.on('end', () => {
                    try {
                        let resp = JSON.parse(buf.toString());
                        // {"key":"","flags":"","result":{"boards":[{}],"directories":{},"fans":[],"heat":{},"inputs":[{},{},{},{},{},{},{},null,null,{},null,{}],"job":{},"limits":{},"move":{},"network":{},"scanner":{},"sensors":{},"seqs":{},"spindles":[{},{},{},{}],"state":{},"tools":[],"volumes":[{},{}]}}
                        resolve({ state: "online", mode: "" });
                    } catch (error) {
                        resolve({ state: "offline", mode: "" });
                    }
                });
            });
        });
    }
};

module.exports = driver;
