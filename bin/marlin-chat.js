const LineBuffer = require("./LineBuffer");
const SerialPort = require('serialport');

const fs = require('fs');
const port = process.argv[2];
const client = new SerialPort(port, { baudRate: 250000 })
    .on('open', function() {
        console.log("* open: " + port);
    })
    // .on('data', function(data) {
    //     console.log("<-- " + data.toString());
    // })
    .on('line', function(line) {
        console.log("<-- " + line.toString());
    })
    .on('close', function() {
        console.log("* close");
    });

process.stdin.on("line", line => {
    line = line.toString();
    console.log("--> " + line);
    if (line.indexOf("*send ") === 0) {
        let gcode = fs.readFileSync(line.substring(6)).toString().split("\n");
        gcode.forEach(line => {
            client.write(line + "\n");
        });
    } else {
        client.write(line + "\n");
    }
});

new LineBuffer(client);
new LineBuffer(process.stdin);
