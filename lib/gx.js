/**
 * Copyright 2014-2018 Stewart Allen <so@a3z.co> -- All Rights Reserved
 *
 * protocol documentation
 *
 * https://docs.google.com/spreadsheets/d/1Te9q2OzpQD-HjMmNeSUOVUnbdA909WycUPygLNZoDV8/edit#gid=1612642479
 */
"use strict";

const lbuff = require("buffer.lines");
const crc32 = require('buffer-crc32');
const net   = require('net');
const fs    = require('fs');
const os    = require('os');

class GXReader {
    constructor(file) {
        this.file = file;
        this.buf = fs.readFileSync(file);
        this.pos = 16;
        this.magic = this.buf.slice(0,16).toString().trim();
        this.struct = {
            magic: this.magic,
            bmpoff: this.u32(),
            gc1off: this.u32(),
            gc2off: this.u32(),
            prsecs: this.u32(),
            prfila: this.u32(),
            unk01:  this.u32(),
            unk02:  this.u16(),
            unk03:  this.u16(),
            unk04:  this.u16(),
            unk05:  this.u16(),
            unk06:  this.u16(),
            unk07:  this.u16(),
            unk08:  this.u16(),
            unk09:  this.u16(),
            unk10:  this.u8(),
            unk11:  this.u8(),
            index:  this.pos
        };
    }

    inc(inc) {
        const ret = this.pos;
        this.pos += inc;
        return ret;
    }

    u8() {
        return this.buf.readUInt8(this.inc(1));
    }

    u16() {
        return this.buf.readUInt16LE(this.inc(2));
    }

    u32() {
        return this.buf.readUInt32LE(this.inc(4));
    }

    print() {
        console.log(this.struct);
        return this;
    }

    extract() {
        fs.writeFileSync(this.file + ".bmp", this.buf.slice(this.struct.bmpoff, this.struct.gc1off));
        fs.writeFileSync(this.file + ".gcode", this.buf.slice(this.struct.gc1off, this.buf.length));
        return this;
    }
}

class GXWriter {
    constructor(gcode, bmp, time, length) {
        gcode = fs.readFileSync(gcode); // raw gcode
        bmp = fs.readFileSync(bmp); // any 80x60 pixel bmp

        const header = Buffer.alloc(58);
        header.write("xgcode 1.0\n\u0000\u0000\u0000\u0000\u0000", 0);
        header.writeUInt32LE(58, 16); // bmp offset
        header.writeUInt32LE(58 + bmp.length, 20); // gcode offset
        header.writeUInt32LE(58 + bmp.length, 24); // gcode offset
        header.writeUInt32LE(time || 100, 28); // print seconds
        header.writeUInt32LE(length || 100, 32); // print filament len mm
        header.writeUInt32LE(  0, 36); // ?
        header.writeUInt16LE(  1, 40); // ?
        header.writeUInt16LE(200, 42); // ?
        header.writeUInt16LE( 20, 44); // ?
        header.writeUInt16LE(  3, 46); // ?
        header.writeUInt16LE( 60, 48); // ?
        header.writeUInt16LE(110, 50); // ?
        header.writeUInt16LE(220, 52); // ?
        header.writeUInt16LE(220, 54); // ?
        header.writeUInt8   (  1, 56); // ?
        header.writeUInt8   (  1, 57); // ?

        this.output = Buffer.concat([header, bmp, gcode]);
    }

    write(file) {
        fs.writeFileSync(file, this.output);
        return this;
    }
}

const COMMAND = {
    // print
    Start:      "M23", // arg = 0:/user/<filename>.gx
    Resume:     "M24",
    Pause:      "M25",
    Cancel:     "M26",
    Status:     "M27",
    // file
    Write:      "M28", // args = <length> 0:/user/<filename>.gx
    Save:       "M29",
    // machine
    SetTemp:    "M104", // args = T0 S<temp>
    GetTemp:    "M105",
    EStop:      "M112",
    GetPos:     "M114",
    GetInfo:    "M115",
    GetStatus:  "M119",
    Control:    "M601",
    Release:    "M602",
    SetName:    "M610",
    SetXY:      "M612",
    GetXY:      "M650"
};

function parseMapValue(value) {
    if (value.indexOf(':') > 0) {
        let map = {};
        value = value.replace(/: /g,':');
        value.split(' ').map(v => {
            let kv = v.split(':');
            map[kv[0]] = parseFloat(kv[1]);
        });
        return map;
    } else {
        return value;
    }
}

function parseMapLines(lines) {
    let map = {};
    lines.slice(1).map(line => {
        let ci = line.indexOf(':');
        map[line.substring(0,ci)] = parseMapValue(line.substring(ci + 2));
    });
    return map;
}

class FFControl {
    constructor() {
        this.init();
    }

