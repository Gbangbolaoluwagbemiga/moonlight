// Run the Oru CLI against the Preview network, assuming a proof server
// is already running locally on port 6300.

import { createLogger } from './logger-utils.js';
import { run } from './cli.js';
import { PreviewConfig } from './config.js';

const config = new PreviewConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
