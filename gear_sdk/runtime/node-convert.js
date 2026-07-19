#!/usr/bin/env node
"use strict";

let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(payload);
    global.window = {};
    window.GearConversionCore = require("./conversion-core.js");
    require("./assembly-engine.js");
    const fs = require("node:fs");
    const path = require("node:path");
    const localConnectorRoot = path.join(__dirname, "connectors");
    const connectorRoot = input.connectorDir || (fs.existsSync(localConnectorRoot)
      ? localConnectorRoot
      : path.resolve(__dirname, "../../connectors/frameworks"));
    const connectorPlugin = path.join(connectorRoot, input.target, "assembly.plugin.js");
    if (!fs.existsSync(connectorPlugin)) throw new Error(`Unknown connector: ${input.target}`);
    require(connectorPlugin);

    input.gearIR = window.GearConversionCore.buildGearIR(input);
    const plugin = window.GearAssemblyPlugins?.[input.target];
    if (!plugin) throw new Error(`Unknown connector: ${input.target}`);
    const result = plugin.assemble(input);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(String(error?.stack || error));
    process.exitCode = 1;
  }
});
