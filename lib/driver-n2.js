const N2 = require('../lib/n2.js');

const cache = {};

const driver = {
    name: "n2",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
        return new Promise((resolve, reject) => {
            reject('not implemented');
            // getConnection(device)
            //     .then(conn => {
            //         return conn.print(entry);
            //     })
            //     .then(print => {
            //         resolve(print);
            //     })
            //     .catch(error => {
            //         reject(error);
            //     });
        });
    },

    cancel: (device) => {
        return new Promise((resolve, reject) => {
            reject('not implemented');
            // getConnection(device)
            //     .then(conn => {
            //         return conn.cancel();
            //     })
            //     .then(cancel => {
            //         resolve(cancel);
            //     })
            //     .catch(error => {
            //         reject(error);
            //     });
        });
    },

    status: (device) => {
        return new Promise((resolve, reject) => {
            let monitor = cache[device.name];
            if (!monitor) {
                monitor = new N2.Monitor(device.host, device.port, (data) => {
                    if (data.connect) {
                        cache[device.name] = monitor;
                        driver.api.Util.log({connected: device.name});
                    }
                    if (data.close) {
                        delete cache[device.name];
                        driver.api.Util.log({disconnected: device.name});
                    }
                    let info = monitor.status;
                    if (data.status) {
                        let stat = data.status;
                        info.progress = stat.progress.toFixed(2);
                        info.temps = {
                            T0: stat.n0,
                            T1: stat.n1,
                            B: stat.bed
                        };
                        info.state = stat.n0[1] + stat.n1[1] + stat.bed[1] > 0 ? "printing" : "ready";
                    }
                    if (data.settings) {
                        // unused
                    }
                });
                monitor.status = {
                    state: "offline"
                };
            }
            resolve(monitor.status);
        });
    }
};

module.exports = driver;
