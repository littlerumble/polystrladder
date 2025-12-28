# Polymarket Bot - Railway Deployment

## Quick Deploy

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect the Dockerfile

3. **Set Environment Variables** (in Railway dashboard)
   ```
   NODE_ENV=production
   BOT_MODE=PAPER
   BOT_BANKROLL=1000
   ```

4. **Access Your App**
   - Railway will provide a URL like `https://your-app.up.railway.app`
   - The dashboard will be served at the root `/`
   - API endpoints at `/api/*`

## Manual Deployment

If you prefer manual deployment:

```bash
# Build both backend and frontend
npm run build

# Set environment
export NODE_ENV=production

# Run in production
npm run start:prod
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Set to `production` for deployment |
| `BOT_MODE` | PAPER | Trading mode (PAPER/LIVE) |
| `BOT_BANKROLL` | 1000 | Starting bankroll in USD |
| `BOT_API_PORT` | 3000 | Server port |
| `DATABASE_URL` | file:./bot.db | SQLite database path |

## Notes

- SQLite database will persist on Railway's volume
- The dashboard is served as static files from the backend
- WebSocket connections will work automatically
- CORS is enabled for all origins in development

## Troubleshooting

**Database not initializing:**
```bash
# Railway will run prisma generate during build
# But if needed, you can add to build script:
npm run build && cd backend && npx prisma db push
```

**Port issues:**
Railway sets the `PORT` environment variable automatically. The bot uses port 3000 by default, which Railway will map correctly.
