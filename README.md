
# Stream Vault Server

## Overview
Stream Vault Server is a backend service for serving movie metadata and streaming content. It provides APIs to support movie catalogs, metadata, and HTTP-based streaming with range support.

## Features
- Movie file management with automatic metadata fetching from IMDb and Cinemeta.
- HTTP range-based video streaming.
- Hot reloading for added/removed movie files using `chokidar`.

## Directory Structure
```
src/
  config/         # Configuration files
  interfaces/     # TypeScript interfaces for data modeling
  middleware/     # Authentication and utility middleware
  routes/         # API route definitions
  services/       # Core service logic (e.g., movie management)
  index.ts        # Entry point for the server
.gitignore        # Ignored files and directories
docker-compose.yml # Docker Compose configuration
Dockerfile        # Docker image definition
package.json      # Node.js project configuration
tsconfig.json     # TypeScript compiler configuration
```

## Prerequisites
- Node.js (v16 or later)
- npm
- Docker (optional for containerized deployment)

## Installation
1. Clone the repository:
   ```sh
   git clone <repository-url>
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Build the project:
   ```sh
   npm run build
   ```

## Running
- **Local**: Start the server locally using:
  ```sh
  npm start
  ```
- **Docker**: Build and run the Docker container:
  ```sh
  docker-compose up --build
  ```

## Configuration
- Adjust `src/config/index.ts` for port and authentication settings.
- Set environment variables like `NODE_ENV` and `AUTH_CODE` for production environments.

## License
This project is licensed under the ISC License.
