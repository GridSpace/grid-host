/** Copyright 2014-2017 Stewart Allen -- All Rights Reserved */
"use strict";

const crc32 = require('buffer-crc32');
const net   = require('net');
const fs    = require('fs');
const BMP   = require('bmp-js');
const PNG   = require('pngjs').PNG;

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

class LineBuffer {
    constructor(stream) {
        this.buffer = null;
        this.stream = stream;
        this.stream.on("data", data => {
            if (this.buffer) {
                this.buffer = Buffer.concat([this.buffer, data]);
            } else {
                this.buffer = data;
            }
            this.nextLine()
        });
    }

    nextLine() {
        let left = 0;
        const data = this.buffer;
        const cr = data.indexOf("\r");
        const lf = data.indexOf("\n");
        if (lf && cr + 1 == lf) { left = 1 }
        if (lf >= 0) {
            this.stream.emit("line", data.slice(0, lf - left));
            this.buffer = data.slice(lf + 1);
            this.nextLine();
        }
    }
}

class FFControl {
    constructor(host, port) {
        const socket = new net.Socket().connect({
            host: host,
            port: port
        })
            .on("connect", () => {
                console.log({connected: [host, port]});
                this.connected = true;
                this.doSendTimer();
            })
            .on("line", line => {
                line = line.toString();
                let okidx = line.indexOf("ok");
                if (okidx >= 0) {
                    if (okidx > 0) this.output.push(line);
                    if (this.next) {
                        if (this.next.cb) this.next.cb(this.output);
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
                console.log({error: error});
            })
            .on("end", () => {
                console.log({end: [host,port]});
            })
            .on("close", () => {
                console.log({close: [host,port]});
            })
            ;

        socket.lineBuffer = new LineBuffer(socket);

        this.connected = false;
        this.socket = socket;
        this.queue = [];
        this.timer = null;
        this.next = null;
        this.output = [];
    }

    sendBuffer(buf, callback) {
        this.queue.push({cmd: buf, cb: callback});
        this.doSendTimer();
    }

    sendCommand(cmd, callback) {
        this.queue.push({cmd: "~" + cmd + "\r\n", cb: callback});
        this.doSendTimer();
    }

    doSendTimer() {
        if (!this.connected || this.timer) return;
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

class GXSender {
    constructor(file, host, port, filename) {
        const buffer = fs.readFileSync(file);
        const ctrl = new FFControl(host, port);
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

PNG.prototype.pixAt = function(x,y) {
    var idx = (x + this.width * y) * 4;
    var dat = this.data;
    return [
        dat[idx++],
        dat[idx++],
        dat[idx++],
        dat[idx++]
    ];
};

PNG.prototype.averageBlock = function(x1,y1,x2,y2) {
    var val = [0, 0, 0, 0];
    var count = 0;
    for (var x=x1; x<x2; x++) {
        for (var y=y1; y<y2; y++) {
            var v2 = this.pixAt(x,y);
            for (var z=0; z<4; z++) {
                val[z] += v2[z];
            }
            count++;
        }
    }
    for (var z=0; z<4; z++) {
        val[z] = Math.abs(val[z] / count);
    }
    return val;
};

function png2bmp(buffer, callback, width, height) {
    var png = new PNG().parse(buffer, (err, data) => {
        var th = width || 80;
        var tw = height || 60;
        var ratio = png.width / png.height;
        if (ratio > 4/3) {
            var div = png.height / tw;
            var xoff = Math.round((png.width - (th * div)) / 2);
            var yoff = 0;
        } else {
            var div = png.width / th;
            var xoff = 0;
            var yoff = Math.round((png.height - (tw * div)) / 2);
        }
        var buf = new Buffer(th * tw * 4);
        for (var y=0; y<tw; y++) {
            var dy = Math.round(y * div + yoff);
            if (dy < 0 || dy > png.height) continue;
            var ey = Math.round((y+1) * div + yoff);
            for (var x=0; x<th; x++) {
                var dx = Math.round(x * div + xoff);
                if (dx < 0 || dx > png.width) continue;
                var ex = Math.round((x+1) * div + xoff);
                var bidx = (y * th + x) * 4;
                var pixval = png.averageBlock(dx,dy,ex,ey);
                if (Math.abs(pixval[0] - pixval[1]) + Math.abs(pixval[2] - pixval[1]) < 5) {
                    pixval[0] = Math.round(pixval[0] * 0.8);
                    pixval[1] = Math.round(pixval[1] * 0.8);
                    pixval[2] = Math.round(pixval[2] * 0.8);
                    pixval[3] = Math.round(pixval[3] * 0.8);
                }
                buf[bidx+0] = pixval[0];
                buf[bidx+1] = pixval[1];
                buf[bidx+2] = pixval[2];
                buf[bidx+3] = pixval[3];
            }
        }
        callback(BMP.encode({data:buf, width:th, height:tw}));
    });
}

module.exports = {
    TCPipe: TCPipe,
    GXReader: GXReader,
    GXWriter: GXWriter,
    png2bmp: png2bmp
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
        default:
            console.log([
                "invalid command: " + cmd,
                "usage:",
                "  read [file]",
                "  dump [file]",
                "  make [outfile] [gcodefile] [bmp] <time> <length>",
                "  send [file] [host] [port] <filename>"
            ].join("\n"));
            break;
    }
}
