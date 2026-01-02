/**
 * Configuration loader - reads and validates config.yml
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";

const ConfigSchema = z.object({
  identity: z.object({
    full_name: z.string().min(1),
    salutation: z.string().min(1).optional(),
    email: z.string().email(),
    phone: z.string().min(1),
    address: z.object({
      street: z.string().min(1),
      city: z.string().min(1),
      state: z.string().min(1),
      zip: z.string().min(1),
    }),
  }),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number(),
    secure: z.union([z.boolean(), z.string()]), // true/false or "ssl/tls"
    authentication: z.string().optional(), // "oauth2", "normal", etc.
    user: z.string().min(1),
    send_as: z.string().email().optional(), // Gmail "send mail as" address
    password: z.string().min(1),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(configPath?: string): Config {
  const path = configPath || resolve(process.cwd(), "config.yml");

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\n` +
      `Copy config.example.yml to config.yml and fill in your details.`
    );
  }

  const content = readFileSync(path, "utf-8");
  const parsed = parse(content);

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
    throw new Error(`Invalid config file:\n${errors}`);
  }

  return result.data;
}

export function configToIdentity(config: Config) {
  return {
    fullName: config.identity.full_name,
    salutation: config.identity.salutation || config.identity.full_name.split(" ")[0],
    email: config.identity.email,
    phone: config.identity.phone,
    address: {
      street: config.identity.address.street,
      city: config.identity.address.city,
      state: config.identity.address.state,
      zip: config.identity.address.zip,
    },
  };
}

export function configToSmtp(config: Config) {
  // Handle secure field - "ssl/tls" or true means secure connection
  const secure = config.smtp.secure === true ||
                 config.smtp.secure === "ssl/tls" ||
                 config.smtp.secure === "SSL/TLS";

  return {
    host: config.smtp.host,
    port: config.smtp.port,
    secure,
    user: config.smtp.user,
    sendAs: config.smtp.send_as, // Gmail "send mail as" address
    password: config.smtp.password,
  };
}
