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

2. **Add PostgreSQL on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - **IMPORTANT**: Click "New" → "Database" → "PostgreSQL"
   - Railway will auto-link the DATABASE_URL

3. **Set Environment Variables** (in Railway dashboard)
   ```
   NODE_ENV=production
   BOT_MODE=PAPER
   BOT_BANKROLL=5000
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
export DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Run migrations
cd backend && npx prisma db push && cd ..

# Run in production
npm run start:prod
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Set to `production` for deployment |
| `BOT_MODE` | PAPER | Trading mode (PAPER/LIVE) |
| `BOT_BANKROLL` | 5000 | Starting bankroll in USD |
| `BOT_API_PORT` | 3000 | Server port |
| `DATABASE_URL` | *required* | PostgreSQL connection string |

## Notes

- **PostgreSQL persists across deploys** - your positions and state are saved!
- Railway auto-provides DATABASE_URL when you add PostgreSQL
- The dashboard is served as static files from the backend
- WebSocket connections will work automatically

## Troubleshooting

**Database not initializing:**
```bash
# Run migrations on first deploy
cd backend && npx prisma db push
```

**Resetting database (careful!):**
```bash
# This will DELETE all data
cd backend && npx prisma db push --force-reset
```

**Port issues:**
Railway sets the `PORT` environment variable automatically.
