FROM --platform=$BUILDPLATFORM alpine:latest AS certs

RUN apk add --no-cache ca-certificates

FROM --platform=$BUILDPLATFORM rust:alpine AS builder

ARG TARGETARCH

WORKDIR /app

RUN apk add --no-cache \
    build-base \
    perl \
    zig

RUN cargo install cargo-zigbuild --locked

RUN rustup target add \
    x86_64-unknown-linux-musl \
    aarch64-unknown-linux-musl \
    riscv64gc-unknown-linux-musl

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY schema ./schema

RUN set -eux; \
    case "$TARGETARCH" in \
    amd64) target="x86_64-unknown-linux-musl" ;; \
    arm64) target="aarch64-unknown-linux-musl" ;; \
    riscv64) target="riscv64gc-unknown-linux-musl" ;; \
    *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
    esac; \
    RUSTFLAGS="-C target-feature=+crt-static" \
    cargo zigbuild --release --locked --target "$target"; \
    mkdir -p /out; \
    cp "target/$target/release/subcon" /out/subcon

FROM --platform=$TARGETPLATFORM alpine:latest AS runtime-base

WORKDIR /app

COPY --from=certs /etc/ssl/certs/ /etc/ssl/certs/
COPY example/conf ./conf
COPY schema ./schema

EXPOSE 25500

ENTRYPOINT ["/usr/local/bin/subcon"]
CMD ["--pref", "conf/pref.toml"]

FROM runtime-base AS runtime-prebuilt

ARG BIN_PATH=dist/subcon

COPY ${BIN_PATH} /usr/local/bin/subcon

FROM runtime-base AS runtime

COPY --from=builder /out/subcon /usr/local/bin/subcon
