/** target <-> connection cache */
const cache = {};
const net = require('net');
const lbuff = require("./linebuffer");

class Connection {
    constructor(device) {
        this.device = device;
        this.host = device.host;
        this.port = device.port || 8899;
        this.socket = null;
        this.onready = [];
        this.interval = null;
        this.connecting = false;
        this.status = { state: "offline" };
        this.kick = false;
    }

    connect() {
        clearInterval(this.interval);
        return new Promise((resolve, reject) => {
            let socket = this.socket;
            if (socket) {
                if (socket._error) {
                    reject("device error");
                } else if (socket._ready) {
                    resolve(this);
                } else {
                    this.onready.push({resolve, reject});
                }
                return;
            } else {
                this.onready.push({resolve, reject});
            }
            if (this.connecting) {
                reject("device connecting");
                return;
            }
            if (!socket) {
                this.connecting = true;
                this.socket = socket = new net.Socket()
                    .connect({
                        host: this.host,
                        port: this.port
                    })
                    .on("connect", () => {
                        socket.setTimeout(5000);
                        socket.lineBuffer = new lbuff(socket);
                        while (this.onready.length) {
                            this.onready.shift().resolve(this);
                        }
                    })
                    .on("line", line => {
                        socket.lastRecv = Date.now();
                        line = line.toString();
                        if (line === "*ready") {
                            socket._ready = true;
                            driver.api.Util.log({connected: this.device.name});
                            if (this.kick) {
                                socket.write("*kick\n");
                                this.kick = false;
                            }
                        } else if (line.indexOf("*** {") === 0) {
                            let info = JSON.parse(line.substring(4, line.length - 4));
                            let status = this.status;
                            status.state = info.print.run ? "printing" : "idle";
                            status.progress = info.print.progress;
                            status.temps = {
                                T0: [ info.temp.ext[0], info.target.ext[0] ],
                                B:  [ info.temp.bed, info.target.bed ]
                            };
                        }
                    })
                    .on("error", (error) => {
                        socket._error = error;
                        console.log({error});
                    })
                    .on("close", () => {
                        if (socket && socket._ready) {
                            driver.api.Util.log({disconnected: this.device.name});
                        }
                        this.connecting = false;
                        this.socket = socket = null;
                        this.status = { state: "offline" };
                    });
            }
            this.interval = setInterval(() => {
                if (!socket) {
                    return this.connect().then(c => {}).catch(e => {});
                }
                if (socket._ready) {
                    socket.write("*status\n");
                }
            }, 500);
        });
    }

    print(entry) {
        return new Promise((resolve, reject) => {
            try {
                let name = entry.name;
                if (name.indexOf(".gcode") < 0) {
                    name = name + ".gcode";
                }
                this.socket.write(`*upload ${name}\n`);
                this.socket.write(entry.data);
                this.socket.end();
                this.kick = true;
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    cancel() {
        this.socket.write("*abort\n");
        return "cancelled";
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
    name: "grid",

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
                    resolve(conn.status);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }
};

module.exports = driver;
