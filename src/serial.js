/** Copyright 2014-2018 Stewart Allen <so@a3z.co> -- All Rights Reserved */
"use strict";

/**
 * About
 *
 * provide raw socket, web socket, and web interface to serial-controlled
 * hardware such as FDM 3D printers and CNC mills based on marlin derived
 * firmwares.
 *
 * TODO
 *
 * different abort per device or type (fdm vs cnc)
 */

const LineBuffer = require("./linebuffer");
const SerialPort = require('serialport');
const opt = require('minimist')(process.argv.slice(2));
const net = require('net');
const fs = require('fs');
const { exec } = require('child_process');

const port = opt.device || opt.port || opt._[0]; // serial port device path
const baud = parseInt(opt.baud || "250000");     // baud rate for serial port
const bufmax = parseInt(opt.buflen || "8");      // max unack'd output lines

const url = require('url');
const http = require('http');
const serve = require('serve-static');
const connect = require('connect');
const WebSocket = require('ws');
const filedir = (opt.dir || opt.filedir);
const auto_int_def = opt.auto >= 0 ? parseInt(opt.auto) : 1000;

let starting = false;           // output phase just after reset
let waiting = 0;                // unack'd output lines
let maxout = 0;                 // high water mark for buffer
let paused = false;             // queue processing paused
let processing = false;         // queue being drained
let sdspool = false;            // spool to sd for printing
let dircache = [];              // cache of files in watched directory
let clients = [];               // connected clients
let buf = [];                   // output line buffer
let match = [];                 // queue for matching command with response
let collect = null;             // collect lines between oks
let sport = null;               // bound serial port
let upload = null;              // name of file being uploaded
let mode = 'marlin';            // operating mode
let interval = null;            // pointer to interval updater
let auto = true;                // true to enable interval collection of data
let auto_lb = 0;                // interval last buffer size check
let auto_int = auto_int_def;    // interval for auto collect in ms
let onboot = [];                // commands to run on boot (useful for abort)

