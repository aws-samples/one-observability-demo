import * as fs from 'fs';
import path = require('path');
import * as yaml from 'js-yaml';
import { log } from 'console';
import { Construct } from 'constructs';

export interface WorkshopConfig
{
    readonly createXRayGroup : boolean;
}

export function getConfig(app: Construct) : WorkshopConfig {

    // Default configuration
    let config = {
        createXRayGroup: false
    };
    if (process.env.CONFIG_PATH) {
        let configPath = process.env.CONFIG_PATH;
        log(`Using config file: ${configPath}`);
        /// Check if the file exists and is not empty
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file ${configPath} does not exist`);
        }
        /// Check if configPath exists. If it exists read the content of the file as YAML and convert the result into an object using WorkshopConfig interface
        let configContent = fs.readFileSync(configPath, 'utf8');
        config = yaml.load(configContent) as WorkshopConfig;
    }


    return config;
}