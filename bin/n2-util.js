/** Copyright 2017-2018 Stewart Allen -- All Rights Reserved */
"use strict";

const crc32 = require('buffer-crc32');
const net   = require('net');
const fs    = require('fs');

function lpad(s, l, pv) {
    while (s.length < l) s = (pv || ' ') + s;
    return s;
}

function rpad(s, l, pv) {
    while (s.length < l) s = s + (pv || ' ');
    return s;
}

function str(v, b) {
     return lpad(v.toString(16), b*2, '0') + "=" + rpad(v.toString(10), b*3);
}

function dump(buf, skip, words, word) {
    // new Packet(buf);
    let left = '';
    let right = '';
    let index = 0;
    let count = 0;
    words = words || 4;
    word = word || 4;
    let wout = word * words;
    let leftpad = words * (word * 3 + 1);
    let emit = function() {
        console.log(rpad(left, leftpad) + right);
        left = '';
        right = '';
        count = 0;
    };

    if (skip) buf = buf.slice(skip);

    while (index < buf.length) {
        let ch = buf.readUInt8(index++);
        left += lpad(ch.toString(16), 2, '0') + ' ';
        right += String.fromCharCode(ch > 32 && ch < 128 ? ch : 32);
        if (++count == wout) emit();
        if (count && count % word === 0) left += ' ';
    }

    if (count) emit();

    // console.log({len: buf.length, lines: buf.length / wout});
}

let lastN0 = Infinity;
let lastCMD = null;

function decode(buf) {
    const pkt = new Packet(buf);

    switch (pkt.getCommand()) {
        case 0x01: // client string command (home.getinfo or setting.getinfo)
            let CMD = pkt.data.strings[0];
            if (CMD !== lastCMD) {
                console.log({command: CMD});
                lastCMD = CMD;
            }
            break;
        case 0x02: // server home.getinfo
            // dump(buf);
            // console.log(pkt.toString());
            let N0 = pkt.data.ints[1];
            if (N0 !== lastN0) {
                console.log([
                    "n0",
                    N0,
                    lpad(N0.toString(16), 8, "0"),
                    lpad(N0.toString(2), 32, "0")
                ].join(", "));
                lastN0 = N0;
            }
            break;
        case 0x03: // client gcode command (M104 T0 S0) (ends w/ "\n")
            // dump(buf);
            console.log({gcode: pkt.data.strings});
            break;
        case 0x04: // client get dir info
            console.log(">> get dir info");
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x05: // server dir info
            console.log("<< dir info");
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x06: // client get file info
            console.log(">> get file info");
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x07: // server file info
            console.log("<< file info");
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x08: // client start print
            console.log(">> start print: " + inp.readString(c5));
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x09: // server print start ACK
            console.log("<< print started");
            console.log(pkt.toString());
            // dump(buf);
            break;
        case 0x0a: // server setting.getinfo
            console.log("<< settings.info");
            console.log(pkt.toString());
            break;
        default:
            console.log(pkt.toString());
            break;
    }
}

class Reader {
    constructor(buffer) {
        this.buffer = buffer;
        this.index = 0;
    }

    remain() {
        return this.buffer.length - this.index;
    }

    readByte() {
        if (this.remain() < 1) return 0;
        const data = this.buffer.readUInt8(this.index);
        this.index += 1;
        return data;
    }

    readInt() {
        if (this.remain() < 4) return 0;
        const data = this.buffer.readUInt32LE(this.index);
        this.index += 4;
        return data;
    }

    readLong() {
        if (this.remain() < 8) return 0;
        const data = (
            this.buffer.readUInt32LE(this.index) &
            this.buffer.readUInt32LE(this.index) << 32
        );
        this.index += 8;
        return data;
    }

    readIntBE() {
        if (this.remain() < 4) return 0;
        const data = this.buffer.readUInt32BE(this.index);
        this.index += 4;
        return data;
    }

    readShort() {
        if (this.remain() < 2) return 0;
        const data = this.buffer.readUInt16LE(this.index);
        this.index += 2;
        return data;
    }

