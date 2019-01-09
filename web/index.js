function $(id) {
    return document.getElementById(id);
}

function targets(t) {
    let html = [
        '<table><thead><tr>',
        '<th>target</th>',
        '<th>info</th>',
        '<th>filter</th>',
        '</tr></thead><tbody>'
    ];
    for (let k in t) {
        if (t.hasOwnProperty(k)) {
            let v = t[k];
            html.push('<tr><th>');
            html.push(k);
            html.push('</th><td>');
            html.push(v.comment || '');
            html.push('</td><td>');
            html.push(v.filter || '');
            html.push('</td></tr>');
        }
    }
    html.push('</tbody></table>');
    $('targets').innerHTML = html.join('');
}

function init() {
    fetch("/api/targets")
        .then(r => r.json())
        .then(t => targets(t));
}
