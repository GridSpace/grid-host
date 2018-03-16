var STATES = [
    "request not initialized",        // 0
    "server connection established",  // 1
    "request recieved",               // 2
    "processing request",             // 3
    "request complete"                // 4
];

function Ajax(callback) {
    this.ajax = new XMLHttpRequest();
    this.ajax.onreadystatechange = this.onStateChange.bind(this);
    this.ajax.withCredentials = true;
    this.state = STATES[0];
    this.callback = callback;
}

var AP = Ajax.prototype;

AP.onStateChange = function() {
    this.state = STATES[this.ajax.readyState];
    if (this.ajax.readyState === 4 && this.callback) {
        var status = this.ajax.status;
        if (status >= 200 && status < 300) {
            this.callback(this.ajax.responseType ? this.ajax.response : this.ajax.responseText, this.ajax);
        } else {
            this.callback(null, this.ajax);
        }
    }
};

AP.request = function(opt) {
    if (!opt) {
        throw "missing options or url";
    }
    switch (typeof(opt)) {
        case 'string':
            opt = { url: opt };
            break;
        case 'object':
            break;
        default:
            throw "invalid options";
    }
    this.ajax.open(opt.post ? "POST" : "GET", opt.url, true);
    if (opt.type) {
        this.ajax.responseType = opt.type;
    }
    if (opt.headers) {
        for (var key in opt.headers) {
            this.ajax.setRequestHeader(key, opt.headers[key]);
        }
    }
    this.ajax.send(opt.post || undefined);
};

function ajax(options, callback) {
    new Ajax(callback).request(options);
}

function init() {
    ajax({
        url: "/api/targets",
        type: "json"
    }, function(data) {
        console.log({targets: data});
    });
}