    readBytes(len) {
        if (this.remain() < len) return null;
        const data = this.buffer.slice(this.index, this.index + len);
        this.index += len;
        return data;
    }

    readString(len, enc) {
        if (!len) len = this.readInt();
        if (this.remain() < len) return null;
        return this.readBytes(len).toString(enc || 'utf16le');
    }
}

class N2Print {
    constructor(file, host, port) {
        this.file = file;
        this.host = host;
        this.port = port;
        const socket = new net.Socket().connect({
            host: host,
            port: port
        })
            .on("connect", data => {
                // console.log("connected");
                var packet = new Packet()
                    .setCommand(0x8)
                    .setHeader(1,0,0,0,2)
                    .append([1])
                    .writeInt(file.length * 2)
                    .append(file)
                    .append([0,0,0,0])
                    .update();
                // dump(packet.buf);
                socket.write(packet.buf);
            })
            .on("data", data => {
                console.log({printing: file});
                // dump(data);
                socket.end();
            })
            .on("error", (error) => {
                socket.end();
            })
            .on("end", () => {
                socket.end();
            })
            .on("close", () => {
                // console.log("closed");
            })
            ;
    }
}

class N2Send {
    constructor(file, host, port, fileName, onDone) {
        const fbuf = fs.readFileSync(file);
        fileName = (fileName || file).split('/');
        fileName = fileName[fileName.length-1];
        console.log({sending: fileName, to: host, port: port});
        let tf = 1024 / 1000;
        let time = new Date().getTime();
        let seqno = 1;
        let findx = 0;
        const socket = new net.Socket().connect({
            host: host,
            port: port
        })
            .on("connect", data => {
                // console.log("connected");
                let packet = new Packet()
                    .setCommand(0xc)
                    .setHeader(0, 0, 0, 2, 1)
                    .writeInt(fbuf.length)
                    .writeInt(0) // 0
                    .writeInt(0) // data length
                    .writeInt(0) // 0
                    .writeInt(fileName.length * 2)
                    .append(fileName)
                    .update();
                // console.log("--- client ---");
                // packet.dump();
                socket.write(packet.buf);
            })
            .on("data", data => {
                // console.log("--- server ---");
                // dump(data);
                let packet = new Packet(data);
                if (packet.getCommand() == 0xd) {
                    fileName = packet.readLengthString(48);
                    console.log({location: fileName});
                }
                let tosend = Math.min(fbuf.length - findx, 8192);
                if (tosend <= 0) {
                    socket.end();
                    if (onDone) {
                        onDone(fileName);
                    }
                    return;
                }
                packet = new Packet()
                    .setCommand(0xe)
                    .setHeader(0, 0, 2, 0, 1)
                    .writeInt(seqno++)
                    .writeInt(tosend)
                    .writeInt(tosend)
                    .append(fbuf.slice(findx, findx + tosend))
                    .update();
                // console.log("--- client ---");
                // packet.dump();
                socket.write(packet.buf);
                findx += tosend;
                let mark = new Date().getTime();
                console.log({
                    progress: (100 * findx / fbuf.length).toFixed(2),
                    rate: Math.round((findx/(mark-time))*tf), // kB/sec
                    time: ((mark-time)/1000).toFixed(2) // seconds
                });
            })
            .on("error", (error) => {
                socket.end();
            })
            .on("end", () => {
                socket.end();
            })
            .on("close", () => {
                // console.log("closed");
            })
            ;
    }}

class Packet {
    constructor(buf) {
        if (buf) {
            this.decode(buf);
        }
        this.buf = buf || Buffer.from([
            0, 0, 0, 0, // packet length
            0, 0, 0, 0, // command
            1,          // version
            0,          // 0=client, 1=server
            0xff, 0xff, 0xff, 0xff, // magic
            0xff, 0xff, 0xff, 0xff, // magic
            0, 0,       // h0 (# bytes)
            0, 0,       // h1 (# shorts)
            0, 0,       // h2 (# ints)
            0, 0,       // h3 (# longs)
            0, 0        // h4 (# strings)
        ]);
    }

