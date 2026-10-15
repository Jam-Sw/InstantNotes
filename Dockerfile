FROM --platform=$BUILDPLATFORM rust:1.91.1-trixie AS web
RUN apt-get update && apt-get install -y --no-install-recommends clang && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
WORKDIR /src
COPY src-tauri/Cargo.lock /tmp/Cargo.lock
RUN cargo install wasm-bindgen-cli --locked --version \
    "$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/[^0-9.]/, ""); print; exit }' /tmp/Cargo.lock)"
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
COPY src-tauri/core ./src-tauri/core
COPY src-tauri/agents ./src-tauri/agents
COPY src-tauri/server ./src-tauri/server
COPY src-tauri/web ./src-tauri/web
COPY scripts/build-web-core.sh ./scripts/
RUN mkdir -p src-tauri/src static/web && echo 'fn main() {}' > src-tauri/src/main.rs \
 && touch src-tauri/src/lib.rs && echo 'fn main() {}' > src-tauri/build.rs \
 && scripts/build-web-core.sh

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY svelte.config.js vite.config.ts tsconfig.json CHANGELOG.md ./
COPY scripts ./scripts
COPY static ./static
COPY --from=web /src/static/web/pkg ./static/web/pkg
COPY src ./src
COPY src-tauri/installer ./src-tauri/installer
RUN npm run build

FROM --platform=$BUILDPLATFORM rust:1.91.1-bookworm AS core
ARG TARGETARCH
ARG BUILDARCH
RUN case "$TARGETARCH" in amd64) gnu=x86-64-linux-gnu; triple=x86_64-unknown-linux-gnu ;; arm64) gnu=aarch64-linux-gnu; triple=aarch64-unknown-linux-gnu ;; *) exit 1 ;; esac \
 && if [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      apt-get update && apt-get install -y --no-install-recommends "gcc-$gnu" "libc6-dev-$TARGETARCH-cross" && rm -rf /var/lib/apt/lists/*; \
    fi \
 && rustup target add "$triple" \
 && echo "$triple" > /tmp/triple
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
WORKDIR /src/src-tauri
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./
COPY src-tauri/core ./core
COPY src-tauri/agents ./agents
COPY src-tauri/server ./server
COPY src-tauri/web ./web
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs && echo 'fn main() {}' > build.rs \
 && cargo build --release --locked -p instantnotes-server --target "$(cat /tmp/triple)" \
 && cp "target/$(cat /tmp/triple)/release/instantnotes-server" /tmp/instantnotes-server

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.title="InstantNotes server" \
      org.opencontainers.image.description="Self-hosted sync for InstantNotes: end-to-end encrypted sync for the desktop apps and the web app, sign-in through your own identity provider." \
      org.opencontainers.image.source="https://github.com/Jam-Sw/InstantNotes" \
      org.opencontainers.image.url="https://github.com/Jam-Sw/InstantNotes#self-hosted-sync" \
      org.opencontainers.image.documentation="https://github.com/Jam-Sw/InstantNotes#self-hosted-sync" \
      org.opencontainers.image.licenses="PolyForm-Strict-1.0.0" \
      org.opencontainers.image.vendor="Jam-Sw"
COPY --from=core /tmp/instantnotes-server /usr/local/bin/instantnotes
COPY --from=ui /src/build /app/ui
ENV INSTANTNOTES_LISTEN=0.0.0.0:8080 \
    INSTANTNOTES_DATA_DIR=/data \
    INSTANTNOTES_UI_DIR=/app/ui
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/instantnotes"]
CMD ["serve"]
