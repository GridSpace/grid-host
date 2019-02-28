let lastT = {};
let lastQ = [];

function $(id) {
    return document.getElementById(id);
}

function browse(url) {
    window.open(url, "_web_control_");
}

function targets(t) {
    let changed = false;
    let html = [
        '<table><thead><tr>',
        cell('th', div('target')),
        cell('th', div('info')),
        cell('th', div('status')),
        cell('th', div('%')),
        cell('th', div('nozzle 0')),
        cell('th', div('nozzle 1')),
        cell('th', div('bed')),
        cell('th', div('action')),
        '</tr></thead><tbody>'
    ];
    for (let k in t) {
        // new target
        if (!lastT.hasOwnProperty(k)) {
            changed = true;
        }
    }
    for (let k in lastT) {
        // dropped target
        if (!t.hasOwnProperty(k)) {
            changed = true;
        }
    }
    lastT = Object.assign({}, t);
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let stat = v.status;
            let devid = `device-${k}`;
            html.push(`<tr id="${devid}">`);
            html.push(cell('th', k, {
                onclick: `browse('${v.web}')`
            }));
            html.push(cell('td', v.comment || ''));
            if (stat) {
                html.push(cell(`td id="${devid}-st"`, ''));
                html.push(cell(`td id="${devid}-pr"`, ''));
                html.push(cell(`td id="${devid}-t0"`, ''));
                html.push(cell(`td id="${devid}-t1"`, ''));
                html.push(cell(`td id="${devid}-b"`, ''));
                html.push(cell('td', 'cancel', {onclick: `print_cancel('${k}')`}));
            }
            html.push('</tr>');
        }
    }
    html.push('</tbody></table>');
    if (changed) {
        $('targets').innerHTML = html.join('');
    }
    // update fields
    for (let k in t) {
        let v = t[k];
        let stat = v.status;
        let devid = `device-${k}`;
        $(`${devid}-st`).innerText = stat.state || '-';
        $(`${devid}-pr`).innerText = stat.progress || 0;
        $(`${devid}-t0`).innerText = stat.temps ? stat.temps.T0.join(' / ') : '';
        $(`${devid}-t1`).innerText = stat.temps ? stat.temps.T1.join(' / ') : '';
        $(`${devid}-b`).innerText = stat.temps ? stat.temps.B.join(' / ') : '';
    }
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let d = $(`device-${k}`);
            let time = Date.now().toString(36);
            d.onmouseover = () => {
                document.documentElement.style.setProperty('--image-url', `url("${v.image || ""}?${time}")`);
                $('gcode').style.display = 'none';
            };
            d.onmouseout = () => {
                document.documentElement.style.setProperty('--image-url', `url("data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=")`);
                $('gcode').style.display = 'none';
            };
        }
    }
}

function div(text) {
    return ['<div>',text,'</div>'].join('');
}

function cell(type, text, opt) {
    if (opt) {
        let os = [type];
        for (let k in opt) {
            os.push(`${k}="${opt[k]}"`);
        }
        type = os.join(' ');
    }
    return ['<', type, '>', text, '</', type, '>'].join('');
}

function from_tag(v) {
    let ktag = `tag-${v}`;
    let otag = localStorage[ktag]
    let ntag = prompt(`rename "${v}"`, otag || v);
    if (ntag === '') {
        delete localStorage[ktag];
    } else if (ntag !== null) {
        localStorage[ktag] = ntag;
    }
    console.log({from_tag: v || "ok", ktag, otag, ntag, lastQ});
    queue(lastQ);
}

function print_cancel(target) {
    if (confirm(`cancel print on "${target}?"`)) {
        fetch(`/api/print.cancel?target=${target}`)
            .then(r => r.json())
            .then(c => {
                console.log({cancel: c});
            });
    }
}

function queue_del(time) {
    if (!confirm('delete entry?')) {
        return;
    }
    fetch(`/api/queue.del?time=${time}`)
        .then(r => r.json())
        .then(q => queue(q));
}

function queue(q) {
    let changed = false;
    if (q.length === lastQ.length) {
        for (let i=0; i<q.length; i++) {
            if (q[i].key !== lastQ[i].key) {
                changed = true;
                break;
            }
        }
    } else {
        changed = true;
    }
    lastQ = q.slice();
    if (!changed) {
        return;
    }
    let html = [
        '<table><thead><tr>',
        cell('th', div('date')),
        cell('th', div('to')),
        cell('th', div('from')),
        cell('th', div('file')),
        cell('th', div('size')),
        cell('th', div('status')),
        '</tr></thead><tbody>'
    ];
    let lastday = null;
    q.reverse().forEach(el => {
        let target = el.target.comment || el.target.key || el.target;
        let tag = localStorage[`tag-${el.from}`] || el.from;
        let time = el.time.add || 0;
        let day = moment(time).format('dddd YYYY-MM-DD');
        if (day !== lastday) {
            html.push(`<tr>`);
            html.push(cell('th', "--- " + day + " ---", {colspan: 6, class: "daypart"}));
            html.push('</tr>');
        }
        lastday = day;
        html.push(`<tr id="q-${el.key}">`);
        html.push(cell('td', moment(time).format('HH:mm:ss'), { onclick:`queue_del(${time})` } ));
        html.push(cell('td', target));
        html.push(cell('td', tag, { onclick:`from_tag('${el.from}')` } ));
        html.push(cell('td', el.name));
        html.push(cell('td', el.size || ''));
        html.push(cell('td', el.status, {id: `q-${el.key}-kick`, onclick: ""}));
        html.push('</tr>');
    });
    html.push('</tbody></table>');
    $('queue').innerHTML = html.join('');
    q.forEach(el => {
        $(`q-${el.key}-kick`).onclick = () => {
            if (confirm(`resend file ${el.name} to ${el.target}`)) {
                console.log({rekick: el.key});
                fetch(`/api/resend?key=${el.key}`).then(v => console.log({kicked: v}));
            }
        };
        let d = $(`q-${el.key}`);
        d.onmouseover = () => {
            if (el.image_file) {
                document.documentElement.style.setProperty('--image-url', `url("${el.image_file}")`);
            } else {
                document.documentElement.style.setProperty('--image-url', `url("data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=")`);
            }
            fetch(`/api/head?key=${el.key}`)
                .then(v => v.json())
                .then(h => {
                    if (h && h.length) {
                        $('gcode').style.display = 'flex';
                        $('gcode').innerText = h.join("\n");
                    } else {
                        $('gcode').style.display = 'flex';
                        $('gcode').innerText = '';
                    }
                });
        };
    });
}

function updateTargets(force) {
    if (!force && localStorage.stop === 'true') {
        return;
    }
    fetch("/api/targets")
        .then(r => r.json())
        .then(t => targets(t));
}

function updateQueue(force) {
    if (!force && localStorage.stop === 'true') {
        return;
    }
    fetch("/api/queue")
        .then(r => r.json())
        .then(q => queue(q));
}

function init() {
    setInterval(updateTargets, 1000);
    setInterval(updateQueue, 5000);

    updateTargets(true);
    updateQueue(true);
}