    init() {
        this.disconnected = false;
        this.connected = false;
        this.queue = [];
        this.timer = null;
        this.next = null;
        this.output = [];
    }

    connect(host, port) {
        return new Promise((resolve, reject) => {
            let timeout = 8000;
            let retry = 0;
            let onbad = (error) => {
                if (++retry >= 3) {
                    reject(error);
                } else {
                    // console.log({retry,error, timeout})
                    setTimeout(() => {
                        this._connect_full(host, port, resolve, onbad);
                    }, timeout);
                    // timeout += 1000;
                }
            };
            this._connect_full(host, port, resolve, onbad);
        });
    }

    _connect_full(host, port, resolve, reject) {
        this._connect(host, port)
            .then(ctrl => {
                return this.control();
            })
            .then(() => {
                resolve(this);
            })
            .catch(error => {
                reject(error);
            });
    }

    _connect(host, port) {
        return new Promise((resolve, reject) => {
            if (this.connected) {
                reject('already connected');
                return;
            }
            this.init();
            const socket = new net.Socket()
                .connect({
                    host: host,
                    port: port
                })
                .on("connect", () => {
                    // console.log({connect: {host, port}});
                    this.connected = true;
                    this.socket = socket;
                    socket.lineBuffer = new lbuff(socket);
                    this._sendTimer();
                    resolve(this);
                })
                .on("line", line => {
                    line = line.toString();
                    // console.log({line});
                    let okidx = line.indexOf("ok");
                    if (okidx >= 0) {
                        if (okidx > 0) this.output.push(line);
                        if (this.next) {
                            if (this.next.resolve) {
                                this.next.resolve(this.output);
                                this.next = null;
                            }
                        } else {
                            console.log({reply_no_cmd: this.output});
                        }
                        this.output = [];
                        this.timer = null;
                        this._sendTimer();
                    } else {
                        this.output.push(line);
                    }
                })
                .on("error", (error) => {
                    if (this.connected) {
                        this.connected = false;
                        // console.log({connected_error: {host, port}, error, queue: this.queue, next: this.next});
                        this.error = error;
                        if (this.next && this.next.reject) {
                            this.next.reject(error);
                            this.next = null;
                        }
                    } else {
                        this.connected = false;
                        reject(error);
                    }
                })
                .on("end", () => {
                    // console.log({end: {host, port}});
                    if (this.next && this.next.reject) {
                        this.next.reject("disconnected");
                        this.next = null;
                    }
                })
                .on("close", () => {
                    // console.log({close: {host, port}});
                    this.connected = false;
                    this.disconnected = true;
                });
            socket.setTimeout(500, to => {
                // console.log({timeout: host});
                socket.end();
                this.connected = false;
                reject({timeout: host});
            });
        });
    }

    _sendTimer() {
        if (this.timer) {
            return;
        }
        if (this.queue.length > 0) this.timer = setTimeout(() => {
            this._send()
        }, 0);
    }

    _send() {
        const next = this.queue.shift();
        if (this.disconnected || !this.connected) {
            this.error = "disconnected";
        }
        if (this.error) {
            next.reject(this.error);
            return;
        }
        // console.log({write: next.cmd});
        this.next = next;
        this.socket.write(next.cmd);
    }

    send(cmd) {
        // console.log({send: cmd});
        return new Promise((resolve, reject) => {
            if (this.error) {
                reject(this.error);
                return;
            }
            if (!this.connected) {
                reject("disconnected");
                return;
            }
            if (Buffer.isBuffer(cmd)) {
                this.sendBuffer(cmd, resolve, reject);
            } else {
                this.sendCommand(cmd, resolve, reject);
            }
        });
    }

    sendCommand(cmd, resolve, reject) {
        this.queue.push({cmd: "~" + cmd + "\r\n", resolve, reject});
        this._sendTimer();
    }

    sendBuffer(buf, resolve, reject) {
        this.queue.push({cmd: buf, resolve, reject});
        this._sendTimer();
    }

    close() {
        return new Promise((resolve, reject) => {
            this.release()
                .then(() => {
                    return this._close();
                })
                .then(() => {
                    resolve();
                })
                .catch(error => {
                    reject(error);
                })
        });
    }

