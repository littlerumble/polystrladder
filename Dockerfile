# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY dashboard/package*.json ./dashboard/

# Install dependencies
RUN npm install --workspace=backend --workspace=dashboard

# Copy backend
COPY backend ./backend
WORKDIR /app/backend
RUN npx prisma generate
RUN npm run build

# Copy and build dashboard
WORKDIR /app/dashboard
COPY dashboard ./
RUN npm run build

# Set working directory back to root
WORKDIR /app

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
