#!/usr/bin/env node
import { startHttpServer } from "./http-server.js";
import { startMcpServer } from "./mcp-server.js";

if (process.argv[2] === "mcp") await startMcpServer();
else startHttpServer();
