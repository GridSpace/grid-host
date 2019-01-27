const N2 = require('../lib/lib-n2.js');

const cache = {};

function getMonitor(device) {
    return new Promise((resolve, reject) => {
        let monitor = cache[device.name];
        if (!monitor) {
            monitor = new N2.Monitor(device.host, device.port, (data) => {
                if (data.connect) {
                    monitor.connected = true;
                    driver.api.Util.log({connected: device.name});
                }
                if (data.close) {
                    monitor.connected = false;
                    delete cache[device.name];
                    if (monitor.connected) {
                        driver.api.Util.log({disconnected: device.name});
                    }
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
                    info.state = stat.n0[1] + stat.n1[1] + stat.bed[1] > 0 ? "PRINTING" : "READY";
                    // grid-host relies on driver to update device.status object
                    device.status = monitor.status;
                }
                if (data.settings) {
                    // unused
                }
            });
            monitor.status = {
                state: "offline"
            };
            cache[device.name] = monitor;
        }
        resolve(monitor);
    });
}

const driver = {
    name: "n2",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
        return new Promise((resolve, reject) => {
            getMonitor(device)
                .then((monitor) => {
                    if (monitor.connected) {
                        new N2.Send(entry.data, device.host, device.port, entry.name, (output) => {
                            if (output.error) {
                                reject({error: output.error});
                            }
                            if (output.filename) {
                                monitor.print(output.filename);
                                monitor.filename = output.filename;
                                resolve({printing: output.filename});
                            }
                        });
                    } else {
                        reject({error: "no connection"});
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    },

    cancel: (device) => {
        return new Promise((resolve, reject) => {
            getMonitor(device)
                .then((monitor) => {
                    monitor.cancel(monitor.filename);
                    resolve({cancel:true});
                })
                .catch(error => {
                    reject(error);
                });
        });
    },

    status: (device) => {
        return new Promise((resolve, reject) => {
            getMonitor(device)
                .then((monitor) => {
                    resolve(monitor.status);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }
};

module.exports = driver;
