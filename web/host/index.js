let lastT = null;
let lastQ = null;

function $(id) {
    return document.getElementById(id);
}

function targets(t) {
    lastT = Object.assign({}, t);
    let html = [
        '<table><thead><tr>',
        cell('th', div('target')),
        cell('th', div('info')),
        cell('th', div('status')),
        cell('th', div('file')),
        cell('th', div('nozzle')),
        cell('th', div('bed')),
        cell('th', div('action')),
        '</tr></thead><tbody>'
    ];
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            let stat = v.status;
            html.push('<tr>');
            html.push(cell('th', k));
            html.push(cell('td', v.comment || ''));
            if (stat) {
                let pct = stat.print.split(' ');
                pct = pct[pct.length-1].split('/').map(v => parseFloat(v));
                pct = ((pct[0]/pct[1]) * 100).toFixed(1);
                html.push(cell('td', stat.status.MachineStatus));
                html.push(cell('td', `${pct}%`));
                html.push(cell('td', stat.temps.T0.join(' / ')));
                html.push(cell('td', stat.temps.B.join(' / ')));
                html.push(cell('td', 'cancel', {onclick: `print_cancel('${k}')`}));
            }
            html.push('</tr>');
        }
    }
    html.push('</tbody></table>');
    $('targets').innerHTML = html.join('');
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
    q.reverse().forEach(el => {
        let target = el.target.comment || el.target.key || el.target;
        let tag = localStorage[`tag-${el.from}`] || el.from;
        let time = el.time || {};
        html.push('<tr>');
        html.push(cell('td', moment(time.add || 0).format('YYYY-MM-DD HH:MM:ss ddd'), { onclick:`queue_del(${time.add})` } ));
        html.push(cell('td', target));
        html.push(cell('td', tag, { onclick:`from_tag('${el.from}')` } ));
        html.push(cell('td', el.name));
        html.push(cell('td', el.size || ''));
        html.push(cell('td', el.status));
        html.push('</tr>');
    });
    html.push('</tbody></table>');
    $('queue').innerHTML = html.join('');
}

function init() {
    fetch("/api/targets")
        .then(r => r.json())
        .then(t => targets(t));
    fetch("/api/queue")
        .then(r => r.json())
        .then(q => queue(q));
}
