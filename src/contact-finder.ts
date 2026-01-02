/**
 * Contact finder - extracts contact information from web pages using Stagehand
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

export interface ContactInfo {
  orgName: string;
  contactUrl: string;
  email: string | null;
  formUrl: string | null;
  contactType: "email" | "form" | "both" | "none";
  rawText?: string;
  error?: string;
}

const ContactSchema = z.object({
  emails: z.array(z.string()).describe("Email addresses found on the page for contacting the organization"),
  hasContactForm: z.boolean().describe("Whether there is a contact form on this page"),
  formAction: z.string().optional().describe("The form action URL if a contact form exists"),
  phoneNumbers: z.array(z.string()).optional().describe("Phone numbers found on the page"),
});

export async function extractContactInfo(
  stagehand: Stagehand,
  orgName: string,
  contactUrl: string
): Promise<ContactInfo> {
  try {
    // Navigate to the contact page
    await stagehand.page.goto(contactUrl);

    // Wait a moment for dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Use Stagehand's page.extract to find contact information
    const extracted = await stagehand.page.extract({
      instruction: `Extract contact information from this page. Look for:
        1. Email addresses (especially ones for general inquiries, info@, contact@, support@)
        2. Whether there's a contact form on this page
        3. The form action URL if there is a form
        Focus on finding ways to contact the organization directly.`,
      schema: ContactSchema,
    });

    // Determine contact type
    const hasEmail = extracted.emails.length > 0;
    const hasForm = extracted.hasContactForm;

    let contactType: ContactInfo["contactType"] = "none";
    if (hasEmail && hasForm) {
      contactType = "both";
    } else if (hasEmail) {
      contactType = "email";
    } else if (hasForm) {
      contactType = "form";
    }

    // Pick the best email (prefer info@, contact@, support@)
    let bestEmail: string | null = null;
    if (extracted.emails.length > 0) {
      const priorityPrefixes = ["info@", "contact@", "support@", "help@", "hello@"];
      for (const prefix of priorityPrefixes) {
        const match = extracted.emails.find((e) => e.toLowerCase().startsWith(prefix));
        if (match) {
          bestEmail = match;
          break;
        }
      }
      if (!bestEmail) {
        bestEmail = extracted.emails[0];
      }
    }

    return {
      orgName,
      contactUrl,
      email: bestEmail,
      formUrl: extracted.formAction || (hasForm ? contactUrl : null),
      contactType,
    };
  } catch (err) {
    return {
      orgName,
      contactUrl,
      email: null,
      formUrl: null,
      contactType: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * If the contact page doesn't have direct info, try to find a contact link
 */
export async function findContactLink(stagehand: Stagehand): Promise<string | null> {
  try {
    const result = await stagehand.page.observe({
      instruction: "Find a link to a contact page, contact form, or 'get in touch' section",
    });

    if (result.length > 0) {
      // Click the first contact-related element found
      await stagehand.page.act({
        action: "click on the contact or get in touch link",
      });
      return stagehand.page.url();
    }
    return null;
  } catch {
    return null;
  }
}
