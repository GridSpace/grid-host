/**
 * process execution filter driver
 */

function execFilterChain(device, entry) {
    let filter = driver.api.filters[device.filter],
        proc, args;

    if (!filter) throw "missing filter for " + entry.target;

    entry.tmpFile = driver.api.Util.tempFileName();

    if (Array.isArray(filter)) {
        entry.filters = filter;
        execFilter(device, entry, 0);
    } else {
        entry.filters = [ filter ];
        execFilter(device, entry, 0);
    }
}

function execFilter(device, entry, index) {
    const filter = Object.assign({}, entry.filters[index]);
    const queue = driver.api.Queue;
    const log = driver.api.Util.log;

    if (filter.exec) {
        let img = '';
        let ext = filter.ext || '.gcode';
        let fname = filter.name || entry.name;
        let file = entry.tmpFile || driver.api.Util.tempFileName();

        // emit file with data and add to cleanup list
        fs.writeFileSync(file, entry.data);
        entry.files.push(file);

        // storge image, if present, and add to cleanup list
        if (entry.image) {
            img = driver.api.Util.tempFileName();
            fs.writeFileSync(img, entry.image.data);
            entry.files.push(img);
        }

        // add missing file name extension
        if (fname.indexOf(ext) < 0) {
            fname = fname + ext;
         }

        fname = fname.replace("{name}", entry.name);

        args = (filter.args || []).slice();
        args.forEach((val,idx) => {
            // replace any provided key/values from device
            for (let tkey in device) {
                val = val.replace("{" + tkey + "}", device[tkey]);
            }
            val = val.replace("{file}", file);
            val = val.replace("{print-time}", entry.estime);
            val = val.replace("{filament-used}", entry.fused);
            val = val.replace("{name}", fname);
            val = val.replace("{image}", img);
            args[idx] = val;
        });

        entry.time.exec = Date.now();
        entry.status = "exec " + filter.exec;
        queue.save();

        proc = spawn(filter.exec, args)
            .on('error', error => {
                log({exec_error: error});
                onExecDone(entry, error.toString());
            })
            .on('exit', code => {
                if (entry.error) {
                    log({exec_error_exit_code: code, error: entry.error});
                    return;
                }
                if (code) {
                    onExecDone(entry, `exit_code=${code}`);
                    return;
                }
                execFilter(device, entry, index + 1);
            });

        new linebuf(proc.stdout);
        new linebuf(proc.stderr);

        proc.stdout.on('line', line => { log({out: line.toString()}) });
        proc.stderr.on('line', line => { log({err: line.toString()}) });

        return;
    }

    onExecDone(entry);
}

function onExecDone(entry, error) {
    let promises = entry.promises;
    delete entry.promises;
    if (entry.error) {
        promises.reject(entry.status, entry);
    } else {
        promises.resolve(entry.status, entry);
    }
}

const fs = require('fs');
const spawn = require('child_process').spawn;
const png2bmp = require('../lib/image').png2bmp;

const driver = {
    name: "exec",

    init: (api) => {
        driver.api = api;
    },

    send: (device, entry) => {
        return new Promise((resolve, reject) => {
            entry.promises = {resolve, reject};

            if (entry.image && device.filter === 'gx') {
                png2bmp(Buffer.from(entry.image, "base64"))
                    .then(bmp => {
                        entry.image = bmp;
                        execFilterChain(device, entry);
                    })
                    .catch(error => {
                        reject(error);
                    });
            } else {
                execFilterChain(device, entry);
            }
        });
    }
};

module.exports = driver;
