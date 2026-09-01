#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly IMAGE_NAME="pokeclicker-desktop-dev:node-24-electron-44"
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
        "${PROJECT_ROOT}/.cache/electron" \
        "${PROJECT_ROOT}/.cache/electron-builder" \
        "${PROJECT_ROOT}/.cache/home" \
        "${PROJECT_ROOT}/.cache/npm" \
        "${PROJECT_ROOT}/.cache/xdg"

    local -a arguments=(
        run --rm --init
        --shm-size=1g
        --security-opt label=disable
        --user "$(id -u):$(id -g)"
        --volume "${PROJECT_ROOT}:/workspace"
        --workdir /workspace
        --env ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder
        --env ELECTRON_CACHE=/workspace/.cache/electron
        --env HOME=/workspace/.cache/home
        --env npm_config_cache=/workspace/.cache/npm
        --env XDG_CACHE_HOME=/workspace/.cache/xdg
        --env XDG_CONFIG_HOME=/workspace/.cache/config
    )

    if [[ -t 0 && -t 1 ]]; then
        arguments+=(--interactive --tty)
    fi

    if [[ "${gui}" == "gui" ]]; then
        arguments+=(--ipc=host)

        if [[ -n "${DISPLAY:-}" ]]; then
            arguments+=(--env DISPLAY --volume /tmp/.X11-unix:/tmp/.X11-unix)
        fi
        if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${XDG_RUNTIME_DIR}" ]]; then
            arguments+=(
                --env XDG_RUNTIME_DIR
                --volume "${XDG_RUNTIME_DIR}:${XDG_RUNTIME_DIR}"
            )
        fi
        for variable in WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS; do
            if [[ -n "${!variable:-}" ]]; then
                arguments+=(--env "${variable}")
            fi
        done

        if [[ -d /dev/dri ]]; then
            arguments+=(--device /dev/dri)
            while IFS= read -r group_id; do
                arguments+=(--group-add "${group_id}")
            done < <(stat --format='%g' /dev/dri/* | sort --unique)
        fi
    fi

    run_docker "${arguments[@]}" "${IMAGE_NAME}" "$@"
}

ensure_dependencies='if [[ ! -x node_modules/.bin/electron ]]; then npm ci; fi'

usage() {
    cat <<'EOF'
Usage: ./scripts/dev.sh [command]

Commands:
  install    Install the locked dependencies (default)
  check      Run lint and unit tests
  dev        Launch the app against the host Linux desktop
  package    Build unsigned Linux AppImage, .deb, and .rpm packages
  shell      Open a development shell in the container
  image      Build only the development image
  run ...    Run an arbitrary command in the development container
EOF
}

command="${1:-install}"
if [[ $# -gt 0 ]]; then
    shift
fi

case "${command}" in
    install)
        build_image
        run_container headless npm ci "$@"
        ;;
    check)
        build_image
        run_container headless bash -c "${ensure_dependencies}; npm run check" -- "$@"
        ;;
    dev)
        build_image
        run_container gui bash -c \
            "${ensure_dependencies}; npm start -- --no-sandbox --ozone-platform-hint=auto \"\$@\"" \
            -- "$@"
        ;;
    package)
        build_image
        run_container headless bash -c \
            "${ensure_dependencies}; npm run dist:linux -- \"\$@\"" \
            -- "$@"
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
