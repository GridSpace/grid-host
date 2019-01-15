let timeout = null;
let queue = [];
let logs = [];
let ready = false;
let sock = null;
let jog_val = 0.0;
let last_update = 0;
let last_jog = null;
let status = {
    wco: {x:0, y:0, z:0}
};

function reload() {
    document.location = document.location;
}

function reboot() {
    if (confirm("reboot controller?")) {
        send("*exec sudo reboot");
    }
}

function shutdown() {
    if (confirm("shutdown controller?")) {
        send("*exec sudo halt");
    }
}

function $(id) {
    return document.getElementById(id);
}

function log(msg) {
    console.log(msg);
}

function clear_bed() {
    send('*clear');
}

function kick_next() {
    send('*kick');
}

function abort() {
    send('*abort');
}

function set_home() {
    if (confirm("set current position to home?")) {
        send('G92 X0Y0Z0');
    }
}

function goto_home() {
    if (confirm("go to home position?")) {
        send('G0 X0Y0Z0');
    }
}

function update() {
    let now = Date.now();
    if (now - last_update >= 400) {
        send('?');
        last_update = now;
    }
}

function grbl_hold() {
    send('!');
}

function grbl_resume() {
    send('~', true);
    send('?', true);
}

function grbl_reset() {
    send(String.fromCharCode(0x18));
}

function set_jog(val,el) {
    jog_val = val;
    if (last_jog) {
        last_jog.classList.remove('selected');
    }
    el.classList.add('selected');
    last_jog = el;
}

function jog(axis, dir) {
    send(`$J=G91 F300 ${axis}${dir * jog_val}`);
}

function send(message, force) {
    if (ready) {
        if (!force && status.hold && (message.length > 1 || message === '?')) {
            //console.log(`skip sending "${message}" during hold`);
            return;
        }
        // log({send: message});
        sock.send(message);
    } else {
        // log({queue: message});
        queue.push(message);
    }
}

function pos(msg, str) {
    let off = msg.indexOf(str);
    return off >= 0 ? msg.substring(off + str.length) : null;
}

function init() {
    sock = new WebSocket(`ws://${document.location.hostname}:4080`);
    sock.onopen = (evt) => {
        if (ready) {
            return;
        }
        // log({wss_open: true});
        ready = true;
        while (queue.length) {
            send(queue.shift());
        }
        update();
    };
    sock.onclose = (evt) => {
        log({wss_close: true});
        if (timeout != null) {
            return;
        }
        sock = null;
        ready = false;
        timeout = setTimeout(init, 1000);
    };
    sock.onerror = (evt) => {
        log({wss_error: true});
        if (timeout != null) {
            return;
        }
        sock = null;
        ready = false;
        timeout = setTimeout(init, 1000);
    };
    sock.onmessage = (evt) => {
        let msg = unescape(evt.data);
        let match;
        // drop echo of send or oks
        if (pos(msg, '--> ') || pos(msg, '<-- ok')) {
            return;
        }
        if (match = pos(msg, '<-- [GC:')) {
            match = match.substring(0, match.lastIndexOf(']'));
            console.log({gc: match});
        } else if (match = pos(msg, '<-- <')) {
            match = match.substring(0, match.lastIndexOf('>')).split('|');
            // console.log({status: match.join(', ')});
            status.state = match.shift();
            status.hold = status.state.indexOf('Hold') === 0;
            $('status').value = status.state;
            match.reverse().forEach(tok => {
                tok = tok.split(':');
                let key = tok[0];
                let val = tok[1];
                let pos = false;
                switch (key) {
                    case 'WCO':
                        val = val.split(',').map(v => parseFloat(v));
                        status.wco = {
                            x: val[0],
                            y: val[1],
                            z: val[2]
                        };
                        break;
                    case 'WPos':
                        pos = true;
                        val = val.split(',').map(v => parseFloat(v));
                        status.pos = {
                            x: val[0] + status.wco.x,
                            y: val[1] + status.wco.y,
                            z: val[2] + status.wco.z
                        };
                        break;
                    case 'MPos':
                        pos = true;
                        val = val.split(',').map(v => parseFloat(v));
                        status.pos = {
                            x: val[0] - status.wco.x,
                            y: val[1] - status.wco.y,
                            z: val[2] - status.wco.z
                        };
                        break;
                }
                if (pos) {
                    $('xpos').value = status.pos.x;
                    $('ypos').value = status.pos.y;
                    $('zpos').value = status.pos.z;
                }
            });
        } else if (match = pos(msg, '<-- Grbl')) {
            status.hold = false;
            status.state = 'init';
            $('status').value = status.state;
        } else if (match = pos(msg, '<-- error:')) {
            console.log({error: match});
        } else if (msg.indexOf("*** {") >= 0) {
            let status = JSON.parse(msg.substring(4,msg.length-4));
            if (status.print) {
                $('filename').value = status.print.filename;
                $('progress').value = status.print.progress + '%';
            }
            log(status);
        } else if (msg.indexOf("*** [") >= 0) {
            log(JSON.parse(msg.substring(4,msg.length-4)));
        // } else if (msg.indexOf("***") >= 0) {
        } else {
            try {
                log({wss_msg: msg});
            } catch (e) {
                log({wss_msg: evt, err: e});
            }
        }
    };
    setInterval(update, 500);
}
