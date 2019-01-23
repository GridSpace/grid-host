const GX = require('../lib/gx.js');
const png2bmp = require('../lib/image').png2bmp;

/** target <-> connection cache */
const cache = {};

class Connection {
    constructor(device) {
        this.device = device;
        this.host = device.host;
        this.port = device.port || 8899;
        this.ctrl = null;
        this.onready = [];
        this.interval = null;
    }

    isReady() {
        return this.ctrl && this.ctrl.isConnected();
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this.ctrl) {
                if (this.ctrl.error || this.ctrl.isDisconnected()) {
                    reject("device error");
                } else {
                    if (this.ctrl.isConnected()) {
                        resolve(this.ctrl);
                    } else {
                        this.onready.push({resolve, reject});
                    }
                }
                return;
            }
            if (this.connecting) {
                reject("device connecting");
                return;
            }
            this.connecting = true;
            if (!this.ctrl) {
                this.ctrl = new GX.Control();
            }
            let ctrl = this.ctrl;
            ctrl
                .connect(this.host, this.port || 8899)
                .then(ctrl => {
                    this.connecting = false;
                    driver.api.Util.log({connected: this.device.name});
                    return ctrl.getStatus();
                })
                .then(status => {
                    resolve(this);
                    this.onready.forEach(ready => ready.resolve(this));
                    this.onready = [];
                })
                .catch(error => {
                    driver.api.Util.log({connect_error: this.host, error});
                    reject(error);
                    this.onready.forEach(ready => ready.reject(this));
                });
            this.interval = setInterval(() => {
                if (Date.now() - ctrl.lastRecv >= 1500) {
                    if (this.isReady()) {
                        ctrl.getStatus().then(status => { }).catch(error => { });
                    } else if (ctrl.isDisconnected()) {
                        if (this.connecting) {
                            return;
                        }
                        this.connecting = true;
                        console.log({reconnecting: this.device.name});
                        ctrl
                            .connect(this.host, this.port)
                            .then(ctrl => {
                                console.log({reconnected: this.device.name});
                                this.connecting = false;
                            })
                            .catch(error => {
                                // console.log({reconnect_fail: this.host, error});
                                this.connecting = false;
                            });
                    }
                }
            }, 500);
        });
    }

    print(entry) {
        return new Promise((resolve, reject) => {
            if (entry.image) {
                png2bmp(Buffer.from(entry.image, "base64"))
                    .then(bmp => {
                        return this.ctrl.print(entry.name, entry.data, bmp.data, entry.estime, entry.fused);
                    })
                    .then(print => {
                        resolve(print);
                    })
                    .catch(error => {
                        reject(error);
                    });
            } else {
                return this.ctrl.print(entry.name, entry.data, null, entry.estime, entry.fused);
            }
        });
    }

    cancel() {
        return this.ctrl.cancel();
    }

    status() {
        return this.ctrl && this.ctrl.isConnected() ? this.ctrl.status : { state: "offline" };
    }
}

function getConnection(device) {
    return new Promise((resolve, reject) => {
        let conn = cache[device.name];
        if (conn === false) {
            reject("not connected");
            return;
        }
        if (conn) {
            resolve(conn);
            return;
        }
        cache[device.name] = false;
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
            getConnection(device)
                .then(conn => {
                    return conn.print(entry);
                })
                .then(print => {
                    resolve(print);
                })
                .catch(error => {
                    reject(error);
                });
        });
    },

    cancel: (device) => {
        return new Promise((resolve, reject) => {
            getConnection(device)
                .then(conn => {
                    return conn.cancel();
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
                    resolve(conn.status());
                })
                .catch(error => {
                    reject(error);
                });
        });
    }
};

module.exports = driver;
