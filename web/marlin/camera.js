function init() {
    setInterval(() => {
        let time = Date.now();
        document.documentElement.style.setProperty('--image-url', `url("http://192.168.86.52/camera.jpg#${time}")`);
    }, 1000);

    document.getElementById('image').onclick = () => {
        window.location = "http://localhost:4080/index.html";
    };
}
