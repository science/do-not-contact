/**
 * Brave Search API client for finding organization websites
 */

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
}

export interface SearchResult {
  orgName: string;
  url: string | null;
  title: string | null;
  confidence: "high" | "medium" | "low";
  error?: string;
}

export interface ContactPageResult {
  orgName: string;
  websiteUrl: string | null;
  contactUrl: string | null;
  contactTitle: string | null;
  error?: string;
}

export class BraveSearch {
  private apiKey: string;
  private baseUrl = "https://api.search.brave.com/res/v1/web/search";
  private lastRequestTime = 0;
  private minDelayMs = 1100; // Slightly over 1 second for rate limit

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minDelayMs - elapsed)
      );
    }
    this.lastRequestTime = Date.now();
  }

  async findOrgWebsite(orgName: string): Promise<SearchResult> {
    await this.rateLimit();

    const query = `${orgName} nonprofit official website`;
    const params = new URLSearchParams({
      q: query,
      count: "5",
    });

    try {
      const response = await fetch(`${this.baseUrl}?${params}`, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          orgName,
          url: null,
          title: null,
          confidence: "low",
          error: `API error ${response.status}: ${text}`,
        };
      }

      const data: BraveSearchResponse = await response.json();
      const results = data.web?.results ?? [];

      if (results.length === 0) {
        return {
          orgName,
          url: null,
          title: null,
          confidence: "low",
          error: "No results found",
        };
      }

      // Simple heuristic: first result is usually correct for nonprofits
      // Could be enhanced with AI classification later
      const topResult = results[0];
      const confidence = this.assessConfidence(orgName, topResult);

      return {
        orgName,
        url: topResult.url,
        title: topResult.title,
        confidence,
      };
    } catch (err) {
      return {
        orgName,
        url: null,
        title: null,
        confidence: "low",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private assessConfidence(
    orgName: string,
    result: BraveWebResult
  ): "high" | "medium" | "low" {
    const nameLower = orgName.toLowerCase();
    const titleLower = result.title.toLowerCase();
    const urlLower = result.url.toLowerCase();

    // Check if org name appears in title or URL
    const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 2);
    const matchingWords = nameWords.filter(
      (word) => titleLower.includes(word) || urlLower.includes(word)
    );

    const matchRatio = matchingWords.length / nameWords.length;

    if (matchRatio >= 0.7) return "high";
    if (matchRatio >= 0.4) return "medium";
    return "low";
  }

  /**
   * Search for organization's contact page directly
   * Uses query like "EFF contact us" to find the contact page URL
   */
  async findContactPage(orgName: string): Promise<ContactPageResult> {
    await this.rateLimit();

    const query = `${orgName} contact us`;
    const params = new URLSearchParams({
      q: query,
      count: "10",
    });

    try {
      const response = await fetch(`${this.baseUrl}?${params}`, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          orgName,
          websiteUrl: null,
          contactUrl: null,
          contactTitle: null,
          error: `API error ${response.status}: ${text}`,
        };
      }

      const data: BraveSearchResponse = await response.json();
      const results = data.web?.results ?? [];

      if (results.length === 0) {
        return {
          orgName,
          websiteUrl: null,
          contactUrl: null,
          contactTitle: null,
          error: "No results found",
        };
      }

      // Find the best contact page result
      // Prioritize URLs containing "contact", "about", "help", "support"
      const contactKeywords = ["contact", "about", "help", "support", "reach", "get-in-touch"];

      let bestResult: BraveWebResult | null = null;
      let websiteUrl: string | null = null;

      for (const result of results) {
        const urlLower = result.url.toLowerCase();
        const titleLower = result.title.toLowerCase();

        // First result is likely the main website
        if (!websiteUrl) {
          websiteUrl = new URL(result.url).origin;
        }

        // Check if this looks like a contact page
        const isContactPage = contactKeywords.some(
          (kw) => urlLower.includes(kw) || titleLower.includes(kw)
        );

        if (isContactPage && !bestResult) {
          bestResult = result;
          break;
        }
      }

      // Fallback to first result if no explicit contact page found
      if (!bestResult) {
        bestResult = results[0];
      }

      return {
        orgName,
        websiteUrl,
        contactUrl: bestResult.url,
        contactTitle: bestResult.title,
      };
    } catch (err) {
      return {
        orgName,
        websiteUrl: null,
        contactUrl: null,
        contactTitle: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
