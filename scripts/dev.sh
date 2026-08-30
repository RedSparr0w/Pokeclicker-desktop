#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly IMAGE_NAME="pokeclicker-desktop-dev:rust-1.98-tauri-2.11"
readonly CURRENT_USER="$(id -un)"

docker_directly_available() {
    docker info >/dev/null 2>&1
}

user_is_in_docker_group() {
    local group_entry members
    group_entry="$(getent group docker 2>/dev/null || true)"
    members="${group_entry##*:}"
    [[ ",${members}," == *",${CURRENT_USER},"* ]]
}

run_docker() {
    if docker_directly_available; then
        docker "$@"
        return
    fi

    if command -v sg >/dev/null 2>&1 && user_is_in_docker_group; then
        local escaped
        printf -v escaped '%q ' docker "$@"
        sg docker -c "${escaped}"
        return
    fi

    echo "Docker is installed, but ${CURRENT_USER} cannot reach its daemon." >&2
    echo "Log out and back in after adding the user to the docker group, then retry." >&2
    exit 1
}

build_image() {
    run_docker build \
        --file "${PROJECT_ROOT}/docker/linux.Containerfile" \
        --tag "${IMAGE_NAME}" \
        "${PROJECT_ROOT}"
}

run_container() {
    local gui="${1}"
    shift

    mkdir -p \
        "${PROJECT_ROOT}/.cache/cargo" \
        "${PROJECT_ROOT}/.cache/home" \
        "${PROJECT_ROOT}/.cache/target"

    local -a arguments=(
        run --rm
        --security-opt label=disable
        --user "$(id -u):$(id -g)"
        --volume "${PROJECT_ROOT}:/workspace"
        --workdir /workspace
        --env CARGO_HOME=/workspace/.cache/cargo
        --env CARGO_TARGET_DIR=/workspace/.cache/target
        --env HOME=/workspace/.cache/home
        --env RUSTUP_HOME=/usr/local/rustup
    )

    if [[ -t 0 && -t 1 ]]; then
        arguments+=(--interactive --tty)
    fi

    for variable in \
        POKECLICKER_UPDATER_PUBKEY \
        POKECLICKER_UPDATER_ENDPOINT \
        TAURI_SIGNING_PRIVATE_KEY \
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD; do
        if [[ -n "${!variable:-}" ]]; then
            arguments+=(--env "${variable}")
        fi
    done

    if [[ "${gui}" == "gui" ]]; then
        if [[ -n "${DISPLAY:-}" ]]; then
            arguments+=(--env DISPLAY --volume /tmp/.X11-unix:/tmp/.X11-unix)

            # Wayland shells resolve taskbar icons through installed desktop
            # entries, which do not exist for a containerized dev binary.
            # XWayland can use the icon embedded directly in the window.
            if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
                arguments+=(--env GDK_BACKEND=x11)
            elif [[ -n "${GDK_BACKEND:-}" ]]; then
                arguments+=(--env GDK_BACKEND)
            fi
        fi
        if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${XDG_RUNTIME_DIR}" ]]; then
            arguments+=(--env XDG_RUNTIME_DIR --volume "${XDG_RUNTIME_DIR}:${XDG_RUNTIME_DIR}")
        fi
        for variable in WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS; do
            if [[ -n "${!variable:-}" ]]; then
                arguments+=(--env "${variable}")
            fi
        done
    fi

    run_docker "${arguments[@]}" "${IMAGE_NAME}" "$@"
}

usage() {
    cat <<'EOF'
Usage: ./scripts/dev.sh [command]

Commands:
  check      Format-check, lint, and test the workspace (default)
  test       Run the Rust tests
  dev        Launch the app against the host Linux desktop
  package    Build unsigned Linux .deb, .rpm, and AppImage packages
  release    Build signed updater artifacts (requires Tauri signing variables)
  shell      Open a development shell in the container
  image      Build only the development image
  run ...    Run an arbitrary command in the development container
EOF
}

command="${1:-check}"
if [[ $# -gt 0 ]]; then
    shift
fi

case "${command}" in
    check)
        build_image
        run_container headless bash -c \
            'cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace'
        ;;
    test)
        build_image
        run_container headless cargo test --workspace "$@"
        ;;
    dev)
        build_image
        run_container gui cargo tauri dev "$@"
        ;;
    package)
        build_image
        run_container headless cargo tauri build --bundles deb,rpm,appimage "$@"
        ;;
    release)
        build_image
        run_container headless cargo tauri build \
            --config src-tauri/tauri.release.conf.json "$@"
        ;;
    shell)
        build_image
        run_container gui bash "$@"
        ;;
    image)
        build_image
        ;;
    run)
        build_image
        run_container headless "$@"
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        echo "Unknown command: ${command}" >&2
        usage >&2
        exit 2
        ;;
esac
