let istouch = 'ontouchstart' in document.documentElement;
let interval = null;
let timeout = null;
let queue = [];
let logs = [];
let ready = false;
let sock = null;
let last_jog = null;
let last_set = {};      // last settings object
let jog_val = 0.0;
let input = null;       // active input for keypad

function $(id) {
    return document.getElementById(id);
}

function log(msg) {
    console.log({msg});
}

function zpad(v) {
    return v < 10 ? `0${v}` : v;
}

function elapsed(millis) {
    let time = moment.duration(millis);
    return `${zpad(time.hours())}:${zpad(time.minutes())}:${zpad(time.seconds())}`;
}

function alert_on_run() {
    if (last_set.print.run) {
        alert("print in progress");
        return true;
    }
    return false;
}

function reload() {
    document.location = document.location;
}

function reboot() {
    if (confirm("reboot system?")) {
        send("*exec sudo reboot");
    }
}

function shutdown() {
    if (confirm("shutdown system?")) {
        send("*exec sudo halt -p");
    }
}

function print(file) {
    if (!last_set) {
        alert('not connected');
        return;
    }
    if (!last_set.print.clear) {
        alert('bed not cleared');
        return;
    }
    if (confirm(`start print "${file}"?`)) {
        send(`*kick ${file}`);
    }
}

function remove(file) {
    if (confirm(`delete "${file}"?`)) {
        send(`*delete ${file}`);
        setTimeout(() => {
            send('*list');
        }, 250);
    }
}

function off_set() {
    if (last_set && last_set.pos) {
        let pos = last_set.pos;
        send(`M206 X-${pos.X} Y-${pos.Y} Z-${pos.Z}`);
        send('M503');
    }
}

function off_clear() {
    send('M206 X0 Y0 Z0');
    send('M503');
}

function eeprom_save() {
    if (confirm('save eeprom settings')) {
        send('M500');
    }
}

function eeprom_restore() {
    if (confirm('restore eeprom settings')) {
        send('M501');
        send('M503');
    }
}

function bed_toggle() {
    let toggle = $('bed_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M140 S' + bed_temp());
        send('M105');
    } else {
        toggle.innerText = 'on';
        send('M140 S0');
        send('M105');
    }
}

function bed_temp() {
    return parseInt($('bed').value || '0');
}

function bed_temp_lower() {
    $('bed').value = Math.max(0, bed_temp() - 5);
    send('M140 S' + bed_temp());
    send('M105');
}

function bed_temp_higher() {
    $('bed').value = Math.min(100, bed_temp() + 5);
    send('M140 S' + bed_temp());
    send('M105');
}

function nozzle_toggle() {
    let toggle = $('nozzle_toggle');
    if (toggle.innerText === 'on') {
        toggle.innerText = 'off';
        send('M104 S' + nozzle_temp());
        send('M105');
    } else {
        toggle.innerText = 'on';
        send('M104 S0');
        send('M105');
    }
}

function nozzle_temp() {
    return parseInt($('nozzle').value || '0');
}

function nozzle_temp_lower() {
    $('nozzle').value = Math.max(0, nozzle_temp() - 5);
    send('M104 S' + nozzle_temp());
    send('M105');
}

function nozzle_temp_higher() {
    $('nozzle').value = Math.min(300, nozzle_temp() + 5);
    send('M104 S' + nozzle_temp());
    send('M105');
}

function filament_load() {
    if (alert_on_run()) return;
    send('G0 E700 F300');
}

function filament_unload() {
    if (alert_on_run()) return;
    send('G0 E-700 F300');
}

function goto_home() {
    if (alert_on_run()) return;
    send('G28');
}

function disable_motors() {
    if (alert_on_run()) return;
    send('M18');
}

function stop_motors() {
    if (alert_on_run()) return;
    send('M410');
}

function clear_bed() {
    if (alert_on_run()) return;
    send('*clear');
    send('*status');
}

function print_next() {
    send('*kick');
}

function firmware_update() {
    if (alert_on_run()) return;
    if (confirm("update firmware?")) {
        send('*update');
    }
}

function controller_update() {
    if (alert_on_run()) return;
    if (confirm("update controller?")) {
        send('*exit');
    }
}

