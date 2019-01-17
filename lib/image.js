const BMP   = require('bmp-js');
const PNG   = require('pngjs').PNG;

PNG.prototype.pixAt = function(x,y) {
    var idx = (x + this.width * y) * 4;
    var dat = this.data;
    return [
        dat[idx++],
        dat[idx++],
        dat[idx++],
        dat[idx++]
    ];
};

PNG.prototype.averageBlock = function(x1,y1,x2,y2) {
    var val = [0, 0, 0, 0];
    var count = 0;
    for (var x=x1; x<x2; x++) {
        for (var y=y1; y<y2; y++) {
            var v2 = this.pixAt(x,y);
            for (var z=0; z<4; z++) {
                val[z] += v2[z];
            }
            count++;
        }
    }
    for (var z=0; z<4; z++) {
        val[z] = Math.abs(val[z] / count);
    }
    return val;
};

function png2bmp(buffer, callback, width, height) {
    var png = new PNG().parse(buffer, (err, data) => {
        var th = width || 80;
        var tw = height || 60;
        var ratio = png.width / png.height;
        if (ratio > 4/3) {
            var div = png.height / tw;
            var xoff = Math.round((png.width - (th * div)) / 2);
            var yoff = 0;
        } else {
            var div = png.width / th;
            var xoff = 0;
            var yoff = Math.round((png.height - (tw * div)) / 2);
        }
        var buf = Buffer.alloc(th * tw * 4);
        for (var y=0; y<tw; y++) {
            var dy = Math.round(y * div + yoff);
            if (dy < 0 || dy > png.height) continue;
            var ey = Math.round((y+1) * div + yoff);
            for (var x=0; x<th; x++) {
                var dx = Math.round(x * div + xoff);
                if (dx < 0 || dx > png.width) continue;
                var ex = Math.round((x+1) * div + xoff);
                var bidx = (y * th + x) * 4;
                var pixval = png.averageBlock(dx,dy,ex,ey);
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
        callback(BMP.encode({data:buf, width:th, height:tw}));
    });
}

module.exports = {
    png2bmp: png2bmp
};
