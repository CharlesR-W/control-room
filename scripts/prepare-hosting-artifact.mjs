import { access, copyFile, mkdir } from "node:fs/promises";

const entrypoint = "dist/server/index.js";
const workerConfig = "dist/server/wrangler.json";
const sourceConfig = ".openai/hosting.json";
const targetDirectory = "dist/.openai";
const targetConfig = `${targetDirectory}/hosting.json`;

await access(entrypoint);
await access(workerConfig);
await access(sourceConfig);
await mkdir(targetDirectory, { recursive: true });
await copyFile(sourceConfig, targetConfig);

console.log(`Hosting artifact ready: ${entrypoint}`);