function abort() {
    if (confirm('abort print job?')) {
        send('*abort');
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

function cleanName(rname) {
    if (!rname) {
        return rname;
    }
    let name = rname.substring(rname.lastIndexOf("/")+1);
    let doti = name.lastIndexOf('.');
    if (doti > 0) {
        name = name.substring(0,doti);
    }
    return name;
}

function init_filedrop() {
    var list = $("file-list");

    list.addEventListener("dragover", function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        list.classList.add("bg_red");
    });

    list.addEventListener("dragleave", function(evt) {
        list.classList.remove("bg_red");
    });

    list.addEventListener("drop", function(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        list.classList.remove("bg_red");

        var files = evt.dataTransfer.files;

        for (var i=0; i<files.length; i++) {
            var file = files[i];
            var read = new FileReader();
            read.onloadend = function(e) {
                fetch("/api/drop?name=" + encodeURIComponent(file.name), {
                    method: "post",
                    body: e.target.result
                }).then(reply => {
                    return reply.text();
                }).then(text => {
                    console.log({text});
                    setTimeout(() => {
                        send('*list');
                    }, 250);
                });
            };
            read.readAsBinaryString(file);
        }
    });
}

function init() {
    timeout = null;
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
        send('*list');
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
                $('filename').value = cleanName(status.print.filename);
                $('progress').value = status.print.progress + '%';
                if (status.print.clear) {
                    $('clear_bed').classList.remove('bg_red');
                } else {
                    $('clear_bed').classList.add('bg_red');
                }
                if (status.print.run) {
                    $('progress').classList.add('bg_red');
                    $('elapsed').classList.add('bg_red');
                } else {
                    $('progress').classList.remove('bg_red');
                    $('elapsed').classList.remove('bg_red');
                }
                let duration = 0;
                if (status.print.end && status.print.end > status.print.start) {
                    duration = status.print.end - status.print.start;
                } else if (status.print.prep || status.print.start) {
                    duration = (status.print.mark || Date.now()) - status.print.start;
                }
                $('elapsed').value = elapsed(duration);
            }
            if (status.target) {
                if (status.target.bed > 0) {
                    if ($('bed') !== input) {
                        $('bed').value = status.target.bed;
                        // $('bed').classList.add('bg_red');
                    }
                    $('bed_temp').classList.add('bg_red');
                    $('bed_toggle').innerText = 'off';
                } else {
                    if ($('bed') !== input) {
                        $('bed').value = 0;
                    }
                    // $('bed').classList.remove('bg_red');
                    $('bed_temp').classList.remove('bg_red');
                    $('bed_toggle').innerText = 'on';
                }
                $('bed_temp').value = parseInt(status.temp.bed || 0);
                if (status.target.ext[0] > 0) {
                    if ($('nozzle') !== input) {
                        $('nozzle').value = status.target.ext[0];
                        // $('nozzle').classList.add('bg_red');
                    }
                    $('nozzle_temp').classList.add('bg_red');
                    $('nozzle_toggle').innerText = 'off';
                } else {
                    if ($('nozzle') !== input) {
                        $('nozzle').value = 0;
                    }
                    // $('nozzle').classList.remove('bg_red');
                    $('nozzle_temp').classList.remove('bg_red');
                    $('nozzle_toggle').innerText = 'on';
                }
                $('nozzle_temp').value = parseInt(status.temp.ext[0] || 0);
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
            let list = $('file-list');
            let html = [];
            JSON.parse(msg.substring(4,msg.length-4)).forEach(file => {
                let name = cleanName(file.name);
                html.push(`<div class="row"><label ondblclick="print('${name}')">${name}</label><button onclick="remove('${name}')">x</button></div>`);
            });
            list.innerHTML = html.join('');
        } else if (msg.indexOf("***") >= 0) {
            try {
                log({wss_msg: msg});
            } catch (e) {
                log({wss_msg: evt, err: e});
            }
        }
    };
    let setbed = $('bed').onkeyup = ev => {
        if (ev === 42 || ev.keyCode === 13) {
            send('M140 S' + bed_temp());
            send('M105');
            $('bed_toggle').innerText = 'off';
            input_deselect();
        }
    };
    let setnozzle = $('nozzle').onkeyup = ev => {
        if (ev === 42 || ev.keyCode === 13) {
            send('M104 S' + nozzle_temp());
            send('M105');
            $('nozzle_toggle').innerText = 'off';
            input_deselect();
        }
    };
    $('go_zero').onclick = () => {
        send('G0X0Y0Z0');
    };
    $('send').onkeyup = ev => {
        if (ev.keyCode === 13) {
            send($('send').value.trim());
            $('send').value = '';
        }
    };
    let input_deselect = document.body.onclick = (ev) => {
        if (input) {
            input.classList.remove('bg_green');
            input = null;
        }
        $('keypad').style.display = 'none';
    };
    $('nozzle').onclick = (ev) => {
        input_deselect();
        if (istouch) {
            $('keypad').style.display = '';
        }
        input = $('nozzle');
        input.classList.add('bg_green');
        ev.stopPropagation();
    };
    $('bed').onclick = (ev) => {
        input_deselect();
        if (istouch) {
            $('keypad').style.display = '';
        }
        input = $('bed');
        input.classList.add('bg_green');
        ev.stopPropagation();
    };
    for (let i=0; i<10; i++) {
        $(`kp-${i}`).onclick = (ev) => {
            if (input) {
                input.value += i;
                ev.stopPropagation();
            }
        };
    }
    $('kp-bs').onclick = (ev) => {
        if (input) {
            input.value = input.value.substring(0,input.value.length-1);
            ev.stopPropagation();
        }
    };
    $('kp-ok').onclick = (ev) => {
        if (input === $('bed')) {
            setbed(42);
        }
        if (input === $('nozzle')) {
            setnozzle(42);
        }
        ev.stopPropagation();
    };
    // disable autocomplete
    let inputs = document.getElementsByTagName('input');
    for (let i=0; i<inputs.length; i++) {
        inputs[i].setAttribute('autocomplete', Date.now().toString(36));
    }
    // provide top scroll action
    $('scrolltop').onclick = (ev) => {
        document.body.scrollTop = 0;
    };
    init_filedrop();
    input_deselect();
}
