module.exports = {
  launch: {
    dumpio: true,
    headless: "new",
  },
  server: {
    command: "npm run test-puppeteer-serve",
    port: 4444,
    launchTimeout: 120000,
    debug: true,
    usedPortAction: "kill",
  },
};
