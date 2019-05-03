function init() {
    document.getElementById('image').onclick = () => {
        window.location = "http://localhost:4080/index.html";
    };

    updateImage();
}

function updateImage() {
    let time = Date.now();
    let img = new Image();
    let url = `http://localhost/camera.jpg?time=${time}`;
    img.onload = () => {
        document.documentElement.style.setProperty('--image-url', `url(${url})`);
        updateImage();
    };
    img.src = url;
}
