# syntax=docker/dockerfile:1
FROM rust:1.98.0-bookworm

ARG DEBIAN_FRONTEND=noninteractive
ARG TAURI_CLI_VERSION=2.11.4

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eu; \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 update \
    && packages='libssl-dev libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev patchelf' \
    && apt-get --yes --no-install-recommends --print-uris install ${packages} \
        | sed -n "s/^'\\([^']*\\)' \\([^ ]*\\) .*/\\1 \\2/p" \
        | xargs --no-run-if-empty --max-procs=12 --max-args=2 \
            bash -c 'url="$1"; filename="$2"; destination="/var/cache/apt/archives/${filename}"; \
                if [[ -s "${destination}" ]]; then exit 0; fi; \
                curl --fail --location --retry 5 --retry-all-errors --silent --show-error \
                    --output "${destination}.partial" "${url}"; \
                mv "${destination}.partial" "${destination}"' _ \
    && apt-get install --yes --no-install-recommends ${packages}

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/tmp/tauri-cli-target,sharing=locked \
    CARGO_TARGET_DIR=/tmp/tauri-cli-target \
    cargo install tauri-cli --version "${TAURI_CLI_VERSION}" --locked

RUN rustup component add clippy rustfmt

ENV RUST_BACKTRACE=1
WORKDIR /workspace

CMD ["bash"]
