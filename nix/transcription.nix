{ lib
, rustPlatform
, pkg-config
, cmake
, git
, vulkan-loader
, vulkan-headers
, shaderc
, gpu ? false
}:

let
  variant = if gpu then "gpu" else "cpu";
  binName = "rust-transcription-${variant}";
in
rustPlatform.buildRustPackage {
  pname = "voquill-transcription-${variant}";
  version = "0.1.0";

  src = ../packages/rust_transcription;
  cargoLock.lockFile = ../packages/rust_transcription/Cargo.lock;

  nativeBuildInputs = [
    pkg-config
    cmake
    # ggml's CMakeLists does a REQUIRED find_program for git to stamp build
    # info; without it configure aborts before any compilation.
    git
    # whisper-rs-sys runs bindgen; without LIBCLANG_PATH and the glibc/clang
    # include paths it falls back to bundled bindings that lack the Vulkan
    # symbols, so the GPU backend silently degrades.
    rustPlatform.bindgenHook
  ] ++ lib.optionals gpu [ shaderc ];

  buildInputs = lib.optionals gpu [ vulkan-loader vulkan-headers ];

  # whisper-rs-sys drives whisper.cpp's own cmake from build.rs. The generic
  # cmake configure phase would try to configure the crate root and fail.
  dontUseCmakeConfigure = true;

  buildFeatures = lib.optionals gpu [ "gpu-vulkan" ];

  cargoBuildFlags = [ "--bin" binName ];
  # The gpu binary is gated behind required-features, so an unfiltered test
  # build would fail to select it.
  cargoTestFlags = [ "--bin" binName ];

  meta = {
    description = "Voquill transcription sidecar (${lib.toUpper variant})";
    mainProgram = binName;
    platforms = lib.platforms.linux;
  };
}
