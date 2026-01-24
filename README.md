# Mutumbot

A Discord bot for tracking Friday beer pictures and answering drink-related questions. Designed for serverless deployment on Vercel.

## Features

### Friday Beer Tracking
- `/beer post [image]` - Post your Friday beer (with optional image attachment)
- `/beer status` - Check if anyone has posted their Friday beer
- `/beer reminder` - Send a reminder to post Friday beer

### Drink Questions
- `/drink ask <question>` - Ask questions about drinks (beer, wine, whiskey, cocktails, coffee, tea)
- `/drink list` - List all drink categories
- `/drink random` - Get a random drink fact

### Fun
- `/cheers` - Send a cheers to the channel!

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Copy the following values (you'll need them later):
   - **Application ID** (from General Information)
   - **Public Key** (from General Information)
   - **Bot Token** (from Bot section - click "Reset Token" to generate one)

### 2. Deploy to Vercel

1. Fork or clone this repository
2. Connect your repository to [Vercel](https://vercel.com)
3. Add the following environment variables in Vercel:
   - `DISCORD_APP_ID` - Your Discord Application ID
   - `DISCORD_BOT_TOKEN` - Your Discord Bot Token
   - `DISCORD_PUBLIC_KEY` - Your Discord Application Public Key
4. Deploy the project
5. Copy your Vercel deployment URL (e.g., `https://mutumbot.vercel.app`)

### 3. Configure Discord Interactions Endpoint

1. Go back to the Discord Developer Portal
2. In your application settings, go to "General Information"
3. Set the **Interactions Endpoint URL** to: `https://your-vercel-url.vercel.app/api/interactions`
4. Discord will verify the endpoint - it should show a success message

### 4. Register Slash Commands

Run the command registration script:

```bash
# Install dependencies
npm install

# Set environment variables
export DISCORD_APP_ID="your-app-id"
export DISCORD_BOT_TOKEN="your-bot-token"
export DISCORD_GUILD_ID="your-test-server-id"  # Optional: for instant updates during development

# Register commands
npm run register
```

### 5. Invite the Bot to Your Server

1. Go to the Discord Developer Portal
2. Navigate to "OAuth2" > "URL Generator"
3. Select scopes: `bot`, `applications.commands`
4. Select bot permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use Slash Commands`
5. Copy the generated URL and open it in your browser
6. Select your server and authorize the bot

## Development

### Local Development

```bash
# Install dependencies
npm install

# Create a .env file based on .env.example
cp .env.example .env
# Edit .env with your Discord credentials

# Run locally with Vercel CLI
npm run dev
```

### Project Structure

```
mutumbot/
├── api/
│   └── interactions.ts    # Main Discord webhook endpoint
├── src/
│   ├── types.ts           # TypeScript type definitions
│   ├── beer-tracker.ts    # Friday beer tracking logic
│   └── drink-questions.ts # Drink Q&A knowledge base
├── scripts/
│   └── register-commands.ts  # Slash command registration
├── package.json
├── tsconfig.json
├── vercel.json
└── .env.example
```

## Notes

### Storage

The current implementation uses in-memory storage, which means:
- Beer posts are reset when the serverless function cold starts
- Data is not persisted across deployments

For production use, consider integrating:
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv) (Redis)
- [Upstash Redis](https://upstash.com/)
- [Planetscale](https://planetscale.com/) (MySQL)

### Global vs Guild Commands

- **Guild commands** appear instantly but only work in the specified server
- **Global commands** work everywhere but can take up to 1 hour to propagate

During development, set `DISCORD_GUILD_ID` for instant command updates.

## License

MIT
