FROM node:20-bookworm-slim

# Install system build dependencies and ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package definition files
COPY package*.json ./

# Install dependencies (rebuilding native C++ bindings for linux)
RUN npm install --production

# Copy application source code
COPY . .

# Create volume directories
RUN mkdir -p /app/data /app/auth_info_baileys

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
