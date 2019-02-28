let lastT = null;
let lastQ = null;

function $(id) {
    return document.getElementById(id);
}

function browse(url) {
    window.open(url, "_web_control_");
}

function targets(t) {
    lastT = Object.assign({}, t);
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
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let stat = v.status;
            html.push(`<tr id="device-${k}">`);
            html.push(cell('th', k, {
                onclick: `browse('${v.web}')`
            }));
            html.push(cell('td', v.comment || ''));
            if (stat) {
                html.push(cell('td', stat.state || '-'));
                html.push(cell('td', `${stat.progress || 0}%`));
                if (stat.temps && stat.temps.T0) {
                    html.push(cell('td', stat.temps.T0.join(' / ')));
                } else {
                    html.push(cell('td', '-'));
                }
                if (stat.temps && stat.temps.T1) {
                    html.push(cell('td', stat.temps.T1.join(' / ')));
                } else {
                    html.push(cell('td', '-'));
                }
                if (stat.temps && stat.temps.B) {
                    html.push(cell('td', stat.temps.B.join(' / ')));
                } else {
                    html.push(cell('td', '-'));
                }
                html.push(cell('td', 'cancel', {onclick: `print_cancel('${k}')`}));
            }
            html.push('</tr>');
        }
    }
    html.push('</tbody></table>');
    $('targets').innerHTML = html.join('');
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let d = $(`device-${k}`);
            let time = Date.now().toString(36);
            d.onmouseover = () => {
                $('image').src = `${v.image || ""}?${time}`;
            };
            d.onmouseout = () => {
                $('image').src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
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
            $('preview').src = el.image_file;
        };
        d.onmouseout = () => {
            d.onmouseout = () => {
                $('preview').src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
            };
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
