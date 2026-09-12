FROM node:22-bookworm-slim

# Install system build dependencies, ONNX runtime dependencies (libgomp1) and ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    libgomp1 \
    libc++1 \
    ca-certificates \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and explicitly rebuild native modules for Linux
RUN npm install --omit=dev && npm rebuild better-sqlite3

# Copy application source code
COPY . .

# Create volume directories
RUN mkdir -p /app/data /app/auth_info_baileys

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
