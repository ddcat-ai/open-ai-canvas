function protectConsoleStreams(streams = [process.stdout, process.stderr]) {
    for (const stream of streams) {
        if (!stream || typeof stream.on !== "function") continue;
        stream.on("error", (error) => {
            if (error.code !== "EPIPE") throw error;
        });
    }
}

module.exports = { protectConsoleStreams };
