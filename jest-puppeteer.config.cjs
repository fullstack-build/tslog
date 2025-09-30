const isCI = Boolean(process.env.CI);

module.exports = {
  launch: {
    dumpio: true,
    headless: "new",
    args: isCI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  },
  server: {
    command: "npm run test-puppeteer-serve",
    port: 4444,
    launchTimeout: 120000,
    debug: true,
    usedPortAction: "kill",
  },
};
