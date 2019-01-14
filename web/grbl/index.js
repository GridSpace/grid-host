let timeout = null;
let queue = [];
let logs = [];
let ready = false;
let sock = null;
let last_update = 0;

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

function disable_motors() {
    send('M18');
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

function update() {
    let now = Date.now();
    if (now - last_update > 1000) {
        send('?');
        last_update = now;
    }
}

function grbl_hold() {
    send('!');
}

function grbl_resume() {
    send('~');
}

function grbl_reset() {
    send(String.fromCharCode(0x18));
}

function jog(msg) {
    send(`$J=G91 F300 ${msg}`);
}

function send(message) {
    if (ready) {
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
        // if (pos(msg, '--> ') || pos(msg, '<-- ok')) {
        //     return;
        // }
        if (match = pos(msg, '<-- [GC:')) {
            match = match.substring(0, match.lastIndexOf(']'));
            console.log({gc: match});
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
    //setInterval(update, 5000);
}