    toString() {
        let data = this.data;
        let darr = function(name, arr, len) {
            if (arr.length === 0) return null;
            if (arr.length <= (len || 5)) return name + "[" + arr.length + "]"+ " = " + arr.join(", ");
            return [name + "[" + arr.length + "] ="].concat(arr).join("\n ");
        };
        return [
            "[" + [data.typ, data.cs, data.m1, data.m2].join(",") + "]",
            darr("bytes", data.bytes, 1000),
            darr("shorts", data.shorts, 1000),
            darr("ints", data.ints, 1),
            darr("longs", data.longs, 1),
            darr("strings", data.strings, 1)
        ].filter(v => v !== null).join("\n");
    }

    decode(buf) {
        let inp = new Reader(buf);
        let len = inp.readInt();    // packet length
        let data = this.data = {
            typ: inp.readInt(),     // packet type
            ver: inp.readByte(),    // packet version
            cs:  inp.readByte(),    // 0=client, 1=server
            m1:  inp.readInt(),     // 0xffffffff (magic1)
            m2:  inp.readInt(),     // 0xffffffff (magic2)
            bytes:   [],            // byte data
            shorts:  [],            // short data
            ints:    [],            // int data
            longs:   [],            // long data
            strings: []             // String data
        };
        let nb = inp.readShort();   // # bytes
        let ns = inp.readShort();   // # shorts
        let ni = inp.readShort();   // # ints
        let nl = inp.readShort();   // # longs
        let nS = inp.readShort();   // # strings

        for (let i=0; i<nb; i++) data.bytes.push(inp.readByte())
        for (let i=0; i<ns; i++) data.shorts.push(inp.readShort())
        for (let i=0; i<ni; i++) data.ints.push(inp.readInt())
        for (let i=0; i<nl; i++) data.longs.push(inp.readLong())
        for (let i=0; i<nS; i++) data.strings.push(inp.readString())
    }

    getCommand() {
        return this.buf.readUInt32LE(4);
    }

    setCommand(c) {
        this.buf.writeUInt32LE(c, 4);
        return this;
    }

    getMagic() {
        return [
            this.buf.readUInt32LE(10),
            this.buf.readUInt32LE(4)
        ];
    }

    setMagic(v0, v1) {
        this.buf.writeUInt32LE(v0, 10);
        this.buf.writeUInt32LE(v1, 14);
        return this;
    }

    getHeader() {
        return [
            this.buf.readUInt16LE(18),
            this.buf.readUInt16LE(20),
            this.buf.readUInt16LE(22),
            this.buf.readUInt16LE(24),
            this.buf.readUInt16LE(26)
        ];
    }

    setHeader(v0, v1, v2, v3, v4, v5) {
        this.buf.writeUInt16LE(v0, 18);
        this.buf.writeUInt16LE(v1, 20);
        this.buf.writeUInt16LE(v2, 22);
        this.buf.writeUInt16LE(v3, 24);
        this.buf.writeUInt16LE(v4, 26);
        return this;
    }

    readBytes(pos, len) {
        return this.buf.slice(pos, pos+len);
    }

    readString(pos, len, enc) {
        return this.readBytes(pos, len).toString(enc || 'utf16le');
    }

    readLengthString(pos, enc) {
        let len = this.readInt(pos);
        return this.readBytes(pos + 4, len).toString(enc || 'utf16le');
    }

    readShort(pos) {
        return this.buf.readUInt16BE(pos);
    }

    readInt(pos) {
        return this.buf.readUInt32BE(pos);
    }

    writeByte(v) {
        return this.append([v]);
    }

    writeShort(v) {
        let pos = this.buf.length;
        this.append([0,0]);
        this.buf.writeUInt16LE(v, pos);
        return this;
    }

    writeInt(v) {
        let pos = this.buf.length;
        this.append([0,0,0,0]);
        this.buf.writeUInt32LE(v, pos);
        return this;
    }

    writeString(str) {
        this.writeInt(str.length * 2);
        this.append(str);
        return this;
    }

