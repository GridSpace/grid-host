let lastT = {};
let lastQ = [];

String.prototype.hashCode = function(){
    var hash = 0;
    for (var i = 0; i < this.length; i++) {
        var character = this.charCodeAt(i);
        hash = ((hash<<5)-hash)+character;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

function $(id) {
    return document.getElementById(id);
}

function browse(url) {
    window.open(url, "_web_control_");
}

function enable(t) {
    fetch(`/api/enable?target=${t}`)
        .then(r => r.json())
        .then(c => {
            console.log({enable: c, t});
        });
}

function disable(t) {
    fetch(`/api/disable?target=${t}`)
        .then(r => r.json())
        .then(c => {
            console.log({enable: c, t});
        });
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
            let devid = `device-${k.hashCode()}`;
            html.push(`<tr id="${devid}">`);
            html.push(cell('th', k, {
                onclick: v.web ? `browse('${v.web}')` : null
            }));
            html.push(cell('td', v.comment || ''));
            if (stat) {
                html.push(cell(`td id="${devid}-st"`, ''));
                html.push(cell(`td id="${devid}-pr"`, ''));
                html.push(cell(`td id="${devid}-t0"`, ''));
                html.push(cell(`td id="${devid}-t1"`, ''));
                html.push(cell(`td id="${devid}-b"`, ''));
                html.push(cell('td class="actions"',
                    cell(`a id=${devid}-da`, 'enable',  {onclick: `enable('${k}')`}  ) +
                    cell(`a id=${devid}-en`, 'disable', {onclick: `disable('${k}')`} ) +
                    cell(`a`, 'cancel', {onclick: `print_cancel('${k}')`} )
                ));
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
        let devid = `device-${k.hashCode()}`;
        $(`${devid}-st`).innerText = stat.state || '-';
        $(`${devid}-pr`).innerText = stat.progress || 0;
        $(`${devid}-t0`).innerText = stat.temps && stat.temps.T0 ?
            stat.temps.T0.map(v => parseInt(v)).join(' / ') : '';
        $(`${devid}-t1`).innerText = stat.temps && stat.temps.T1 ?
            stat.temps.T1.map(v => parseInt(v)).join(' / ') : '';
        $(`${devid}-b`).innerText = stat.temps && stat.temps.B ?
            stat.temps.B.map(v => parseInt(v)).join(' / ') : '';
        if (v.disabled) {
            $(`${devid}-da`).style.display = '';
            $(`${devid}-en`).style.display = 'none';
            $(`${devid}`).classList.add('disabled');
        } else {
            $(`${devid}-da`).style.display = 'none';
            $(`${devid}-en`).style.display = '';
            $(`${devid}`).classList.remove('disabled');
        }
    }
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let d = $(`device-${k.hashCode()}`);
            let time = Date.now().toString(36);
            d.onmouseover = () => {
                d._hover = true;
                setTimeout(() => {
                    if (d._hover === true) {
                        updateImage(v.image, true);
                        $('gcode').style.display = 'none';
                    }
                }, 200);
            };
            d.onmouseout = () => {
                d._hover = false;
                updateImage();
                $('gcode').style.display = 'none';
            };
        }
    }
}

let icache = {};
let fetching = [];
let clearimage = null;
let fetchloop = null;

function updateImage(url, refresh) {
    clearTimeout(clearimage);
    clearTimeout(fetchloop);
    if (url === null || url === undefined) {
        clearimage = setTimeout(() => {
            if (fetching.length === 0) {
                document.documentElement.style.setProperty('--image-url', `url("data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=")`);
            }
        }, 500);
        return;
    }
    let t = refresh ? (Date.now()/2000).toString(36) : 123;
    let u = `${url}?${t}`;
    let i = icache[u] || new Image();
    let cache_new = false;
    if (!refresh && !icache[u]) {
        icache[u] = i;
        cache_new = true;
    }
    let cb = () => {
        let p = fetching.indexOf(u);
        if (p === fetching.length - 1) {
            document.documentElement.style.setProperty('--image-url', `url("${u}`);
            if (refresh) {
                fetchloop = setTimeout(() => {
                    updateImage(url, true);
                }, 1000);
            }
        }
        fetching.splice(p, 1);
    };
    if (cache_new || refresh) {
        fetching.push(u);
        i.onload = cb;
        i.src = u;
    } else {
        document.documentElement.style.setProperty('--image-url', `url("${u}`);
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
        html.push(cell('td', el.size || '', {id: `q-${el.key}-size`} ));
        html.push(cell('td', el.status, {id: `q-${el.key}-kick`, onclick: ""}));
        html.push('</tr>');
    });
    html.push('</tbody></table>');
    if (!changed) {
        // update status without table redraw
        q.reverse().forEach(el => {
            try {
                $(`q-${el.key}-size`).innerText = el.size;
                $(`q-${el.key}-kick`).innerText = el.status;
            } catch (e) { }
        });
        return;
    }
    $('queue').innerHTML = html.join('');
    q.forEach(el => {
        $(`q-${el.key}-kick`).onclick = () => {
            if (confirm(`resend file ${el.name} to ${el.target}`)) {
                console.log({rekick: el.key});
                fetch(`/api/resend?key=${el.key}&time=${Date.now()}`).then(v => console.log({kicked: v}));
            }
        };
        let d = $(`q-${el.key}`);
        d.onmouseover = () => {
            if (el.image_file) {
                updateImage(el.image_file);
            } else {
                updateImage();
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
