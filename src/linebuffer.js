class LineBuffer {

    constructor(stream) {
        if (!stream) throw "missing stream";
        this.enabled = true;
        this.buffer = null;
        this.stream = stream;
        this.stream.on("data", data => {
            if (this.buffer) {
                this.buffer = Buffer.concat([this.buffer, data]);
            } else {
                this.buffer = data;
            }
            this.nextLine();
        });
    }

    nextLine() {
        if (!this.enabled) {
            return;
        }
        let left = 0;
        const data = this.buffer;
        const cr = data.indexOf("\r");
        const lf = data.indexOf("\n");
        if (lf && cr + 1 == lf) { left = 1 }
        if (lf >= 0) {
            this.stream.emit("line", data.slice(0, lf - left));
            this.buffer = data.slice(lf + 1);
            this.nextLine();
        }
    }

}

module.exports = LineBuffer;
