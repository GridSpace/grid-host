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
    send('M500');
}

function eeprom_restore() {
    send('M501');
    send('M503');
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
                $('filename').value = status.print.filename;
                $('progress').value = status.print.progress + '%';
                if (status.print.clear) {
                    $('clear_bed').classList.remove('bg_red');
                } else {
                    $('clear_bed').classList.add('bg_red');
                }
            }
            if (status.target) {
                if (status.target.bed > 0) {
                    if ($('bed') !== input) {
                        $('bed').value = status.target.bed;
                        $('bed').classList.add('bg_red');
                    }
                    $('bed_temp').classList.add('bg_red');
                    $('bed_toggle').innerText = 'off';
                } else {
                    if ($('bed') !== input) {
                        $('bed').value = 0;
                    }
                    $('bed').classList.remove('bg_red');
                    $('bed_temp').classList.remove('bg_red');
                    $('bed_toggle').innerText = 'on';
                }
                $('bed_temp').value = parseInt(status.temp.bed || 0);
                if (status.target.ext[0] > 0) {
                    if ($('nozzle') !== input) {
                        $('nozzle').value = status.target.ext[0];
                        $('nozzle').classList.add('bg_red');
                    }
                    $('nozzle_temp').classList.add('bg_red');
                    $('nozzle_toggle').innerText = 'off';
                } else {
                    if ($('nozzle') !== input) {
                        $('nozzle').value = 0;
                    }
                    $('nozzle').classList.remove('bg_red');
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
                let name = file.name.substring(file.name.lastIndexOf("/")+1);
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
        $('keypad').style.display = '';
        input = $('nozzle');
        input.classList.add('bg_green');
        ev.stopPropagation();
    };
    $('bed').onclick = (ev) => {
        input_deselect();
        $('keypad').style.display = '';
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
