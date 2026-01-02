# Do Not Contact

Automate opt-out requests to nonprofit organizations to remove yourself from their postal mailing lists.

This tool helps you politely ask nonprofits to stop sending physical mail by automatically finding their contact information and sending friendly opt-out emails on your behalf.

## How It Works

1. **You provide a list of organizations** - Add the names of nonprofits you want to contact to a text file
2. **The tool finds their contact info** - Uses Brave Search API to find contact pages, then an AI-powered browser (Stagehand) to extract email addresses
3. **Sends polite opt-out emails** - Automatically emails each organization asking to be removed from their postal mailing list

The email message is friendly and appreciative, thanking the organization for their work while requesting removal from physical mailings.

## Prerequisites

- Node.js 18+
- [Brave Search API key](https://brave.com/search/api/) (free tier: 2,000 queries/month)
- [Anthropic API key](https://console.anthropic.com/) (for AI browser automation)
- SMTP email account (Gmail, Outlook, etc.)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your organization list

Create a file called `donations-opt-out-list.txt` with one organization name per line:

```
Doctors without Borders
Electronic Frontier Foundation
World Central Kitchen
Planned Parenthood
```

### 3. Configure API keys

Create a `.env` file:

```bash
BRAVE_API_KEY=your-brave-search-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

### 4. Configure your identity and email

Copy the example config and fill in your details:

```bash
cp config.example.yml config.yml
```

Edit `config.yml`:

```yaml
# Your identity for opt-out requests
identity:
  full_name: "Your Full Name"
  salutation: "YourFirstName"  # Used for email sign-off
  email: "your.email@example.com"
  phone: "+1-555-555-5555"
  address:
    street: "123 Main Street"
    city: "Your City"
    state: "CA"
    zip: "12345"

# SMTP settings for sending emails
smtp:
  host: "smtp.gmail.com"
  port: 465
  secure: "ssl/tls"
  user: "your.email@gmail.com"
  send_as: "your.email@example.com"  # Optional: different "from" address
  password: "your-app-password"
```

**Gmail users:** You'll need an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password.

## Usage

### Complete Workflow

```bash
# 1. Import organizations into the database
npm run dev import

# 2. Find contact information for all organizations
npm run dev batch

# 3. Check status
npm run dev status

# 4. Preview emails (dry run)
npm run dev send-emails -- --dry-run

# 5. Send opt-out emails
npm run dev send-emails
```

### Individual Commands

```bash
# Search for organization websites
npm run dev search

# Search for contact pages directly
npm run dev contact-search

# Find contacts using AI browser (with visible browser for debugging)
npm run dev find-contacts -- --visible

# Process organizations with visible browser
npm run dev batch -- --visible

# Send test email to verify SMTP configuration
npm run dev send-emails -- --test your@email.com

# Send to a specific organization only
npm run dev send-emails -- --org "Doctors without Borders"
```

### Command Reference

| Command | Description |
|---------|-------------|
| `import` | Import organizations from text file into database |
| `search` | Look up websites for organizations using Brave Search |
| `contact-search` | Find contact pages directly via Brave Search |
| `find-contacts` | Use AI browser to extract email addresses from contact pages |
| `batch` | Process all pending organizations (search + extract contacts) |
| `status` | Show processing status of all organizations |
| `send-emails` | Send opt-out emails to organizations with email contacts |

## What the Email Says

The tool sends a polite, friendly email like this:

> Hi there,
>
> Thank you for all the great work [Organization Name] does! I really appreciate your mission and the impact you have.
>
> I'm writing with a small request: would you mind removing me from your postal mailing list? I want to make sure your outreach budget goes to people who will respond, and I'm just not able to contribute right now.
>
> If it helps to have my info for your records:
> Name: [Your Name]
> Address: [Your Address]
> Email: [Your Email]
> Phone: [Your Phone]
>
> Thanks so much for understanding, and keep up the wonderful work!
>
> Warmly,
> [Your First Name]

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Organization List   │────▶│   Brave Search   │────▶│ Contact Pages   │
│ (text file)         │     │   API            │     │ URLs            │
└─────────────────────┘     └──────────────────┘     └────────┬────────┘
                                                              │
                                                              ▼
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Opt-out Emails      │◀────│   Nodemailer     │◀────│ Stagehand AI    │
│ Sent via SMTP       │     │   SMTP           │     │ Browser         │
└─────────────────────┘     └──────────────────┘     │ (extracts       │
                                                     │  email addrs)   │
                                                     └─────────────────┘
```

**Components:**
- **Brave Search API** - Finds organization websites and contact pages
- **Stagehand** - AI-powered browser automation (uses Claude) to extract contact information from web pages
- **SQLite Database** - Tracks processing status for each organization
- **Nodemailer** - Sends emails via SMTP

## File Structure

```
do-not-contact/
├── .env                        # API keys (gitignored)
├── config.yml                  # Your identity + SMTP settings (gitignored)
├── donations-opt-out-list.txt  # Organizations to contact (gitignored)
├── data/
│   └── state.db               # SQLite database tracking progress
├── logs/                       # Email send logs
└── src/
    ├── index.ts               # CLI entry point
    ├── search.ts              # Brave Search API client
    ├── browser.ts             # Stagehand browser wrapper
    ├── contact-finder.ts      # AI-powered contact extraction
    ├── email-sender.ts        # SMTP email sending
    ├── db.ts                  # SQLite database operations
    ├── config.ts              # Configuration loader
    └── logger.ts              # File-based logging
```

## Rate Limiting

- Brave Search API: 1 request per second (handled automatically)
- Email sending: 2 second delay between emails
- Stagehand: Limited by page load times

## Troubleshooting

**"BRAVE_API_KEY not set"** - Create a `.env` file with your Brave Search API key

**"ANTHROPIC_API_KEY not set"** - Add your Anthropic API key to `.env`

**"Config file not found"** - Copy `config.example.yml` to `config.yml` and fill in your details

**"Failed to verify SMTP connection"** - Check your SMTP settings in `config.yml`. For Gmail, make sure you're using an App Password.

**Browser not finding contacts** - Try running with `--visible` flag to watch what's happening:
```bash
npm run dev batch -- --visible
```

## License

Apache 2.0
