FROM node:22-bookworm-slim AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY svelte.config.js vite.config.ts tsconfig.json CHANGELOG.md ./
COPY scripts ./scripts
COPY static ./static
COPY src ./src
COPY src-tauri/installer ./src-tauri/installer
RUN npm run build

FROM rust:1.91.1-bookworm AS core
WORKDIR /src/src-tauri
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./
COPY src-tauri/core ./core
COPY src-tauri/agents ./agents
COPY src-tauri/server ./server
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs && echo 'fn main() {}' > build.rs \
 && cargo build --release --locked -p instantnotes-server

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=core /src/src-tauri/target/release/instantnotes-server /usr/local/bin/instantnotes
COPY --from=ui /src/build /app/ui
ENV INSTANTNOTES_LISTEN=0.0.0.0:8080 \
    INSTANTNOTES_DATA_DIR=/data \
    INSTANTNOTES_UI_DIR=/app/ui
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/instantnotes"]
CMD ["serve"]