    _close() {
        return new Promise((resolve, reject) => {
            try {
                this.socket.end();
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    setName(name) {
        return new Promise((resolve, reject) => {
            this.send(COMMAND.SetName + " " + name)
                .then(lines => {
                    resolve(lines);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    getStatus() {
        return new Promise((resolve, reject) => {
            let status = {};
            this.send(COMMAND.GetInfo)
                .then(lines => {
                    lines = lines.slice(1);
                    let xyz = parseMapValue(lines.splice(4,1)[0]);
                    status.info = parseMapLines(lines);
                    status.info.pos = xyz;
                    return this.send(COMMAND.GetStatus);
                })
                .then(lines => {
                    status.status = parseMapLines(lines);
                    return this.send(COMMAND.Status);
                })
                .then(lines => {
                    status.print = lines[1];
                    return this.send(COMMAND.GetTemp);
                })
                .then(temps => {
                    let map = {};
                    temps[1]
                        .replace(/\ +\//g,'/')
                        .split(' ')
                        .map(v => v.split(':'))
                        .map(v => {
                            map[v[0]] = v[1].split('/').map(v => parseFloat(v));
                        });
                    status.temps = map;
                    // console.log(JSON.stringify(status,null,4))
                    resolve(status);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    cancel() {
        return new Promise((resolve, reject) => {
            this.send(COMMAND.Cancel)
                .then(lines => {
                    resolve(lines);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    control() {
        return new Promise((resolve, reject) => {
            this.send(COMMAND.Control)
                .then(lines => {
                    resolve(lines);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    release() {
        return new Promise((resolve, reject) => {
            this.send(COMMAND.Release)
                .then(lines => {
                    resolve(lines);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }
}

function uint32b(val) {
    return Buffer.from([
        (val >> 24) & 0xff,
        (val >> 16) & 0xff,
        (val >>  8) & 0xff,
        (val >>  0) & 0xff
    ]);
}

class GXName {
    constructor(host, name, callback) {
        new FFControl()
            .connect(host, 8899)
            .then(ctrl => {
                this.ctrl = ctrl;
                return ctrl.setName(name)
            })
            .then(lines => {
                callback(lines);
                process.exit(0);
            })
            .catch(error => {
                console.log({error});
                process.exit(1);
            });
    }
}

class GXStatus {
    constructor(host, port, callback) {
        new FFControl()
            .connect(host, port)
            .then(ctrl => {
                this.ctrl = ctrl;
                return ctrl.getStatus();
            })
            .then(status => {
                callback(status);
                return this.ctrl.release()
            })
            .then(release => {
                console.log({release});
                process.exit(0);
            })
            .catch(error => {
                console.log({error});
                process.exit(1);
            });
    }
}

class GXScan {
    constructor(subnet, callback) {
        const found = this.found = [];

        if (!subnet) {
            const ifs = os.networkInterfaces();
            for (let key in ifs) {
                if (!ifs.hasOwnProperty(key)) continue;
                ifs[key].forEach(int => {
                    if (int.family === 'IPv4' && int.internal === false && int.netmask === '255.255.255.0') {
                        // console.log({candidate: int});
                        subnet = int.address.split('.').slice(0,3).join('.')
                        console.log({subnet});
                    }
                });
            }
        }

        if (subnet) {
            let search = 254;
            let alist = {};
            for (let ep=1; ep<255; ep++) {
                let sock = new net.Socket();
                let addr = subnet + '.' + ep;
                alist[addr] = true;
                sock
                    .connect({host: addr, port: 8899})
                    .on('error', error => {
                        // console.log({err: addr});
                        if (alist[addr] && --search === 0 && callback) {
                            alist[addr] = false;
                            callback(found.sort());
                        }
                    })
                    .on('close', () => {
                        // console.log({close: addr, search});
                        if (alist[addr] && --search === 0 && callback) {
                            alist[addr] = false;
                            callback(found.sort());
                        }
                    })
                    .on('connect', () => {
                        // console.log({found: addr});
                        found.push(addr)
                        sock.end();
                    });
                sock.setTimeout(2000, to => {
                    if (alist[addr] && --search === 0 && callback) {
                        alist[addr] = false;
                        callback(found.sort());
                    }
                });
            }
        }
    }
}

class GXSender {
    constructor(file, host, port, filename) {
        const buffer = fs.readFileSync(file);
        const ctrl = new FFControl();
        ctrl.connect(host, port)
            .then(() => {
                // ctrl.control("M601 S1", lines => { console.log(lines) }); // take control
                ctrl.sendCommand("M115", lines => { console.log(lines) });
                ctrl.sendCommand("M650", lines => { console.log(lines) });
                ctrl.sendCommand("M115", lines => { console.log(lines) });
                ctrl.sendCommand("M114", lines => { console.log(lines) });
                ctrl.sendCommand("M27",  lines => { console.log(lines) });
                ctrl.sendCommand("M119", lines => { console.log(lines) });
                ctrl.sendCommand("M105", lines => { console.log(lines) });
                // ctrl.sendCommand("M119", lines => { console.log(lines) });
                // ctrl.sendCommand("M105", lines => { console.log(lines) });
                // ctrl.sendCommand("M27",  lines => { console.log(lines) });
                filename = " 0:/user/" + (filename || "noname.gx");
                ctrl.sendCommand("M28 " + buffer.length + filename, lines => { console.log(lines) });
                const slices = Math.ceil(buffer.length / 4096);
                const preamble = Buffer.from([0x5a, 0x5a, 0xa5, 0xa5]);
                const length = uint32b(4096);
                for (let slice = 0; slice < slices; slice++) {
                    let chunk = buffer.slice(slice * 4096, slice * 4096 + 4096);
                    let crc = crc32.unsigned(chunk);
                    let len = chunk.length;
                    if (len  < 4096) {
                        chunk = Buffer.concat([chunk, Buffer.alloc(4096-len).fill(0)]);
                    }
                    let block = Buffer.concat([
                        preamble,
                        uint32b(slice),
                        uint32b(len),
                        uint32b(crc),
                        chunk
                    ]);
                    ctrl.sendBuffer(block, lines => { console.log(lines) });
                }
                ctrl.sendCommand("M29", lines => { console.log(lines) }); // end of send
                ctrl.sendCommand("M23" + filename, lines => { console.log(lines) }); // start print
                this.ctrl = ctrl;
                this.count = 5;
                this.monitor();
            })
            .catch (error => {
                console.log({error});
            });
    }

    monitor() {
        if (this.count-- == 0) {
            this.end();
            return;
        }
        const ctrl = this.ctrl;
        ctrl.sendCommand("M119", lines => { console.log(lines) });
        ctrl.sendCommand("M105", lines => { console.log(lines) });
        ctrl.sendCommand("M27",  lines => { console.log(lines) });
        setTimeout(() => { this.monitor() }, 1000);
    }

    end() {
        this.ctrl.sendCommand("M602", lines => { console.log(lines) }); // control release
    }
}

class TCPipe {
    constructor(lport, dhost, dport) {
        this.server = net.createServer(client => {
            let last = null;
            let buf = null;
            const emit = (socket, buffer) => {
                console.log("--- " + socket.name + " ---");
                if (buffer.length > 256) {
                    console.log(buffer.toString("hex"));
                } else {
                    console.log(buffer.toString().trim());
                }
            };
            const onData = (socket, buffer) => {
                if (last != socket) { emit(socket, buffer); buf = buffer }
                else { buf = Buffer.concat([buf, buffer]) }
                last = socket;
            };
            client
                .on("data", data => {
                    onData(client, data);
                    socket.write(data);
                })
                .on("error", (error) => {
                    client.end();
                })
                .on("end", () => {
                    client.end();
                })
                .on("close", () => {
                    // ok
                })
                ;
            const socket = new net.Socket().connect({
                host: dhost,
                port: dport
            })
                .on("data", data => {
                    onData(socket, data);
                    client.write(data);
                })
                .on("error", (error) => {
                    socket.end();
                })
                .on("end", () => {
                    socket.end();
                    emit(last, buf);
                })
                .on("close", () => {
                    // ok
                })
                ;
            client.name = "client";
            socket.name = "server";
        })
            .on("error", error => { console.log(error)} )
            .listen(lport, () => { })
            ;
    }
}

module.exports = {
    Pipe: TCPipe,
    Reader: GXReader,
    Writer: GXWriter,
    Control: FFControl
};

if (!module.parent) {
    const arg = process.argv.slice(2);
    const cmd = arg.shift();

    switch (cmd) {
        case 'pipe':
            new TCPipe(parseInt(arg.shift()), arg.shift(), parseInt(arg.shift()));
            break;
        case 'read':
            new GXReader(arg.shift()).print();
            break;
        case 'dump':
            new GXReader(arg.shift()).print().extract();
            break;
        case 'make':
            let output = arg.shift();
            new GXWriter(arg.shift(), arg.shift(), parseInt(arg.shift() || 100), parseInt(arg.shift() || 100)).write(output);
            break;
        case 'send':
            new GXSender(arg.shift(), arg.shift(), parseInt(arg.shift()), arg.shift());
            break;
        case 'stat':
            new GXStatus(arg.shift(), arg.shift() || 8899, status => {
                console.log(JSON.stringify(status,null,4));
            });
            break;
        case 'scan':
            new GXScan(arg.shift(), found => {
                console.log({found});
                process.exit();
            });
            break;
        case 'name':
            new GXName(arg.shift(), arg.shift(), (result) => {
                console.log({result});
            });
            break;
        default:
            console.log([
                "invalid command: " + cmd,
                "usage:",
                "  read [file]",
                "  dump [file]",
                "  make [outfile] [gcodefile] [bmp] <time> <length>",
                "  pipe [local-port] [host] [port]",
                "  send [file] [host] [port] [filename]",
                "  stat [host] <port>",
                "  scan <subnet>",
                "  name [host] [name]"
            ].join("\n"));
            break;
    }
}
