#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${project_dir}"

output_root="assets/optimized/v1"
mkdir -p "${output_root}/w480" "${output_root}/w960" "${output_root}/w1440"

jpeg_sources=(
  assets/books-hero-web.jpg
  assets/counseling-couple-01.jpg
  assets/counseling-couple-02.jpg
  assets/counseling-couple-03.jpg
  assets/counseling-couple-04.jpg
  assets/counseling-couple-05.jpg
  assets/counseling-group-01.jpg
  assets/counseling-group-02.jpg
  assets/counseling-group-03.jpg
  assets/counseling-group-04.jpg
  assets/counseling-group-05.jpg
  assets/counseling-reservation-web.jpg
  assets/lamp-man-light.jpg
  assets/lamp-man-together.jpg
  assets/place-hero-web.jpg
  assets/place-user-web.jpg
  assets/turkiye-before-departure-web.jpg
  assets/turkiye-contents-web.jpg
  assets/turkiye-hierapolis-web.jpg
  assets/turkiye-restaurants-web.jpg
  assets/turkiye-yeah-web.jpg
)

png_sources=(
  assets/counselor-portrait-v2.png
  assets/dangsin-ui-jjinmak.png
  assets/intothem-logo.png
  assets/jeongu-saram.png
  assets/nadasal-detail-flowers.png
  assets/nadasal-detail-house.png
  assets/nadasal-detail-last.png
  assets/nadasal-detail-rain.png
  assets/nadasal-detail-village.png
  assets/nadasal-detail-walkers.png
  assets/naneun-dasi-saraya-handa.png
  assets/oseonji-poem-20260819.png
  assets/turkiye-map.png
)

# Content images whose auto-oriented source width is at least approximately 1200px.
jpeg_sources_w1440=(
  assets/books-hero-web.jpg
  assets/counseling-couple-01.jpg
  assets/counseling-couple-02.jpg
  assets/counseling-couple-03.jpg
  assets/counseling-couple-05.jpg
  assets/counseling-group-01.jpg
  assets/counseling-group-02.jpg
  assets/counseling-group-03.jpg
  assets/counseling-group-04.jpg
  assets/counseling-group-05.jpg
  assets/counseling-reservation-web.jpg
  assets/lamp-man-light.jpg
  assets/lamp-man-together.jpg
  assets/place-hero-web.jpg
  assets/place-user-web.jpg
  assets/turkiye-before-departure-web.jpg
  assets/turkiye-contents-web.jpg
  assets/turkiye-hierapolis-web.jpg
  assets/turkiye-restaurants-web.jpg
  assets/turkiye-yeah-web.jpg
)

png_sources_w1440=(
  assets/nadasal-detail-flowers.png
  assets/nadasal-detail-house.png
  assets/nadasal-detail-last.png
  assets/nadasal-detail-rain.png
  assets/nadasal-detail-village.png
  assets/nadasal-detail-walkers.png
  assets/naneun-dasi-saraya-handa.png
)

if (( ${#jpeg_sources[@]} + ${#png_sources[@]} != 34 )); then
  echo "Expected 34 source images." >&2
  exit 1
fi

for source in "${jpeg_sources[@]}" "${png_sources[@]}"; do
  if [[ ! -f "${source}" ]]; then
    echo "Missing source image: ${source}" >&2
    exit 1
  fi
done

render_jpeg_batch() {
  local width="$1"
  local output_dir="$2"
  shift 2

  npx -y sharp-cli \
    -i "$@" \
    -o "${output_dir}" \
    resize "${width}" \
    --withoutEnlargement \
    --autoOrient \
    --format webp \
    --quality 80 \
    --effort 5
}

render_png_batch() {
  local width="$1"
  local output_dir="$2"
  shift 2

  npx -y sharp-cli \
    -i "$@" \
    -o "${output_dir}" \
    resize "${width}" \
    --withoutEnlargement \
    --autoOrient \
    --format webp \
    --quality 88 \
    --alphaQuality 90 \
    --effort 5
}

for width in 480 960; do
  render_jpeg_batch "${width}" "${output_root}/w${width}" "${jpeg_sources[@]}"
  render_png_batch "${width}" "${output_root}/w${width}" "${png_sources[@]}"
done

render_jpeg_batch 1440 "${output_root}/w1440" "${jpeg_sources_w1440[@]}"
render_png_batch 1440 "${output_root}/w1440" "${png_sources_w1440[@]}"

echo "Generated WebP variants in ${output_root}."
