#!/usr/bin/env node
import { runApp } from "./app.js";

process.exitCode = await runApp(process.argv.slice(2));
