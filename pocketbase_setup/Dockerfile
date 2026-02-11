# ---- PocketBase on Fly.io ----
# Uses Alpine Linux + downloads the latest PocketBase binary from GitHub

FROM alpine:latest

# Install dependencies needed to download and extract PocketBase
RUN apk add --no-cache \
    ca-certificates \
    unzip \
    wget

# Pin to v0.21.3 to match the migration files (which use the Dao API removed in v0.23+)
ARG PB_VERSION=0.21.3

# Download PocketBase
RUN echo "Downloading PocketBase v${PB_VERSION}..." && \
    wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
        -O /tmp/pocketbase.zip && \
    unzip /tmp/pocketbase.zip -d /pb/ && \
    chmod +x /pb/pocketbase && \
    rm /tmp/pocketbase.zip

# Copy migrations into the container
COPY pb_migrations /pb/pb_migrations

# Expose PocketBase port
EXPOSE 8080

# Start PocketBase
# --http=0.0.0.0:8080  : listen on all interfaces, port 8080
# --dir=/pb/pb_data     : store data in the mounted volume
# --migrationsDir=/pb/pb_migrations : run migrations from copied folder
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations"]
