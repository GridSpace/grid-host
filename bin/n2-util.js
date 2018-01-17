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

function dump(buf) {
    let left = '';
    let right = '';
    let index = 0;
    let count = 0;
    let emit = function() {
        console.log(rpad(left, 52) + right);
        left = '';
        right = '';
        count = 0;
    };

    while (index < buf.length) {
        let ch = buf.readUInt8(index++);
        left += lpad(ch.toString(16), 2, '0') + ' ';
        right += String.fromCharCode(ch > 32 && ch < 128 ? ch : 32);
        if (++count == 16) emit();
        if (count && count % 4 === 0) left += ' ';
    }

    if (count) emit();
}

function decode(buf) {
    const inp = new Reader(buf);
    const len = inp.readInt(),
            s1 = inp.readInt(),
            s2 = inp.readByte(),
            s3 = inp.readByte(),
            m1 = inp.readInt(),     // 0xffffffff (magic1)
            m2 = inp.readInt(),     // 0xffffffff (magic2)
            c1 = inp.readInt(),     // command1 (4 bytes)
            c2 = inp.readShort(),   // command2 (2 bytes)
            c3 = inp.readShort(),   // command3 (2 bytes)
            c4 = inp.readShort(),   // command4 (2 bytes)
            xx = s1 === 3 || s1 === 8 ? inp.readByte() : 0, // random extra byte when s1 == 3
            c5 = inp.readShort(),   // command5 (2 bytes)
            c6 = inp.readShort();   // command6 (2 bytes)

    // console.log("buffer.length = " + buf.length + " len = " + len);

    switch (s1) {
        case 0x01: // client string command (home.getinfo or setting.getinfo)
            console.log({command: inp.readString(c5)});
            break;
        case 0x02: // server home.getinfo
            let skip = inp.readBytes(20);
            console.log("<< home.info = " + JSON.stringify({
                // nb0: inp.readByte(),
                // nb1: inp.readByte(),
                // nb2: inp.readByte(),
                // nb3: inp.readByte(),
                // ns0: inp.readByte(),
                // ns1: inp.readByte(),
                // ns2: inp.readByte(),
                // ns3: inp.readByte()

                nb: lpad(inp.readInt().toString(2), 16, '0'),
                ns: lpad(inp.readInt().toString(2), 16, '0')

                /**
                  0 = 0000000000000000 = 0
                  1 = 0011111110000000 = 16256
                  2 = 0100000000000000 = 16384
                  3 = 0100000001000000 = 16448
                  4 = 0100000010000000 = 16512
                  5 = 0100000010100000 = 16544
                  6 = 0100000011000000 = 16576
                  7 = 0100000011100000 = 16608
                  8 = 0100000100000000 = 16640
                  9 = 0100000100010000 = 16656
                 10 = 0100000100100000 = 16672
                 11 = 0100000100110000
                 12 = 0100000101000000
                 13 = 0100000101010000
                 14 = 0100000101100000
                 15 = 0100000101110000
                 16 = 0100000110000000
                 17 = 0100000110001000
                 25 = 0100000111001000
                 32 = 0100001000000000
                 64 = 0100001010000000
                128 = 0100001100000000
                 */

                // n1: inp.readInt(),
                // s1: inp.readInt(),
                // n2: inp.readInt(),
                // s2: inp.readInt(),
                // bv: inp.readInt(),
                // bs: inp.readInt(),
                // v0: inp.readInt(),
                // t0: inp.readInt(),
                // v1: inp.readInt(),
                // t1: inp.readInt(),
                // v2: inp.readInt(),
                // t2: inp.readInt()
            }));
            dump(buf);
            break;
        case 0x03: // client gcode command (M104 T0 S0) (ends w/ "\n")
            console.log({gcode: inp.readString(c5).trim()});
            break;
        case 0x04: // client get dir info
            console.log(">> get dir info");
            dump(buf);
            break;
        case 0x05: // server dir info
            console.log("<< dir info");
            dump(buf);
            break;
        case 0x06: // client get file info
            console.log(">> get file info");
            dump(buf);
            break;
        case 0x07: // server file info
            console.log("<< file info");
            dump(buf);
            break;
        case 0x08: // client start print
            console.log(">> start print: " + inp.readString(c5));
            dump(buf);
            break;
        case 0x09: // server print start ACK
            console.log("<< print started");
            dump(buf);
            break;
        case 0x0a: // server setting.getinfo
            console.log("<< settings.info");
            break;
        default:
            dump(buf);
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
                console.log("connected");
                var packet = Buffer.concat([
                    Buffer.from([
                        0, 0, 0, 0, // packet length (overwrite)
                        8, 0, 0, 0, // command 8
                        1, 0,
                        0xff, 0xff, 0xff, 0xff, // magic
                        0xff, 0xff, 0xff, 0xff, // magic
                        1, 0, 0, 0,
                        0, 0, 0, 0,
                        2, 0,
                        1,
                        0, 0, 0, 0 // string length (overwrite)
                    ]),
                    Buffer.from(file, "utf16le"),
                    Buffer.from([
                        0, 0, 0, 0
                    ])
                ]);

                packet.writeUInt32LE(packet.length - 4, 0);
                packet.writeUInt32LE(file.length * 2, 29);
                dump(packet);
                socket.write(packet);
            })
            .on("data", data => {
                dump(data);
            })
            .on("error", (error) => {
                socket.end();
            })
            .on("end", () => {
                socket.end();
            })
            .on("close", () => {
                console.log("closed");
                // ok
            })
            ;
    }
}

class TCPipe {
    constructor(lport, dhost, dport) {
        this.server = net.createServer(client => {
            let last = null;
            let buf = null;
            const emit = (socket, buffer) => {
                console.log("--- " + socket.name + " ---");
                decode(buffer);
                // if (buffer.length > 256) {
                //     console.log(buffer.toString("hex"));
                // } else {
                //     console.log(buffer.toString().trim());
                // }
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
    TCPipe: TCPipe
};

if (!module.parent) {
    const arg = process.argv.slice(2);
    const cmd = arg.shift();

    switch (cmd) {
        case 'pipe':
            let dhost = arg.shift() || "localhost";
            let dport = arg.shift() || "31625";
            let lport = arg.shift() || dport;
            new TCPipe(parseInt(lport), dhost, parseInt(dport));
            break;
        case 'print':
            let file = arg.shift();
            let host = arg.shift() || "localhost";
            let port = arg.shift() || "31625";
            new N2Print(file, host, parseInt(port));
            break;
        default:
            console.log([
                "invalid command: " + cmd,
                "usage:",
                "  pipe [dhost] [dport] [lport]",
                "  print [file] [host] [port]"
            ].join("\n"));
            break;
    }
}
