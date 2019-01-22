const BMP   = require('bmp-js');
const PNG   = require('pngjs').PNG;

PNG.prototype.pixAt = function(x,y) {
    let idx = (x + this.width * y) * 4;
    let dat = this.data;
    return [
        dat[idx++],
        dat[idx++],
        dat[idx++],
        dat[idx++]
    ];
};

PNG.prototype.averageBlock = function(x1,y1,x2,y2) {
    let val = [0, 0, 0, 0];
    let count = 0;
    for (let x=x1; x<x2; x++) {
        for (let y=y1; y<y2; y++) {
            let v2 = this.pixAt(x,y);
            for (let z=0; z<4; z++) {
                val[z] += v2[z];
            }
            count++;
        }
    }
    for (let z=0; z<4; z++) {
        val[z] = Math.abs(val[z] / count);
    }
    return val;
};

function png2bmp(buffer, width, height) {
    return new Promise((resolve, reject) => {
        let png = new PNG().parse(buffer, (err, data) => {
            let th = width || 80;
            let tw = height || 60;
            let ratio = png.width / png.height;
            let div;
            let xoff;
            let yoff;
            if (ratio > 4/3) {
                div = png.height / tw;
                xoff = Math.round((png.width - (th * div)) / 2);
                yoff = 0;
            } else {
                div = png.width / th;
                xoff = 0;
                yoff = Math.round((png.height - (tw * div)) / 2);
            }
            let buf = Buffer.alloc(th * tw * 4);
            for (let y=0; y<tw; y++) {
                let dy = Math.round(y * div + yoff);
                if (dy < 0 || dy > png.height) continue;
                let ey = Math.round((y+1) * div + yoff);
                for (let x=0; x<th; x++) {
                    let dx = Math.round(x * div + xoff);
                    if (dx < 0 || dx > png.width) continue;
                    let ex = Math.round((x+1) * div + xoff);
                    let bidx = (y * th + x) * 4;
                    let pixval = png.averageBlock(dx,dy,ex,ey);
                    if (Math.abs(pixval[0] - pixval[1]) + Math.abs(pixval[2] - pixval[1]) < 5) {
                        pixval[0] = Math.round(pixval[0] * 0.8);
                        pixval[1] = Math.round(pixval[1] * 0.8);
                        pixval[2] = Math.round(pixval[2] * 0.8);
                        pixval[3] = Math.round(pixval[3] * 0.8);
                    }
                    buf[bidx+0] = pixval[0];
                    buf[bidx+1] = pixval[1];
                    buf[bidx+2] = pixval[2];
                    buf[bidx+3] = pixval[3];
                }
            }
            resolve(BMP.encode({data:buf, width:th, height:tw}));
        });
    });
}

module.exports = {
    png2bmp: png2bmp
};
