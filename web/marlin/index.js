let timeout = null;
let queue = [];
let logs = [];
let ready = false;
let sock = null;
let last_update = 0;
let last_jog = null;
let jog_val = 0.0;

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
    console.log({msg});
}

function bed_toggle() {
    let toggle = $('bed_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M140 S' + bed_temp());
    } else {
        toggle.innerText = 'on';
        send('M140 S0');
    }
}

function bed_temp() {
    return parseInt($('bed').value || '0');
}

function bed_temp_lower() {
    $('bed').value = Math.max(0, bed_temp() - 5);
    send('M140 S' + bed_temp());
}

function bed_temp_higher() {
    $('bed').value = Math.min(100, bed_temp() + 5);
    send('M140 S' + bed_temp());
}

function nozzle_toggle() {
    let toggle = $('nozzle_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M104 S' + nozzle_temp());
    } else {
        toggle.innerText = 'on';
        send('M104 S0');
    }
}

function nozzle_temp() {
    return parseInt($('nozzle').value || '0');
}

function nozzle_temp_lower() {
    $('nozzle').value = Math.max(0, nozzle_temp() - 5);
    send('M104 S' + nozzle_temp());
}

function nozzle_temp_higher() {
    $('nozzle').value = Math.min(300, nozzle_temp() + 5);
    send('M104 S' + nozzle_temp());
}

function goto_home() {
    send('G28');
}

function disable_motors() {
    send('M18');
}

function clear_bed() {
    send('*clear');
    send('*status');
}

function kick_next() {
    send('*kick');
    send('*status');
}

function abort() {
    if (confirm('abort print job?')) {
        send('*abort');
        send('*status');
    }
}

function extrude(v) {
    gr(`E${v}`);
}

function retract(v) {
    gr(`E-${v}`);
}

function update() {
    let now = Date.now();
    if (now - last_update > 5000) {
        send('M105');
        last_update = now;
    }
}

function set_jog(val, el) {
    jog_val = val;
    if (last_jog) {
        last_jog.classList.remove('selected');
    }
    el.classList.add('selected');
    last_jog = el;
}

function jog(axis, dir) {
    gr(`${axis}${dir * jog_val}`);
}

function gr(msg) {
    send('G91');
    send(`G0 ${msg}`);
    send('G90');
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

function init() {
    // log({wss_init: true, ready});
    // sock = new WebSocket('ws://localhost:4080/ws');
    //sock = new WebSocket('ws://192.168.86.248:4080');
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
        if (msg.indexOf('ok T:') > 0) {
            msg = msg.split(' ');
            $('nozzle_temp').value = msg[3].substring(2);
            $('bed_temp').value = msg[5].substring(2);
            last_update = Date.now();
            send('*status');
        } else if (msg.indexOf('<-- T:') > 0) {
            msg = msg.split(' ');
            $('nozzle_temp').value = msg[2].substring(2);
            $('bed_temp').value = msg[4].substring(2);
            last_update = Date.now();
        } else if (msg.indexOf("*** {") >= 0) {
            let status = JSON.parse(msg.substring(4,msg.length-4));
            if (status.print) {
                $('filename').value = status.print.filename;
                $('progress').value = status.print.progress + '%';
            }
            if (status.target) {
                if (status.target.bed) {
                    $('bed').classList.add('heating');
                    $('bed').value = status.target.bed;
                    $('bed_toggle').innerText = 'off';
                } else {
                    $('bed').classList.remove('heating');
                    $('bed_toggle').innerText = 'on';
                }
                if (status.target.ext[0]) {
                    $('nozzle').classList.add('heating');
                    $('nozzle').value = status.target.ext[0];
                    $('nozzle_toggle').innerText = 'off';
                } else {
                    $('nozzle').classList.remove('heating');
                    $('nozzle_toggle').innerText = 'on';
                }
            }
            log(status);
        } else if (msg.indexOf("*** [") >= 0) {
            log(JSON.parse(msg.substring(4,msg.length-4)));
        } else if (msg.indexOf("***") >= 0) {
            try {
                log({wss_msg: msg});
            } catch (e) {
                log({wss_msg: evt, err: e});
            }
        }
    };
    $('bed').onkeyup = ev => {
        if (ev.keyCode === 13) {
            send('M140 S' + bed_temp());
            $('bed_toggle').innerText = 'off';
        }
    };
    $('nozzle').onkeyup = ev => {
        if (ev.keyCode === 13) {
            send('M104 S' + nozzle_temp());
            $('nozzle_toggle').innerText = 'off';
        }
    };
    setInterval(update, 5000);
}
