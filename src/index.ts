#!/usr/bin/env node
/**
 * Do Not Contact - CLI
 * Automate opt-out requests to nonprofit organizations
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { Command } from "commander";
import { BraveSearch, SearchResult, ContactPageResult } from "./search.js";
import { initBrowser, closeBrowser } from "./browser.js";
import { extractContactInfo, ContactInfo } from "./contact-finder.js";
import {
  initDb,
  closeDb,
  importOrgs,
  getAllOrgs,
  getOrgsByStatus,
  updateOrgContact,
  getStats,
  logAttempt,
  Organization,
} from "./db.js";
import { loadConfig, configToIdentity, configToSmtp } from "./config.js";
import {
  initEmailTransport,
  verifyTransport,
  sendOptOutEmail,
  sendTestEmail,
  closeTransport,
  generateOptOutMessage,
} from "./email-sender.js";
import { initLogger, log, logEmail, logSummary, getLogFile } from "./logger.js";

// Load environment variables
config();

const program = new Command();

program
  .name("do-not-contact")
  .description("Automate opt-out requests to nonprofit organizations")
  .version("0.1.0");

// Helper to load orgs from file
function loadOrgs(filePath: string, limit?: number): string[] {
  const content = readFileSync(resolve(filePath), "utf-8");
  let orgs = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (limit) {
    orgs = orgs.slice(0, limit);
  }
  return orgs;
}

program
  .command("search")
  .description("Look up websites for organizations in the donations list")
  .option("-f, --file <path>", "Path to org list file", "donations-opt-out-list.txt")
  .option("-n, --limit <number>", "Limit number of orgs to process")
  .action(async (options) => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.error("Error: BRAVE_API_KEY not set in .env");
      process.exit(1);
    }

    let orgs: string[];
    try {
      orgs = loadOrgs(options.file, options.limit ? parseInt(options.limit, 10) : undefined);
    } catch (err) {
      console.error(`Error reading file: ${options.file}`);
      process.exit(1);
    }

    console.log(`\nSearching for ${orgs.length} organizations...\n`);
    console.log("─".repeat(80));

    const search = new BraveSearch(apiKey);
    const results: SearchResult[] = [];

    for (const org of orgs) {
      process.stdout.write(`🔍 ${org.padEnd(40)}`);
      const result = await search.findOrgWebsite(org);
      results.push(result);

      if (result.url) {
        const icon =
          result.confidence === "high" ? "✅" :
          result.confidence === "medium" ? "⚠️" : "❓";
        console.log(`${icon} ${result.url}`);
      } else {
        console.log(`❌ ${result.error}`);
      }
    }

    console.log("─".repeat(80));

    const highConf = results.filter((r) => r.confidence === "high");
    const medConf = results.filter((r) => r.confidence === "medium");
    const failed = results.filter((r) => r.url === null);

    console.log(`\nSummary:`);
    console.log(`  ✅ High confidence: ${highConf.length}`);
    console.log(`  ⚠️  Medium confidence: ${medConf.length}`);
    console.log(`  ❌ Failed: ${failed.length}`);
    console.log(`  📊 Total: ${results.length}`);
  });

program
  .command("contact-search")
  .description("Search for contact pages directly via Brave")
  .option("-f, --file <path>", "Path to org list file", "donations-opt-out-list.txt")
  .option("-n, --limit <number>", "Limit number of orgs to process")
  .action(async (options) => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.error("Error: BRAVE_API_KEY not set in .env");
      process.exit(1);
    }

    let orgs: string[];
    try {
      orgs = loadOrgs(options.file, options.limit ? parseInt(options.limit, 10) : undefined);
    } catch (err) {
      console.error(`Error reading file: ${options.file}`);
      process.exit(1);
    }

    console.log(`\nSearching for contact pages for ${orgs.length} organizations...\n`);
    console.log("─".repeat(100));

    const search = new BraveSearch(apiKey);
    const results: ContactPageResult[] = [];

    for (const org of orgs) {
      process.stdout.write(`📧 ${org.padEnd(40)}`);
      const result = await search.findContactPage(org);
      results.push(result);

      if (result.contactUrl) {
        console.log(`→ ${result.contactUrl.substring(0, 55)}`);
      } else {
        console.log(`❌ ${result.error}`);
      }
    }

    console.log("─".repeat(100));

    const found = results.filter((r) => r.contactUrl !== null);
    const failed = results.filter((r) => r.contactUrl === null);

    console.log(`\nSummary:`);
    console.log(`  ✅ Found contact pages: ${found.length}`);
    console.log(`  ❌ Failed: ${failed.length}`);
    console.log(`  📊 Total: ${results.length}`);
  });

program
  .command("find-contacts")
  .description("Find contact info (email/form) using Stagehand AI browser")
  .option("-f, --file <path>", "Path to org list file", "donations-opt-out-list.txt")
  .option("-n, --limit <number>", "Limit number of orgs to process")
  .option("--headless", "Run browser in headless mode", true)
  .option("--visible", "Run browser in visible mode (for debugging)")
  .action(async (options) => {
    const braveKey = process.env.BRAVE_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!braveKey) {
      console.error("Error: BRAVE_API_KEY not set in .env");
      process.exit(1);
    }
    if (!anthropicKey) {
      console.error("Error: ANTHROPIC_API_KEY not set in .env");
      process.exit(1);
    }

    let orgs: string[];
    try {
      orgs = loadOrgs(options.file, options.limit ? parseInt(options.limit, 10) : undefined);
    } catch (err) {
      console.error(`Error reading file: ${options.file}`);
      process.exit(1);
    }

    const headless = options.visible ? false : options.headless;
    console.log(`\nFinding contact info for ${orgs.length} organizations...`);
    console.log(`Browser mode: ${headless ? "headless" : "visible"}\n`);
    console.log("─".repeat(100));

    // Initialize browser
    const stagehand = await initBrowser({
      headless,
      apiKey: anthropicKey,
    });

    const search = new BraveSearch(braveKey);
    const results: ContactInfo[] = [];

    try {
      for (const org of orgs) {
        console.log(`\n🔍 ${org}`);

        // Step 1: Find contact page via Brave
        process.stdout.write("   Searching for contact page... ");
        const searchResult = await search.findContactPage(org);

        if (!searchResult.contactUrl) {
          console.log(`❌ ${searchResult.error}`);
          results.push({
            orgName: org,
            contactUrl: "",
            email: null,
            formUrl: null,
            contactType: "none",
            error: searchResult.error,
          });
          continue;
        }
        console.log(`✓`);

        // Step 2: Extract contact info using Stagehand
        process.stdout.write(`   Visiting ${searchResult.contactUrl.substring(0, 50)}... `);
        const contactInfo = await extractContactInfo(stagehand, org, searchResult.contactUrl);
        results.push(contactInfo);

        if (contactInfo.error) {
          console.log(`❌ ${contactInfo.error}`);
        } else {
          const typeIcon = {
            email: "📧",
            form: "📝",
            both: "📧📝",
            none: "❓",
          }[contactInfo.contactType];

          console.log(`${typeIcon} ${contactInfo.contactType}`);
          if (contactInfo.email) {
            console.log(`   └─ Email: ${contactInfo.email}`);
          }
          if (contactInfo.formUrl && contactInfo.contactType !== "email") {
            console.log(`   └─ Form: ${contactInfo.formUrl.substring(0, 60)}`);
          }
        }
      }
    } finally {
      await closeBrowser();
    }

    console.log("\n" + "─".repeat(100));

    // Summary
    const withEmail = results.filter((r) => r.email !== null);
    const withForm = results.filter((r) => r.formUrl !== null && !r.email);
    const none = results.filter((r) => r.contactType === "none");

    console.log(`\nSummary:`);
    console.log(`  📧 With email: ${withEmail.length}`);
    console.log(`  📝 Form only: ${withForm.length}`);
    console.log(`  ❓ No contact found: ${none.length}`);
    console.log(`  📊 Total: ${results.length}`);

    if (withEmail.length > 0) {
      console.log(`\nOrgs with email contacts:`);
      for (const r of withEmail) {
        console.log(`  - ${r.orgName}: ${r.email}`);
      }
    }
  });

program
  .command("import")
  .description("Import organizations from file into the database")
  .option("-f, --file <path>", "Path to org list file", "donations-opt-out-list.txt")
  .action(async (options) => {
    let orgs: string[];
    try {
      orgs = loadOrgs(options.file);
    } catch (err) {
      console.error(`Error reading file: ${options.file}`);
      process.exit(1);
    }

    initDb();
    const imported = importOrgs(orgs);
    const stats = getStats();
    closeDb();

    console.log(`\nImported ${imported} new organizations`);
    console.log(`Total in database: ${stats.total}`);
  });

program
  .command("status")
  .description("Show processing status of all organizations")
  .action(async () => {
    initDb();
    const stats = getStats();
    const orgs = getAllOrgs();
    closeDb();

    console.log("\n" + "=".repeat(80));
    console.log("  DO NOT CONTACT - Status Report");
    console.log("=".repeat(80));

    console.log("\nSummary:");
    console.log(`  Total organizations: ${stats.total}`);
    console.log(`  Pending:   ${stats.pending}`);
    console.log(`  Success:   ${stats.success}`);
    console.log(`  Failed:    ${stats.failed}`);
    console.log(`  Manual:    ${stats.manual}`);
    console.log(`  With email: ${stats.withEmail}`);
    console.log(`  With form:  ${stats.withForm}`);

    if (orgs.length > 0) {
      console.log("\n" + "-".repeat(80));
      console.log("Organizations:\n");

      const statusIcon = (s: string) => {
        switch (s) {
          case "success": return "\u2705";
          case "failed": return "\u274c";
          case "manual": return "\u270b";
          default: return "\u23f3";
        }
      };

      const contactIcon = (t: string | null) => {
        switch (t) {
          case "email": return "\ud83d\udce7";
          case "form": return "\ud83d\udcdd";
          case "both": return "\ud83d\udce7\ud83d\udcdd";
          default: return "  ";
        }
      };

      for (const org of orgs) {
        const icon = statusIcon(org.status);
        const contact = contactIcon(org.contact_type);
        const value = org.contact_value ? ` -> ${org.contact_value.substring(0, 40)}` : "";
        console.log(`  ${icon} ${contact} ${org.name.padEnd(35)}${value}`);
      }
    }

    console.log("\n" + "=".repeat(80));
  });

program
  .command("batch")
  .description("Process all pending organizations (headless mode)")
  .option("--visible", "Run browser in visible mode (for debugging)")
  .action(async (options) => {
    const braveKey = process.env.BRAVE_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!braveKey) {
      console.error("Error: BRAVE_API_KEY not set in .env");
      process.exit(1);
    }
    if (!anthropicKey) {
      console.error("Error: ANTHROPIC_API_KEY not set in .env");
      process.exit(1);
    }

    initDb();
    const pendingOrgs = getOrgsByStatus("pending");

    if (pendingOrgs.length === 0) {
      console.log("\nNo pending organizations to process.");
      console.log("Use 'import' to add organizations or 'status' to see current state.");
      closeDb();
      return;
    }

    const headless = !options.visible;
    console.log(`\nProcessing ${pendingOrgs.length} pending organizations...`);
    console.log(`Browser mode: ${headless ? "headless" : "visible"}\n`);
    console.log("-".repeat(100));

    // Initialize browser
    const stagehand = await initBrowser({
      headless,
      apiKey: anthropicKey,
    });

    const search = new BraveSearch(braveKey);

    try {
      for (const org of pendingOrgs) {
        console.log(`\n\ud83d\udd0d ${org.name}`);

        // Step 1: Find contact page via Brave
        process.stdout.write("   Searching for contact page... ");
        const searchResult = await search.findContactPage(org.name);

        if (!searchResult.contactUrl) {
          console.log(`\u274c ${searchResult.error}`);
          updateOrgContact(org.name, {
            contact_type: "none",
            status: "failed",
            error_message: searchResult.error,
          });
          logAttempt(org.name, "search", false, { error: searchResult.error });
          continue;
        }
        console.log("\u2713");
        logAttempt(org.name, "search", true, { url: searchResult.contactUrl });

        // Step 2: Extract contact info using Stagehand
        process.stdout.write(`   Visiting ${searchResult.contactUrl.substring(0, 50)}... `);
        const contactInfo = await extractContactInfo(stagehand, org.name, searchResult.contactUrl);

        if (contactInfo.error) {
          console.log(`\u274c ${contactInfo.error}`);
          updateOrgContact(org.name, {
            website: searchResult.websiteUrl ?? undefined,
            contact_type: "none",
            status: "failed",
            error_message: contactInfo.error,
          });
          logAttempt(org.name, "contact_find", false, { error: contactInfo.error });
        } else {
          const typeIcon = {
            email: "\ud83d\udce7",
            form: "\ud83d\udcdd",
            both: "\ud83d\udce7\ud83d\udcdd",
            none: "\u2753",
          }[contactInfo.contactType];

          console.log(`${typeIcon} ${contactInfo.contactType}`);
          if (contactInfo.email) {
            console.log(`   \u2514\u2500 Email: ${contactInfo.email}`);
          }
          if (contactInfo.formUrl && contactInfo.contactType !== "email") {
            console.log(`   \u2514\u2500 Form: ${contactInfo.formUrl.substring(0, 60)}`);
          }

          const contactValue = contactInfo.email || contactInfo.formUrl;
          const status = contactInfo.contactType === "none" ? "manual" : "success";

          updateOrgContact(org.name, {
            website: searchResult.websiteUrl ?? undefined,
            contact_type: contactInfo.contactType,
            contact_value: contactValue,
            status,
          });
          logAttempt(org.name, "contact_find", status === "success", {
            type: contactInfo.contactType,
            email: contactInfo.email,
            formUrl: contactInfo.formUrl,
          });
        }
      }
    } finally {
      await closeBrowser();
    }

    // Final stats
    const stats = getStats();
    closeDb();

    console.log("\n" + "-".repeat(100));
    console.log("\nBatch complete!");
    console.log(`  \u2705 Success: ${stats.success}`);
    console.log(`  \u274c Failed: ${stats.failed}`);
    console.log(`  \u270b Manual: ${stats.manual}`);
    console.log(`  \u23f3 Pending: ${stats.pending}`);
  });

program
  .command("send-emails")
  .description("Send opt-out emails to organizations with email contacts")
  .option("--dry-run", "Preview emails without sending")
  .option("--test <email>", "Send a test email to verify SMTP configuration")
  .option("--org <name>", "Send to a specific organization only")
  .action(async (options) => {
    // Load config
    let userConfig;
    try {
      userConfig = loadConfig();
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    const identity = configToIdentity(userConfig);
    const smtpConfig = configToSmtp(userConfig);

    // Handle test mode - send a test email and exit
    if (options.test) {
      console.log("\n" + "=".repeat(80));
      console.log("  DO NOT CONTACT - Test Email");
      console.log("=".repeat(80));
      console.log(`\nSending test email...`);
      console.log(`From: ${identity.fullName} <${smtpConfig.sendAs || identity.email}>`);
      console.log(`To: ${options.test}`);
      console.log(`\nConnecting to SMTP server: ${smtpConfig.host}:${smtpConfig.port}...`);

      initEmailTransport(smtpConfig);

      try {
        const verified = await verifyTransport();
        if (!verified) {
          console.error("Failed to verify SMTP connection");
          closeTransport();
          process.exit(1);
        }
        console.log("SMTP connection verified.");

        const result = await sendTestEmail(options.test, identity);

        if (result.success) {
          console.log(`\n\u2705 Test email sent successfully!`);
          console.log(`Message ID: ${result.messageId}`);
        } else {
          console.error(`\n\u274c Failed to send test email: ${result.error}`);
        }
      } catch (err) {
        console.error(`\nSMTP error: ${err instanceof Error ? err.message : err}`);
      } finally {
        closeTransport();
      }
      return;
    }

    initDb();

    // Get orgs with email contacts
    let orgsToEmail = getAllOrgs().filter(
      (org) => org.contact_type === "email" || org.contact_type === "both"
    );

    if (options.org) {
      orgsToEmail = orgsToEmail.filter((o) => o.name === options.org);
      if (orgsToEmail.length === 0) {
        console.error(`\nOrganization not found or has no email: ${options.org}`);
        closeDb();
        process.exit(1);
      }
    }

    if (orgsToEmail.length === 0) {
      console.log("\nNo organizations with email contacts found.");
      console.log("Run 'batch' first to find contact information.");
      closeDb();
      return;
    }

    console.log("\n" + "=".repeat(80));
    console.log("  DO NOT CONTACT - Email Sender");
    console.log("=".repeat(80));
    console.log(`\nSending from: ${identity.fullName} <${smtpConfig.sendAs || identity.email}>`);
    console.log(`Organizations to contact: ${orgsToEmail.length}`);

    if (options.dryRun) {
      console.log("\n[DRY RUN - No emails will be sent]\n");
      console.log("-".repeat(80));

      for (const org of orgsToEmail) {
        const { subject, text } = generateOptOutMessage(org.name, identity);
        console.log(`\nTo: ${org.contact_value}`);
        console.log(`Subject: ${subject}`);
        console.log("-".repeat(40));
        console.log(text);
        console.log("-".repeat(80));
      }

      closeDb();
      return;
    }

    // Initialize logging
    const logFile = initLogger();
    log(`From: ${identity.fullName} <${smtpConfig.sendAs || identity.email}>`);
    log(`Organizations to contact: ${orgsToEmail.length}`);
    console.log(`\nLog file: ${logFile}`);

    // Initialize SMTP transport
    console.log(`\nConnecting to SMTP server: ${smtpConfig.host}:${smtpConfig.port}...`);
    initEmailTransport(smtpConfig);

    try {
      const verified = await verifyTransport();
      if (!verified) {
        console.error("Failed to verify SMTP connection");
        log("ERROR: Failed to verify SMTP connection");
        closeTransport();
        closeDb();
        process.exit(1);
      }
      console.log("SMTP connection verified.\n");
      log("SMTP connection verified");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`SMTP error: ${errorMsg}`);
      log(`ERROR: SMTP error: ${errorMsg}`);
      closeTransport();
      closeDb();
      process.exit(1);
    }

    console.log("-".repeat(80));

    let sent = 0;
    let failed = 0;
    const fromEmail = smtpConfig.sendAs || identity.email;

    for (const org of orgsToEmail) {
      process.stdout.write(`Sending to ${org.name.padEnd(35)} -> ${org.contact_value}... `);

      // Generate the message for logging
      const { subject, text } = generateOptOutMessage(org.name, identity);

      const result = await sendOptOutEmail(org.name, org.contact_value!, identity);

      // Log to file with full email content
      logEmail({
        orgName: org.name,
        toEmail: org.contact_value!,
        fromEmail,
        subject,
        body: text,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      });

      if (result.success) {
        console.log("\u2705");
        sent++;
        logAttempt(org.name, "email", true, { messageId: result.messageId });
      } else {
        console.log(`\u274c ${result.error}`);
        failed++;
        logAttempt(org.name, "email", false, { error: result.error });
      }

      // Rate limit: wait 2 seconds between emails
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Log summary
    logSummary(sent, failed);

    closeTransport();
    closeDb();

    console.log("-".repeat(80));
    console.log(`\nComplete! Sent: ${sent}, Failed: ${failed}`);
    console.log(`\nFull log saved to: ${logFile}`);
  });

program.parse();
