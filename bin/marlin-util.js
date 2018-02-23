const LineBuffer = require("buffer.lines");
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
let   paused = false;                           // queue processing paused
let   processing = false;                       // queue being drained

console.log({port: port, baud: baud, bufmax: bufmax});

const cmdlog = (line) => {
    console.log("[" + waiting + ":" + bufmax + "," + buf.length + ":" + maxout + "] " + line);
};

const evtlog = (line) => {
    console.log("*** " + line + " ***");
};

const client = new SerialPort(port, { baudRate: baud })
    .on('open', function() {
        evtlog("open: " + port);
    })
    .on('line', function(line) {
        line = line.toString().trim();
        cmdlog("<-- " + line);
        if (line.indexOf("ok") === 0) {
            waiting--;
            line = line.substring(3);
        }
        processLine(line);
        processQueue();
    })
    .on('close', function() {
        evtlog("close");
    });

process.stdin.on("line", line => {
    line = line.toString().trim();
    if (line.indexOf("*abort") === 0) {
        abort();
        return;
    }
    if (line.indexOf("*pause") === 0) {
        pause();
        return;
    }
    if (line.indexOf("*resume") === 0) {
        resume();
        return;
    }
    if (line.indexOf("*send ") === 0) {
        evtlog("send: " + line);
        let gcode = fs.readFileSync(line.substring(6)).toString().split("\n");
        gcode.forEach(line => {
            queue(line);
        });
    } else {
        queue(line, true);
    }
});

const abort = () => {
    evtlog("execution aborted");
    // safety if buffer in play
    if (buf.length) buf = [
        "M104 S0 T0",   // extruder 0 heat off
        "M104 S0 T1",   // extruder 1 heat off
        "M140 S0 T0",   // bed heat off
        "G91",          // relative moves
        "G0 Z10",       // drop bed 1cm
        "G28 X0 Y0",    // home X & Y
        "M84"           // disable steppers
    ];
    processQueue();
};

const pause = () => {
    if (paused) return;
    evtlog("execution paused");
    paused = true;
};

const resume = () => {
    if (!paused) return;
    evtlog("execution resumed");
    paused = false;
    processQueue();
};

const processLine = (line) => {
    if (line.length === 0) return;
    if (line.indexOf("T:") === 0) { } // parse extruder/bed temps
    if (line.indexOf("X:") === 0) { } // parse x/y/z/e positions
    if (line.indexOf("_min:") > 0) { } // parse endstop status
    if (line.indexOf("_max:") > 0) { } // parse endstop status
};

const processQueue = () => {
    if (processing) return;
    processing = true;
    while (waiting < bufmax && buf.length && !paused) {
        write(buf.shift());
    }
    if (buf.length === 0) {
        maxout = 0;
    }
    processing = false;
};

const queue = (line, priority) => {
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

const write = (line) => {
    if (line.indexOf("M2000") === 0) {
        pause();
        return;
    }
    switch (line.charAt(0)) {
        case ';':
            return;
        case 'M':
        case 'G':
            waiting++;
            break;
    }
    cmdlog("--> " + line);
    client.write(line + "\n");
}

new LineBuffer(client);
new LineBuffer(process.stdin);
