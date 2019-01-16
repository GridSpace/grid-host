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

        const header = new Buffer(58);
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

class FFControl {
    constructor() {
        this.disconnected = false;
        this.connected = false;
        this.queue = [];
        this.timer = null;
        this.next = null;
        this.output = [];
    }

    connect(host, port) {
        return new Promise((resolve, reject) => {
            if (this.socket) {
                reject('already connected');
                return;
            }
            this.connected = false;
            const socket = new net.Socket()
                .connect({
                    host: host,
                    port: port
                })
                .on("connect", () => {
                    console.log({connect: {host, port}});
                    this.connected = true;
                    this.socket = socket;
                    socket.lineBuffer = new lbuff(socket);
                    this.doSendTimer();
                    resolve(this);
                })
                .on("line", line => {
                    line = line.toString();
                    let okidx = line.indexOf("ok");
                    if (okidx >= 0) {
                        if (okidx > 0) this.output.push(line);
                        if (this.next) {
                            if (this.next.cb) {
                                this.next.cb(this.output);
                            }
                        } else {
                            console.log({reply_no_cmd: this.output});
                        }
                        this.output = [];
                        this.timer = null;
                        this.doSendTimer();
                    } else {
                        this.output.push(line);
                    }
                })
                .on("error", (error) => {
                    if (this.connected) {
                        console.log({error: {host, port}});
                    } else {
                        reject(error);
                    }
                })
                .on("end", () => {
                    console.log({end: {host, port}});
                })
                .on("close", () => {
                    console.log({close: {host, port}});
                    this._end("close");
                    this.socket = null;
                    this.connected = false;
                    this.disconnected = true;
                    console.log({end: {host, port}, type: type});
                })
                ;
        });
    }

    sendBuffer(buf, callback) {
        this.queue.push({cmd: buf, cb: callback});
        this.doSendTimer();
    }

    sendCommand(cmd, callback) {
        this.queue.push({cmd: "~" + cmd + "\r\n", cb: callback});
        this.doSendTimer();
    }

    send(cmd) {
        return new Promise((resolve, reject) => {
            this.sendCommand(cmd, resolve);
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            try {
                this.socket.end(null, null, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    doSendTimer() {
        if (this.disconnected) {
            console.log({send_timer_error: "disconnected"});
            process.exit(1);
        }
        if (!this.connected || this.timer) {
            return;
        }
        if (this.queue.length > 0) this.timer = setTimeout(() => {
            this.doSend()
        }, 0);
    }

    doSend() {
        const next = this.queue.shift();
        this.next = next;
        this.socket.write(next.cmd);
    }
}

function uint32b(val) {
    return new Buffer([
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
                this.status = {};
                this.ctrl = ctrl;
                return this.ctrl.send("M601 S1");
            })
            .then(lines => {
                console.log({M601: lines});
                return this.ctrl.send("M610 " + name);
            })
            .then(lines => {
                console.log({M610: lines});
                return this.ctrl.send("M602");
            })
            .then(lines => {
                console.log({M602: lines});
            })
            .then(lines => {
                callback({host, name});
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
                this.status = {};
                this.ctrl = ctrl;
                return this.ctrl.send("M115");
            })
            .then(lines => {
                this.status.info = lines;
                return this.ctrl.send("M119");
            })
            .then(lines => {
                this.status.status = lines;
                return this.ctrl.send("M27");
            })
            .then(lines => {
                this.status.print = lines;
                this.ctrl.send("M602");
            })
            .then(lines => {
                callback(this.status);
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
        const ctrl = new FFControl(host, port, error => {
            console.error(error);
            process.exit(1);
        });
        ctrl.sendCommand("M601 S1", lines => { console.log(lines) }); // take control
        ctrl.sendCommand("M115", lines => { console.log(lines) });
        ctrl.sendCommand("M650", lines => { console.log(lines) });
        ctrl.sendCommand("M115", lines => { console.log(lines) });
        ctrl.sendCommand("M114", lines => { console.log(lines) });
        ctrl.sendCommand("M27", lines => { console.log(lines) });
        ctrl.sendCommand("M119", lines => { console.log(lines) });
        ctrl.sendCommand("M105", lines => { console.log(lines) });
        // ctrl.sendCommand("M119", lines => { console.log(lines) });
        // ctrl.sendCommand("M105", lines => { console.log(lines) });
        // ctrl.sendCommand("M27", lines => { console.log(lines) });
        filename = " 0:/user/" + (filename || "noname.gx");
        ctrl.sendCommand("M28 " + buffer.length + filename, lines => { console.log(lines) });
        const slices = Math.ceil(buffer.length / 4096);
        const preamble = new Buffer([0x5a, 0x5a, 0xa5, 0xa5]);
        const length = uint32b(4096);
        for (let slice = 0; slice < slices; slice++) {
            let chunk = buffer.slice(slice * 4096, slice * 4096 + 4096);
            let crc = crc32.unsigned(chunk);
            let len = chunk.length;
            if (len  < 4096) {
                chunk = Buffer.concat([chunk, new Buffer(4096-len).fill(0)]);
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
    }

    monitor() {
        if (this.count-- == 0) {
            this.end();
            return;
        }
        const ctrl = this.ctrl;
        ctrl.sendCommand("M119", lines => { console.log(lines) });
        ctrl.sendCommand("M105", lines => { console.log(lines) });
        ctrl.sendCommand("M27", lines => { console.log(lines) });
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
    TCPipe: TCPipe,
    GXReader: GXReader,
    GXWriter: GXWriter
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
                console.log({status});
                process.exit();
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
                console.log({name: result});
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
