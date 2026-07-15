// Run the Oru CLI against Preprod, assuming a proof server is already
// running locally on port 6300 (see `npm run preprod-ps` for the managed one).

import { createLogger } from './logger-utils.js';
import { run } from './cli.js';
import { PreprodConfig } from './config.js';

const config = new PreprodConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
