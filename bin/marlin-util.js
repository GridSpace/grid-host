/** Copyright 2014-2018 Stewart Allen <so@a3z.co> -- All Rights Reserved */
"use strict";

const LineBuffer = require("buffer.lines");
const SerialPort = require('serialport');
const opt = require('minimist')(process.argv.slice(2));
const net = require('net');
const fs = require('fs');

const port = opt.port || opt._[0];              // serial port name
const baud = parseInt(opt.baud || "250000");    // baud rate for serial port
const bufmax = parseInt(opt.buflen || "4");     // max unack'd output lines

let waiting = 0;                // unack'd output lines
let maxout = 0;                 // high water mark for buffer
let debug = true;               // echo commands
let paused = false;             // queue processing paused
let processing = false;         // queue being drained
let dircache = [];              // cache of files in watched directory
let clients = [];               // connected clients
let buf = [];                   // output line buffer

const status = {
    print: {
        clear: false,           // bed is clear to print
        filename: null          // current file name
    },
    temp: {                     // measured temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    },
    set: {                      // set/target temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    }
};

// write line to all connected clients
const emit = (line) => {
    clients.forEach(client => {
        client.write(line + "\n");
    });
}

const cmdlog = (line) => {
    if (debug || waiting <= 1) emit("[" + waiting + ":" + bufmax + "," + buf.length + ":" + maxout + "] " + line);
};

const evtlog = (line) => {
    emit("*** " + line + " ***");
};

const sport = new SerialPort(port, { baudRate: baud })
    .on('open', function() {
        evtlog("open: " + port);
        new LineBuffer(sport);
    })
    .on('line', function(line) {
        line = line.toString().trim();
        cmdlog("<-- " + line);
        if (line.indexOf("ok") === 0) {
            waiting--;
            line = line.substring(3);
        }
        processPortOutput(line);
        processQueue();
    })
    .on('close', function() {
        evtlog("close");
    });

const processPortOutput = (line) => {
    if (line.length === 0) return;
    if (line.indexOf("T:") === 0) {
        // parse extruder/bed temps
        line = line.replace(/ \//g,'/').split(' ');
        console.log(line);
    }
    if (line.indexOf("X:") === 0) {
        // parse x/y/z/e positions
    }
    if (line.indexOf("_min:") > 0) { } // parse endstop status
    if (line.indexOf("_max:") > 0) { } // parse endstop status
};

const sendFile = (filename) => {
    if (!status.print.clear) {
        return evtlog("bed not marked clear. use *clear first");
    }
    status.print.clear = false;
    status.print.filename = filename;
    evtlog("send: " + filename);
    try {
        let gcode = fs.readFileSync(filename).toString().split("\n");
        gcode.forEach(line => {
            queue(line);
        });
    } catch (e) {
        evtlog("error sending file");
        console.log(e);
    }
}

const processCmdLine = (line) => {
    line = line.toString().trim();
    switch (line) {
        case "*auto on": return opt.auto = true;
        case "*auto off": return opt.auto = false;
        case "*debug on": return debug = true;
        case "*debug off": return debug = false;
        case "*kick": return kickNext();
        case "*abort": return abort();
        case "*pause": return pause();
        case "*resume": return resume();
        case "*clear":
            status.print.clear = true;
            return evtlog("bed marked clear");
        case "*status":
            return evtlog(JSON.stringify(status));
    }
    if (line.indexOf("*send ") === 0) {
        sendFile(line.substring(6));
    } else {
        queue(line, true);
    }
};

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
    status.print.clear = false;
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

const processQueue = () => {
    if (processing) return;
    processing = true;
    while (waiting < bufmax && buf.length && !paused) {
        write(buf.shift());
    }
    if (buf.length === 0) {
        maxout = 0;
        status.print.progress = "100.00";
    } else {
        status.print.progress = ((1.0 - (buf.length / maxout)) * 100.0).toFixed(2);
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
    sport.write(line + "\n");
}

const checkDropDir = () => {
    if (!opt.dir) return;
    try {
        let valid = [];
        fs.readdirSync(opt.dir).forEach(name => {
            if (name.indexOf(".gcode") > 0) {
                name = opt.dir + "/" + name;
                let stat = fs.statSync(name);
                valid.push({name: name, size: stat.size, time: stat.mtime});
            }
        });
        valid.sort((a, b) => {
            return b.mtime - a.mtime;
        });
        dircache = valid;
        if (opt.auto && valid.length && status.print.clear) {
            kickNext();
        }
        setTimeout(checkDropDir, 2000);
    } catch (e) {
        console.log(e);
    }
};

const kickNext = () => {
    if (!dircache.length) return evtlog("no valid files");
    sendFile(dircache[0].name);
};

// -- start it up --

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

if (opt.stdin) {
    new LineBuffer(process.stdin);
    process.stdin.on("line", line => { processCmdLine(line) });
    clients.push(process.stdout);
}

if (opt.listen) {
    net.createServer(socket => {
        new LineBuffer(socket);
        clients.push(socket);
        socket.on("line", line => { processCmdLine(line) });
        socket.on("close", () => {
            clients.splice(clients.indexOf(socket),1);
        });
    }).listen(parseInt(opt.listen));
}

console.log({port: port, baud: baud, bufmax: bufmax});

checkDropDir();
