const http = require('http');
const fs = require('fs');
const port = process.env.PORT ?? 4444;

const mimeTypes = {
    "html": "text/html",
    "js": "application/x-javascript"
};

const index = http.createServer((req, res) => {
    let filePath = req.url !== "/" ? req.url : "/index.html";
    process.stdout.write("Request to: " + filePath + "\n");
    let localPath = "";
    if(filePath === "/dist/browser/index.js") {
        localPath = __dirname + "/../../../dist/browser/index.js";
    } else {
        localPath = __dirname + "/static" + filePath;
    }
    try {
        const fileContent = fs.readFileSync(localPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', mimeTypes[filePath.split('.').pop()]);
        res.end(fileContent);
    } catch (err){
        res.statusCode = 404;
        res.setHeader('Content-Type', "text/plain");
        res.end("404");
    }

});

index.listen(port,() => {
    console.log(`Server running on port: ${port}`);
})
