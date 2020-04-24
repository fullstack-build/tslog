module.exports = {
  out: "./docs/tsdoc/",
  readme: true,
  includes: "./src",
  exclude: ["./src/LoggerHelper.ts"],
  mode: "file",
  excludeExternals: true,
  excludeNotExported: true,
  excludePrivate: true,
  theme: "default",
};
