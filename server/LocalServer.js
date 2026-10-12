function listenLocal(app, port, onListening) {
    return app.listen(port, "127.0.0.1", onListening);
}

module.exports = { listenLocal };
