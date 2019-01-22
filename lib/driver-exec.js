/**
 * process execution filter driver
 */

function tempFileName() {
    return tempDir + "/" + (new Date().getTime().toString(36)) + "-" + (tempIndex++) + ".tmp";
}

function execFilterChain(target, entry) {
    let filter = driver.api.filters[target.filter],
        proc, args;

    if (!filter) throw "missing filter for " + entry.target;

    entry.tmpFile = tempFileName();

    if (Array.isArray(filter)) {
        entry.filters = filter;
        execFilter(target, entry, 0);
    } else {
        entry.filters = [ filter ];
        execFilter(target, entry, 0);
    }
}

function execFilter(target, entry, index) {
    const filter = Object.assign({}, entry.filters[index]);
    const queue = driver.api.Queue;
    const log = driver.api.Util.log;

    if (filter.exec) {
        let img = '';
        let ext = filter.ext || '.gcode';
        let fname = filter.name || entry.name;
        let file = entry.tmpFile || tempFileName();

        // emit file with data and add to cleanup list
        fs.writeFileSync(file, entry.data);
        entry.files.push(file);

        // storge image, if present, and add to cleanup list
        if (entry.image) {
            img = tempFileName();
            fs.writeFileSync(img, entry.image.data);
            entry.files.push(img);
        }

        // add missing file name extension
        if (fname.indexOf(ext) < 0) {
            fname = fname + ext;
         }

        fname = fname.replace("{seq}", printSequence++);
        fname = fname.replace("{name}", entry.name);

        args = (filter.args || []).slice();
        args.forEach((val,idx) => {
            // replace any provided key/values from target
            for (let tkey in target) {
                val = val.replace("{" + tkey + "}", target[tkey]);
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
                execFilter(target, entry, index + 1);
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
    if (error) {
        entry.error = true;
        entry.status = error;
        entry.time.error = Date.now();
    } else {
        entry.status = "sent";
        entry.time.spooled = Date.now();
    }

    entry.data = null;
    entry.done = true;

    // notify waiters
    entry.waiting.forEach(function(res) {
        res.end(driver.api.Util.encode({
            key: entry.key,
            status: entry.status,
            error: entry.error,
            done: entry.done
        }));
    });

    // update queue
    driver.api.Queue.save();

    if (entry.error) {
        entry.promises.reject(entry);
    } else {
        entry.promises.resolve(entry);
    }
}

const fs = require('fs');
const spawn = require('child_process').spawn;
const tempDir = process.cwd() + "/tmp";

const driver = {
    name: "exec",

    init: (api) => {
        driver.api = api;
        api.Util.mkdirs([ tempDir ]);
    },

    send: (target, entry) => {
        return new Promise((resolve, reject) => {
            entry.promises = {resolve, reject};
            execFilterChain(target, entry);
        });
    }
};

module.exports = driver;
