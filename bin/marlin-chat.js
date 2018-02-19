const LineBuffer = require("./LineBuffer");
const SerialPort = require('serialport');
const opt = require('minimist')(process.argv.slice(2));
const fs = require('fs');

if (opt.probe) {
    SerialPort.list((err, ports) => {
        ports.forEach(port => {
            console.log([
                port.comName,
                port.pnpId        || null,
                port.manufacturer || null,
                port.vendorId     || null,
                port.productId    || null,
                port.serialNumber || null
            ].join(", "));
        });
        process.exit(0);
    });
    return;
}

const port = opt._[0];                          // serial port name
const baud = parseInt(opt.baud || "250000");    // baud rate for serial port
const bufmax = parseInt(opt.buflen || "4");     // max unack'd output lines

let   buf = [];                                 // output buffer
let   waiting = 0;                              // unack'd output lines
let   maxout = 0;

console.log({port: port, baud: baud, bufmax: bufmax});

const log = (line) => {
    console.log("[" + waiting + ":" + bufmax + "," + buf.length + ":" + maxout "] " + line);
};

const client = new SerialPort(port, { baudRate: baud })
    .on('open', function() {
        console.log("* open: " + port);
    })
    .on('line', function(line) {
        line = line.toString().trim();
        if (line == "ok") {
            waiting--;
        }
        // if (line.indexOf("echo:Unknown command") === 0) {
        //     waiting--;
        // }
        log("<-- " + line);
        while (waiting < bufmax && buf.length) {
            write(buf.shift());
        }
        if (buf.length === 0) {
            maxout = 0;
        }
    })
    .on('close', function() {
        console.log("* close");
    });

process.stdin.on("line", line => {
    line = line.toString().trim();
    if (line.indexOf("*abort") === 0) {
        buf = [];
        return;
    }
    if (line.indexOf("*send ") === 0) {
        console.log("==> " + line);
        let gcode = fs.readFileSync(line.substring(6)).toString().split("\n");
        gcode.forEach(line => {
            send(line);
        });
    } else {
        send(line, true);
    }
});

const write = (line) => {
    switch (line.charAt(0)) {
        case ';':
            return;
        case 'M':
        case 'G':
            waiting++;
            break;
    }
    log("--> " + line);
    client.write(line + "\n");
}

const send = (line, priority) => {
    line = line.trim();
    if (line.length === 0) return;
    if (waiting < bufmax) {
        write(line);
    } else {
        if (priority) {
            buf.splice(0, 0, line)
        } else {
            buf.push(line);
        }
        maxout = Math.max(maxout, buf.length);
    }
};

new LineBuffer(client);
new LineBuffer(process.stdin);
