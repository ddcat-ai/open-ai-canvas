#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const env = { ...process.env };

// The backup worker supplies a PostgreSQL URI in PGDATABASE.
if (/^postgres(?:ql)?:\/\//i.test(env.PGDATABASE || "")) {
    const uri = new URL(env.PGDATABASE);
    if (uri.password) env.PGPASSWORD = decodeURIComponent(uri.password);
    uri.password = "";
    for (const [key, value] of [...uri.searchParams]) {
        if (key === "password" || key === "sslpassword") {
            env[key === "password" ? "PGPASSWORD" : "PGSSLPASSWORD"] = value;
            uri.searchParams.delete(key);
        }
    }
    delete env.PGDATABASE;
    args.unshift("--dbname", uri.toString());
}
const result = spawnSync("/usr/bin/pg_dump", args, { env, stdio: "inherit" });
process.exit(result.status ?? 1);
