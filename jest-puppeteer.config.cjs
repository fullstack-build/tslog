module.exports = {
    launch: {
        dumpio: true,
        headless: process.env.HEADLESS !== 'false',
    },
    server: {
        command: 'npm run test-puppeteer-serve',
        port: 4444,
        launchTimeout: 10000,
        debug: true,
    },
}
