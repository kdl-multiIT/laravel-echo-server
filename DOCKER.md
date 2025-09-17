# Docker Setup for Laravel Echo Server

This directory contains Docker configuration files for running Laravel Echo Server with Redis in containers.

## Files Created

- `Dockerfile` - Multi-stage Docker image for the Echo Server
- `docker-compose.yml` - Complete stack with Echo Server and Redis
- `.dockerignore` - Optimizes Docker build context
- `.env.docker` - Environment variables template for Docker deployment

## Quick Start

1. **Copy the environment file:**
   ```bash
   cp .env.docker .env
   ```

2. **Edit the environment file:**
   ```bash
   nano .env
   ```
   Update `LARAVEL_ECHO_SERVER_AUTH_HOST` to match your Laravel application URL.

3. **Build and start the services:**
   ```bash
   docker-compose up -d
   ```

4. **Check if services are running:**
   ```bash
   docker-compose ps
   ```

## Configuration

### Environment Variables

All configuration is done through environment variables. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LARAVEL_ECHO_SERVER_AUTH_HOST` | `http://localhost` | Your Laravel application URL |
| `LARAVEL_ECHO_SERVER_PORT` | `6001` | Port for the Echo Server |
| `LARAVEL_ECHO_SERVER_DEV_MODE` | `false` | Enable development mode |
| `LARAVEL_ECHO_SERVER_CORS_ORIGIN` | `*` | CORS allowed origins |
| `REDIS_PASSWORD` | (empty) | Redis password (optional) |

### Production Configuration

For production, update these settings in your `.env` file:

```env
LARAVEL_ECHO_SERVER_DEV_MODE=false
LARAVEL_ECHO_SERVER_CORS_ORIGIN=https://yourdomain.com
REDIS_PASSWORD=your-secure-password
```

## Docker Commands

### Development
```bash
# Start services
docker-compose up

# Start services in background
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f laravel-echo-server
```

### Management
```bash
# Stop services
docker-compose down

# Restart services
docker-compose restart

# Rebuild and start
docker-compose up --build

# Remove everything including volumes
docker-compose down -v
```

### Debugging
```bash
# Execute commands in running container
docker-compose exec laravel-echo-server sh

# Check container health
docker-compose ps
```

## Networking

The services run on a custom Docker network called `echo-network`. This allows:
- The Echo Server to connect to Redis using the hostname `redis`
- Isolation from other Docker projects
- Easy communication between services

## Volumes

- `redis_data` - Persistent storage for Redis data

## Health Checks

Both services include health checks:
- **Echo Server**: Checks if the Socket.IO endpoint responds
- **Redis**: Uses `redis-cli ping` command

## Ports

By default, the following ports are exposed:
- `6001` - Laravel Echo Server
- `6379` - Redis (optional, for external access)

## SSL/TLS Support

To enable HTTPS, update your `.env` file:

```env
LARAVEL_ECHO_SERVER_PROTOCOL=https
LARAVEL_ECHO_SERVER_SSL_CERT_PATH=/path/to/cert.pem
LARAVEL_ECHO_SERVER_SSL_KEY_PATH=/path/to/key.pem
```

Mount your SSL certificates as volumes in `docker-compose.yml`:

```yaml
volumes:
  - ./certs:/certs:ro
```

## Troubleshooting

### Echo Server won't start
- Check if port 6001 is available
- Verify Redis is running: `docker-compose logs redis`
- Check environment variables: `docker-compose config`

### Connection issues
- Verify CORS settings in `.env`
- Check if your Laravel app can reach the Echo Server
- Ensure firewall allows the configured port

### Redis connection failed
- Verify Redis service is healthy: `docker-compose ps`
- Check Redis logs: `docker-compose logs redis`
- Ensure Redis password is correct (if set)