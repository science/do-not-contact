/**
 * Stagehand browser wrapper for AI-driven web automation
 */

import { Stagehand } from "@browserbasehq/stagehand";

export interface BrowserConfig {
  headless: boolean;
  apiKey: string; // Anthropic API key
}

let stagehandInstance: Stagehand | null = null;

export async function initBrowser(config: BrowserConfig): Promise<Stagehand> {
  if (stagehandInstance) {
    return stagehandInstance;
  }

  stagehandInstance = new Stagehand({
    env: "LOCAL",
    enableCaching: false,
    headless: config.headless,
    verbose: 0, // Suppress debug logging
    modelName: "claude-3-7-sonnet-latest",
    modelClientOptions: {
      apiKey: config.apiKey,
    },
  });

  await stagehandInstance.init();
  return stagehandInstance;
}

export async function closeBrowser(): Promise<void> {
  if (stagehandInstance) {
    await stagehandInstance.close();
    stagehandInstance = null;
  }
}

export function getBrowser(): Stagehand | null {
  return stagehandInstance;
}