    append(buf) {
        if (typeof(buf) === 'string') {
            buf = Buffer.from(buf, "utf16le");
        } else if (Array.isArray(buf)) {
            buf = Buffer.from(buf);
        }
        this.buf = Buffer.concat([this.buf, buf]);
        return this;
    }

    update() {
        this.buf.writeUInt32LE(this.buf.length - 4, 0);
        return this;
    }

    dump() {
        dump(this.buf);
    }
}

class TCPipe {
    constructor(lport, dhost, dport) {
        this.server = net.createServer(client => {
            let last = null;
            let buf = null;
            const emit = (socket, buffer) => {
                // console.log("--- " + socket.name + " ---");
                decode(buffer);
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

class N2Control {
    constructor(host, port) {
        let temp = 0;
        console.log({ctrl: host, port: port});
        let socket = this.socket = new net.Socket().connect({
            host: host,
            port: port
        })
            .on("connect", () => {
                console.log("connected");
                let packet = new Packet()
                    .setCommand(0x1)
                    .setHeader(0, 0, 0, 0, 1)
                    .writeString("setting.getinfo")
                    .update();
                socket.write(packet.buf);
                packet = new Packet()
                    .setCommand(0x1)
                    .setHeader(0, 0, 0, 0, 1)
                    .writeString("home.getinfo")
                    .update();
                socket.write(packet.buf);
            })
            .on("data", data => {
                let packet = new Packet(data);
                console.log([temp-1, packet.data.ints[1]]);

                if (packet.getCommand() === 2) {
                    packet = new Packet()
                        .setCommand(0x3)
                        .setHeader(1, 0, 0, 0, 1)
                        .writeByte(0)
                        .writeString("M104 T0 S" + temp + "\n")
                        .update();
                    temp++;

                    socket.write(packet.buf);

                    setTimeout(() => {
                        packet = new Packet()
                            .setCommand(0x1)
                            .setHeader(0, 0, 0, 0, 1)
                            .writeString("home.getinfo")
                            .update();
                        socket.write(packet.buf);
                    }, 3000);
                }
            })
            .on("error", error => {
                socket.end();
                console.log({error: error});
            })
            .on("end", () => {
                console.log('end');
            })
            .on("close", () => {
                console.log('close');
            });
    }
}

module.exports = {
    TCPipe: TCPipe
};

if (!module.parent) {
    const arg = process.argv.slice(2);
    const cmd = arg.shift() || '';
    let file, host, port, lport, fname;

    switch (cmd) {
        case 'dump':
            file = arg.shift();
            let skip = parseInt(arg.shift() || "0");
            let words = parseInt(arg.shift() || "4");
            let word = parseInt(arg.shift() || "4");
            fs.readFile(file, function(err, data) {
                dump(data, skip, words, word);
            })
            break;
        case 'ctrl':
            new N2Control(arg.shift(), parseInt(arg.shift() || "31625"));
            break;
        case 'pipe':
            host = arg.shift() || "localhost";
            port = arg.shift() || "31625";
            lport = arg.shift() || port;
            new TCPipe(parseInt(lport), host, parseInt(port));
            break;
        case 'send':
            file = arg.shift();
            host = arg.shift() || "localhost";
            port = arg.shift() || "31626";
            fname = arg.shift();
            new N2Send(file, host, parseInt(port), fname);
            break;
        case 'kick':
            file = arg.shift();
            host = arg.shift() || "localhost";
            port = arg.shift() || "31625";
            new N2Print(file, host, parseInt(port));
            break;
        case 'print':
            file = arg.shift();
            host = arg.shift() || "localhost";
            port = parseInt(arg.shift() || "31625");
            fname = arg.shift();
            new N2Send(file, host, port + 1, fname, function(filename) {
                new N2Print(filename, host, port);
            });
            break;
        default:
            console.log([
                "invalid command: " + cmd,
                "usage:",
                "  send  [file] [host] [port] [filename]",
                "  kick  [file] [host] [port]",
                "  print [file] [host] [port] [filename]"
            ].join("\n"));
            break;
    }
}
