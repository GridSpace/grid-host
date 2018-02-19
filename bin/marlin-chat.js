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
const buf = [];                                 // output buffer

let   waiting = 0;                              // unack'd output lines

const client = new SerialPort(port, { baudRate: baud })
    .on('open', function() {
        console.log("* open: " + port);
    })
    .on('line', function(line) {
        line = line.toString().trim();
        if (line == "ok") {
            if (waiting < bufmax && buf.length) {
                console.log("[" + waiting + "] -->" + buf[0]);
                client.write(buf.shift() + "\n");
            } else {
                waiting--;
            }
        }
        console.log("[" + waiting + "] <-- " + line);
    })
    .on('close', function() {
        console.log("* close");
    });

process.stdin.on("line", line => {
    line = line.toString().trim();
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

const send = (line, priority) => {
    if (waiting < bufmax) {
        console.log("[" + waiting + "] -->" + line);
        client.write(line + "\n");
        switch (line.charAt(0)) {
            case 'M':
            case 'G':
                waiting++;
                break;
        }
    } else {
        if (priority) {
            buf.splice(0, 0, line)
        } else {
            buf.push(line);
        }
    }
};

new LineBuffer(client);
new LineBuffer(process.stdin);
