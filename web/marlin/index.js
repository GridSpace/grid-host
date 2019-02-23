let interval = null;
let timeout = null;
let queue = [];
let logs = [];
let ready = false;
let sock = null;
let last_jog = null;
let last_set = {};      // last settings object
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

function print_next() {
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
        interval = setInterval(() => {
            send('*status');
        }, 500);
    };
    sock.onclose = (evt) => {
        log({wss_close: true});
        clearInterval(interval);
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
        if (msg.indexOf("*** {") >= 0) {
            let status = JSON.parse(msg.substring(4,msg.length-4));
            last_set = status;
            if (status.print) {
                $('filename').value = status.print.filename;
                $('progress').value = status.print.progress + '%';
                if (status.print.clear) {
                    $('clear_bed').classList.remove('red_bg');
                } else {
                    $('clear_bed').classList.add('red_bg');
                }
            }
            if (status.target) {
                if (status.target.bed) {
                    $('bed').classList.add('red_bg');
                    $('bed').value = status.target.bed;
                    $('bed_temp').classList.add('red_bg');
                    $('bed_toggle').innerText = 'off';
                } else {
                    $('bed').classList.remove('red_bg');
                    $('bed_temp').classList.remove('red_bg');
                    $('bed_toggle').innerText = 'on';
                }
                if (status.temp.bed) {
                    $('bed_temp').value = parseInt(status.temp.bed);
                }
                if (status.target.ext[0]) {
                    $('nozzle').classList.add('red_bg');
                    $('nozzle').value = status.target.ext[0];
                    $('nozzle_temp').classList.add('red_bg');
                    $('nozzle_toggle').innerText = 'off';
                } else {
                    $('nozzle').classList.remove('red_bg');
                    $('nozzle_temp').classList.remove('red_bg');
                    $('nozzle_toggle').innerText = 'on';
                }
                if (status.temp.ext[0]) {
                    $('nozzle_temp').value = parseInt(status.temp.ext[0]);
                }
            }
            if (status.pos) {
                $('xpos').value = parseFloat(status.pos.X).toFixed(1);
                $('ypos').value = parseFloat(status.pos.Y).toFixed(1);
                $('zpos').value = parseFloat(status.pos.Z).toFixed(1);
                $('epos').value = parseFloat(status.pos.E).toFixed(1);
            }
            if (status.settings && status.settings.offset) {
                let off = status.settings.offset;
                $('xoff').value = parseFloat(off.X).toFixed(1);
                $('yoff').value = parseFloat(off.Y).toFixed(1);
                $('zoff').value = parseFloat(off.Z).toFixed(1);
            }
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
    $('go_zero').onclick = () => {
        send('G0X0Y0Z0');
    };
    $('off_set').onclick = () => {
        if (last_set && last_set.pos) {
            let pos = last_set.pos;
            send(`M206 X-${pos.X} Y-${pos.Y} Z-${pos.Z}`);
            send('M503');
        }
    };
    $('off_clear').onclick = () => {
        send('M206 X0 Y0 Z0');
        send('M503');
    };
}
