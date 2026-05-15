#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Download the recommended LaMa ONNX model into local-models.

Usage:
  ./scripts/fetch-model.sh
  ./scripts/fetch-model.sh --output local-models/lama_fp32.onnx

Options:
  -o, --output PATH   Override output path.
  -h, --help          Show this help message.
EOF
}

output_path="local-models/lama_fp32.onnx"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output)
      shift
      output_path="${1:-}"
      if [[ -z "$output_path" ]]; then
        echo "missing value for --output" >&2
        exit 1
      fi
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

mkdir -p "$(dirname "$output_path")"
curl -L "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx" -o "$output_path"
echo "saved $output_path"
