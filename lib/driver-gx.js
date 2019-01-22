const GX = require('../lib/gx.js');

/** target <-> connection cache */
const cache = {};

class Connection {
    constructor(device) {
        this.device = device;
        this.host = device.host;
        this.port = device.port || 8899;
        this.ctrl = null;
        this.onready = [];
        this.status = {device: "offline"};
    }

    isReady() {
        return this.ctrl && this.ctrl.connected;
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this.ctrl) {
                if (this.ctrl.error || this.ctrl.disconnected) {
                    reject("device error");
                } else {
                    if (this.ctrl.connected) {
                        resolve(this.ctrl);
                    } else {
                        this.onready.push({resolve, reject});
                    }
                    return;
                }
            }
            let ctrl = this.ctrl = new GX.Control();
            ctrl
                .connect(this.host, this.port || 8899)
                .then(ctrl => {
                    driver.api.Util.log({connected: this.device.name});
                    return ctrl.getStatus();
                })
                .then(status => {
                    this.status = status;
                    resolve(this);
                    this.onready.forEach(ready => ready.resolve(this));
                    this.onready = [];
                })
                .catch(error => {
                    driver.api.Util.log({connect_error: this.host, error});
                    reject(error);
                    this.onready.forEach(ready => ready.reject(this));
                });
        });
    }
}

function getConnection(device) {
    return new Promise((resolve, reject) => {
        if (cache[device.name]) {
            return cache[device.name];
        }
        new Connection(device)
            .connect()
            .then(conn => {
                cache[device.name] = conn;
                resolve(conn);
            })
            .catch(error => {
                reject(error);
            });
    });
}

const driver = {
    name: "gx",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
        return new Promise((resolve, reject) => {
            entry.promises = {resolve, reject};
            // todo
        });
    },

    cancel: (device) => {
        return new Promise((resolve, reject) => {
            getConnection(device)
                .then(conn => {
                    return conn.ctrl.cancel();
                })
                .then(cancel => {
                    resolve(cancel);
                })
                .catch(error => {
                    reject(error);
                });
        });
    },

    status: (device) => {
        return new Promise((resolve, reject) => {
            getConnection(device)
                .then(conn => {
                    resolve(conn.status);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }
};

module.exports = driver;