// marlin-centric, to be fixed
const status = {
    clients: {
        ws: 0,                  // web socket client count
        net: 0,                 // direct network clients
        stdin: 0                // 1 of stdin active
    },
    buffer: {
        waiting: 0,             // unack'd output
        queue: 0,               // queue depth
    },
    device: {
        ready: false,           // true when connected and post-init
        boot: 0,                // time of last boot
        connect: 0,             // time port was opened successfully
        close: 0,               // time of last close
        line: 0                 // time of last line output
    },
    error: {
        time: 0,                // time of last error
        cause: null             // last error message
    },
    print: {
        run: false,             // print running
        clear: false,           // bed is clear to print
        filename: null,         // current file name
        progress: 0.0
    },
    target: {                   // target temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    },
    temp: {                     // measured temp
        bed: null,              // bed
        ext: [ null ]           // extruders
    },
    estop: {                    // endstop status
        min: {},
        max: {}
    },
    settings: {},               // map of active settings
};

// write line to all connected clients
function emit(line, flags) {
    const stat = flags && flags.status;
    const list = flags && flags.list;
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    clients.forEach(client => {
        let cstat = (stat && client.request_status);
        let clist = (list && client.request_list);
        let cmatch = flags && flags.channel === client;
        if (cmatch || cstat || clist || (client.monitoring && !stat && !list)) {
            client.write(line + "\n");
            if (cstat) {
                client.request_status = false;
            }
            if (clist) {
                client.request_list = false;
            }
        }
    });
}

function cmdlog(line, flags) {
    if (opt.debug) {
        return;
    }
    if (flags && flags.print && !opt.verbose) {
        return;
    }
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    if (!flags || !(flags && flags.auto)) {
        emit("[" + waiting + ":" + bufmax + "," + buf.length + ":" + maxout + "] " + line, flags);
    }
};

// send *** message *** to all clients (not stdout unless stdin specified)
function evtlog(line, flags) {
    if (typeof(line) === 'object') {
        line = JSON.stringify(line);
    }
    emit("*** " + line + " ***", flags);
};

function openSerialPort() {
    if (!port || sport) {
        return;
    }
    sport = new SerialPort(port, { baudRate: baud })
        .on('open', function() {
            evtlog("open: " + port);
            new LineBuffer(sport);
            status.device.connect = Date.now();
        })
        .on('error', function(error) {
            sport = null;
            console.log(error);
            setTimeout(openSerialPort, 1000);
            clearInterval(interval);
            interval = null;
            status.device.connect = 0;
            status.device.ready = false;
        })
        .on('line', function(line) {
            if (opt.debug) {
                let cmd = (match[0] || {line:''}).line;
                console.log("<... " + (cmd ? cmd + " -- " + line : line));
            }
            status.device.line = Date.now();
            line = line.toString().trim();
            let matched = null;
            if (starting && line.indexOf("echo:  M900") === 0) {
                cmdlog("<-- " + line, {});
                collect = [];
                starting = false;
                if (opt.kick) {
                    processInput("*clearkick");
                }
            } else if (line.indexOf("ok") === 0 || line.indexOf("error:") === 0) {
                if (line.indexOf("ok ") === 0 && collect) {
                    line = line.substring(3);
                    collect.push(line);
                }
                matched = match.shift();
                let from = matched ? matched.line : "???";
                let flags = matched ? matched.flags : {};
                // callbacks used by auto stats gathering
                if (flags.callback) {
                    flags.callback(collect, matched.line);
                }
                // auto stats reporting
                if (!matched || !matched.flags.auto) {
                    if (collect && collect.length) {
                        if (collect.length >= 4) {
                            cmdlog("==> " + from, flags);
                            collect.forEach((el, i) => {
                                if (i === 0) {
                                    cmdlog("<-- " + el, flags);
                                } else {
                                    cmdlog("    " + el, flags);
                                }
                            });
                        } else {
                            cmdlog("==> " + from + " -- " + JSON.stringify(collect), flags);
                        }
                    }
                }
                status.buffer.waiting = waiting = Math.max(waiting - 1, 0);
                if (status.update) {
                    status.update = false;
                }
                collect = [];
            } else if (collect) {
                collect.push(line);
            } else {
                cmdlog("<-- " + line, {auto: matched});
            }
            processPortOutput(line);
            processQueue();
        })
        .on('close', function() {
            sport = null;
            evtlog("close");
            setTimeout(openSerialPort, 1000);
            status.device.close = Date.now();
            status.device.ready = false;
        });
}

function processPortOutput(line) {
    if (line.length === 0) return;
    let update = false;
    if (line === "start") {
        update = true;
        starting = true;
        status.device.ready = true;
        status.device.boot = Date.now();
        status.print.clear = false;
        status.buffer.waiting = waiting = 0;
        collect = null;
        match = [];
        buf = [];
        // queue onboot commands
        onboot.forEach(cmd => {
            queue(cmd);
        });
        onboot = [];
        // setup interval data collection
        if (!interval) {
            // prevent rescheduling a command until it's completed
            let runflags = {
                "M114": true,
                "M105": true
            };
            interval = setInterval(() => {
                if (!status.device.ready || auto_int === 0) {
                    return;
                }
                let priority = true;
                let callback = (collect, line) => {
                    runflags[line] = true;
                };
                // only queue when wait is decreasing or zero and not printing
                // if (buf.length === 0 && status.print.run === false) {
                if (buf.length === 0 || buf.length <= auto_lb - 3) {
                    for (let key in runflags) {
                        if (runflags[key]) {
                            runflags[key] = false;
                            queue(key, {auto: true, priority, callback}); // get endstops
                        }
                    }
                // } else {
                //     evtlog({auto_blocked: buf.length, last: auto_lb, waiting});
                }
                auto_lb = buf.length;
            }, auto_int);
        }
    }
    // parse M105 temperature updates
    if (line.indexOf("T:") === 0) {
        // eliminate spaces before slashes " /"
        line = line.replace(/ \//g,'/').split(' ');
        // parse extruder/bed temps
        line.forEach(tok => {
            tok = tok.split(":");
            switch (tok[0]) {
                case 'T':
                    tok = tok[1].split("/");
                    status.temp.ext[0] = parseFloat(tok[0]);
                    status.target.ext[0] = parseFloat(tok[1]);
                    update = true;
                    break;
                case 'B':
                    tok = tok[1].split("/");
                    status.temp.bed = parseFloat(tok[0]);
                    status.target.bed = parseFloat(tok[1]);
                    update = true;
                    break;
            }
        });
    }
    // parse M114 x/y/z/e positions
    if (line.indexOf("X:") === 0) {
        let pos = status.pos = {};
        line.split(' ').forEach(tok => {
            tok = tok.split(':');
            if (tok.length === 2) {
                // do not overwrite value (Z: comes twice, for example)
                if (!pos[tok[0]]) {
                    pos[tok[0]] = parseFloat(tok[1]);
                    update = true;
                }
            }
        });
    }
    // parse M119 endstop status
    if (line.indexOf("_min:") > 0) {
        status.estop.min[line.substring(0,1)] = line.substring(6);
        update = true;
    }
    if (line.indexOf("_max:") > 0) {
        status.estop.max[line.substring(0,1)] = line.substring(6);
        update = true;
    }
    // parse M503 settings status
    if (line.indexOf("echo:  M") === 0) {
        line = line.substring(7).split(' ');
        let code = {
            // M149: "temp_units",
            // M200: "filament",
            M92:  "steps_per",
            M203: "feedrate_max",
            M201: "accel_max",
            M204: "accel",
            M205: "advanced",
            M206: "offset",
            // M145: "heatup",
            M301: "pid",
            M900: "lin_advance"
        }[line.shift()] || null;
        let map = {};
        line.forEach(tok => {
            map[tok.substring(0,1)] = parseFloat(tok.substring(1));
        });
        if (code) {
            status.settings[code] = map;
        }
        update = true;
    }
    // catch fatal errors and reboot
    if (line.indexOf("Error:") === 0) {
        status.error = {
            time: Date.now(),
            cause: line.substring(6)
        };
        evtlog(line);
        sport.close();
        if (opt.fragile) {
            if (opt.debug) process.exit(-1);
        }
    }
    // catch processing errors and reboot
    if (opt.fragile && line.indexOf("Unknown command:") >= 0) {
        evtlog(`fatal: ${line}`);
        sport.close();
        if (opt.debug) process.exit(-1);
    }
    if (update) {
        status.update = true;
    }
};

function sendFile(filename) {
    if (!status.print.clear) {
        return evtlog("bed not marked clear. use *clear first");
    }
    status.print.run = true;
    status.print.clear = false;
    status.print.filename = filename;
    status.print.start = Date.now();
    evtlog("send: " + filename);
    // prevent auto polling during send buffering
    let auto_save = auto;
    auto = false;
    try {
        let gcode = fs.readFileSync(filename).toString().split("\n");
        if (sdspool) {
            evtlog(`spooling "${filename} to SD"`);
            queue(`M28 print.gco`);
            gcode.forEach(line => {
                queue(line);
            });
            queue(`M29`);
            evtlog(`printing "${filename} from SD"`);
            queue(`M23 print.gco`);
            queue(`M24`);
        } else {
            gcode.forEach(line => {
                queue(line, {print: true});
            });
        }
    } catch (e) {
        evtlog("error sending file");
        console.log(e);
    }
    auto = auto_save;
}

function processInput(line, channel) {
    try {
        processInput2(line, channel);
    } catch (e) {
        console.trace(line, e);
    }
}

function processInput2(line, channel) {
    line = line.toString().trim();
    if (line.indexOf("*exec ") === 0) {
        let cmd = line.substring(6);
        exec(cmd, (err, stdout, stderr) => {
            evtlog(JSON.stringify({cmd, err, stdout, stderr}));
        });
        return;
    }
    switch (line) {
        case "*bounce": return sport.close();
        case "*auto on": return auto = true;
        case "*auto off": return auto = false;
        case "*match":
            console.log({match});
            return;
        case "*list":
            if (channel) {
                channel.request_list = true;
            }
            return evtlog(JSON.stringify(dircache), {list: true});
        case "*clearkick":
            status.print.clear = true;
        case "*kick":
            if (status.print.run) {
                return evtlog("print in progress");
            }
            return kickNext();
        case "*abort": return abort();
        case "*pause": return pause();
        case "*resume": return resume();
        case "*clear":
            status.print.clear = true;
            return evtlog("bed marked clear");
        case "*monitor on":
            if (channel && !channel.monitoring) {
                channel.monitoring = true;
                evtlog("monitoring enabled");
            }
            return;
        case "*monitor off":
            if (channel && channel.monitoring) {
                evtlog("monitoring disabled");
                channel.monitoring = false;
            }
            return;
        case "*status":
            if (channel) {
                channel.request_status = true;
            }
            return evtlog(JSON.stringify(status), {status: true});
    }
    if (line.indexOf("*upload ") === 0) {
        if (channel.linebuf) {
            // accumulate all input data to linebuffer w/ no line breaks
            channel.linebuf.enabled = false;
            upload = line.substring(8);
            evtlog({upload});
        } else {
            evtlog({no_upload_possible: channel});
        }
    } else if (line.indexOf("*delete ") === 0) {
        fs.unlinkSync(filedir + "/" + line.substring(8));
        checkFileDir();
    } else if (line.indexOf("*kick ") === 0) {
        if (status.print.run) {
            return evtlog("print in progress");
        }
        kickNamed(filedir + "/" + line.substring(6));
    } else if (line.indexOf("*send ") === 0) {
        sendFile(line.substring(6));
    } else if (line.charAt(0) !== "*") {
        queuePriority(line, channel);
    } else {
        evtlog(`invalid command "${line.substring(1)}"`);
    }
};

function abort() {
    evtlog("execution aborted");
    sport.close(); // forces re-init of marlin
    onboot = [
        "M104 S0 T0",   // extruder 0 heat off
        "M140 S0 T0",   // bed heat off
        "M107",         // shut off cooling fan
        "G91",          // relative moves
        "G0 Z10",       // drop bed 1cm
        "G28 X Y",      // home X & Y
        "G90",          // restore absolute moves
        "M84"           // disable steppers
    ];
    return;
    // if (mode === 'grbl') {
    //     buf = [];
    // } else {
    //     buf = [];
    //     // match = [];
    //     // write('M108', {abort: true}); // cancel heating
    //     [
    //         "M104 S0 T0",   // extruder 0 heat off
    //         "M140 S0 T0",   // bed heat off
    //         "M107",         // shut off cooling fan
    //         "G91",          // relative moves
    //         "G0 Z10",       // drop bed 1cm
    //         "G28 X Y",      // home X & Y
    //         "G90",          // restore absolute moves
    //         "M84"           // disable steppers
    //     ].forEach((line, i) => {
    //         queue(line, {priority: i === 0});
    //     });
    // }
    // processQueue();
    // status.print.clear = false;
};

function pause() {
    if (paused) return;
    evtlog("execution paused");
    paused = true;
};

function resume() {
    if (!paused) return;
    evtlog("execution resumed");
    paused = false;
    processQueue();
};

function processQueue() {
    if (processing) {
        return;
    }
    processing = true;
    while (waiting < bufmax && buf.length && !paused) {
        let {line, flags} = buf.shift();
        status.buffer.queue = buf.length;
        write(line,flags);
    }
    if (buf.length === 0) {
        maxout = 0;
        if (status.print.run) {
            status.print.end = Date.now();
            status.print.run = false;
            status.print.progress = "100.00";
            evtlog("print done " + ((status.print.end - status.print.start) / 60000) + " min");
        }
    } else {
        if (status.print.run) {
            status.print.progress = ((1.0 - (buf.length / maxout)) * 100.0).toFixed(2);
        }
    }
    processing = false;
};

function queue(line, flags) {
    line = line.trim();
    if (line.length === 0) {
        return;
    }
    if (waiting < bufmax) {
        write(line, flags);
    } else {
        if (flags && flags.priority) {
            buf.splice(0, 0, {line, flags})
        } else {
            buf.push({line, flags});
        }
        status.buffer.queue = buf.length;
        maxout = Math.max(maxout, buf.length);
    }
};

function queuePriority(line, channel) {
    queue(line, {priority: true, channel});
}

function write(line, flags) {
    if (!line) {
        console.trace("missing line", line, flags);
        return;
    }
    if (line.indexOf("M2000") === 0) {
        pause();
        return;
    }
    let sci = line.indexOf(";");
    if (sci > 0) {
        line = line.substring(0, sci).trim();
    }
    flags = flags || {};
    switch (line.charAt(0)) {
        case ';':
            return;
        case '$': // grbl
        case '?': // grbl
        case '~': // grbl resume
        case 'M':
            // eat / report M117
            // if (line.indexOf('M117') === 0) {
            //     return evtlog(line.substring(5));
            // }
            if (line.indexOf('M117 Start') === 0) {
                flags.callback = () => {
                    status.print.prep = status.print.start;
                    status.print.start = Date.now();
                    evtlog("print starting");
                };
            }
        case 'G':
            match.push({line, flags});
            waiting++;
            status.buffer.waiting = waiting;
            break;
    }
    if (sport) {
        if (opt.debug) console.log("...> " + line);
        cmdlog("--> " + line, flags);
        sport.write(line + "\n");
    } else {
        console.log("*** serial port missing *** " + line);
    }
}

function checkFileDir() {
    if (!filedir) return;
    try {
        let valid = [];
        fs.readdirSync(filedir).forEach(name => {
            if (name.indexOf(".gcode") > 0 || name.indexOf(".nc") > 0) {
                name = filedir + "/" + name;
                let stat = fs.statSync(name);
                valid.push({name: name, size: stat.size, time: stat.mtimeMs});
            }
        });
        dircache = valid.sort((a, b) => {
            return b.time - a.time;
        });
        setTimeout(checkFileDir, 2000);
    } catch (e) {
        console.log(e);
    }
};

function kickNamed(name) {
    sendFile(name);
}

function kickNext() {
    if (!dircache.length) return evtlog("no valid files");
    sendFile(dircache[0].name);
};

function headers(req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", req.headers['origin'] || '*');
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Headers", "X-Moto-Ajax");
    next();
}

function drophandler(req, res, next) {
    const dropkey = "/api/drop?name=";
    if (req.url.indexOf(dropkey) === 0 && req.method === 'POST') {
        let name = req.url.substring(dropkey.length);
        let body = '';
        req.on('data', data => {
            body += data.toString();
        })
        req.on('end', () => {
            fs.writeFileSync(filedir + "/" + name, body);
            res.end("file received");
        })
    } else {
        next();
    }
}

// -- start it up --

if (opt.help) {
    console.log([
        "usage: serial [options]",
        "   --device=<dev>   : path to serial port device",
        "   --baud=<rate>    : baud rate for serial device",
        "   --listen=<port>  : port for command interface",
        "   --webport=<port> : port to listen for web connections",
        "   --webdir=<dir>   : directory to serve on <webport>",
        "   --filedir=<dir>  : directory to watch for gcode",
        "   --stdin          : enable stdin as command interface",
        "   --grbl           : enable grbl command mode"
    ].join("\n"));
    process.exit(0);
}

if (opt.grbl) {
    mode = 'grbl';
}

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

clients.push(process.stdout);
process.stdout.monitoring = true;

if (opt.stdin) {
    new LineBuffer(process.stdin);
    process.stdin.on("line", line => { processInput(line, process.stdout) });
    status.clients.stdin = 1;
}

if (opt.listen) {
    net.createServer(socket => {
        status.clients.net++;
        socket.linebuf = new LineBuffer(socket);
        socket.write("*ready\n");
        socket.on("line", line => { processInput(line, socket) });
        socket.on("close", () => {
            clients.splice(clients.indexOf(socket),1);
            status.clients.net--;
            // store upload, if available
            if (upload) {
                fs.writeFileSync(filedir + "/" + upload, socket.linebuf.buffer);
            }
        });
        clients.push(socket);
    }).listen(parseInt(opt.listen));
}

if (opt.webport) {
    const webdir = opt.webdir || "web";
    const webport = parseInt(opt.webport) || (opt.listen + 1) || 8000;
    const handler = connect()
        .use(headers)
        .use(drophandler)
        .use(serve(process.cwd() + "/" + webdir + "/"));
    const server = http.createServer(handler).listen(webport);
    const wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
        status.clients.ws++;
        ws
            .on('close', () => {
                clients.splice(clients.indexOf(ws),1);
                status.clients.ws--;
            })
            .on('error', (error) => {
                console.log({wss_error: error});
            })
            .on('message', (message) => {
                processInput(message, ws);
            });

        ws.send("*ready");
        ws.write = (data) => {
            try {
                ws.send(data);
            } catch (e) {
                // client will be removed above on 'close' event
            }
        };
        clients.push(ws);
    });
    console.log({ webport, webdir });
}

console.log({ port: port || 'undefined', baud, mode, maxbuf: bufmax, auto: auto_int });

openSerialPort();

checkFileDir();
