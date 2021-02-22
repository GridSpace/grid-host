const http = require('http');

const driver = {
    name: "duet",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
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
                console.log({error});
            })
            req.write(entry.data);
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
