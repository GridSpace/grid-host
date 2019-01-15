let lastT = null;
let lastQ = null;

function $(id) {
    return document.getElementById(id);
}

function targets(t) {
    lastT = Object.assign({}, t);
    let html = [
        '<table><thead><tr>',
        cell('th', 'target'),
        cell('th', 'info'),
        cell('th', 'filter'),
        '</tr></thead><tbody>'
    ];
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            html.push('<tr>');
            html.push(cell('th', k));
            html.push(cell('td', v.comment || ''));
            html.push(cell('td', v.filter || ''));
            html.push('</tr>');
        }
    }
    html.push('</tbody></table>');
    $('targets').innerHTML = html.join('');
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

function queue(q) {
    lastQ = q.slice();
    let html = [
        '<table><thead><tr>',
        cell('th', 'date'),
        cell('th', 'to'),
        cell('th', 'from'),
        cell('th', 'file'),
        cell('th', 'size'),
        cell('th', 'status'),
        '</tr></thead><tbody>'
    ];
    q.reverse().forEach(el => {
        let target = el.target.comment || el.target;
        let tag = localStorage[`tag-${el.from}`] || el.from;
        html.push('<tr>');
        html.push(cell('td', moment((el.time || {}).add || 0).format('YYYY-MM-DD HH:MM:ss ddd')));
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
