const LineBuffer = require("./LineBuffer");
const SerialPort = require('serialport');
const opt = require('minimist')(process.argv.slice(2));
const fs = require('fs');

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
        if (line == "ok") {
            if (waiting < bufmax && buf.length) {
                client.write(buf.shift() + "\n");
            } else {
                waiting--;
            }
        }
        console.log("[" + waiting + "] <-- " + line.toString());
    })
    .on('close', function() {
        console.log("* close");
    });

process.stdin.on("line", line => {
    line = line.toString();
    console.log("--> " + line);
    if (line.indexOf("*send ") === 0) {
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
        client.write(line + "\n");
        waiting++;
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
