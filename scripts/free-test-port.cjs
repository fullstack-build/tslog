const killPort = require("kill-port");

const port = 4444;

async function main() {
  try {
    await killPort(port);
  } catch (error) {
    if (!/No process running on port/.test(error?.message ?? "")) {
      console.warn(`Failed to free port ${port}: ${error.message}`);
    }
  }
}

main().finally(() => process.exit(0));
