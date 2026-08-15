#!/usr/bin/env node
import { startLocalRuntime } from "./local-runtime-host.js";
import { startMcpServer } from "./mcp-server.js";

if (process.argv[2] === "mcp") await startMcpServer();
else startLocalRuntime();
