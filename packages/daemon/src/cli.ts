#!/usr/bin/env node

import { startDaemon } from "./index.js";

startDaemon({ transport: "stdio" });
