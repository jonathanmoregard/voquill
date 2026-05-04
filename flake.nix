{
  description = "Voquill desktop devShell (Tauri 2 + Rust + Node on NixOS)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    # Runtime libs the built Voquill binary loads via dlopen / unqualified
    # SONAME. Kept as a list so we can reuse it for both LD_LIBRARY_PATH
    # (dev shell) and any future buildInputs of a derivation.
    runtimeLibs = with pkgs; [
      webkitgtk_4_1
      gtk3
      gtk-layer-shell  # rust_gtk_pill overlay window
      libayatana-appindicator  # tray-icon dlopens libayatana-appindicator3.so.1
      glib
      libsoup_3
      librsvg
      gdk-pixbuf
      cairo
      pango
      atk
      harfbuzz
      openssl

      # audio (cpal / rodio / libpulse-binding)
      alsa-lib
      libpulseaudio

      # input / global hotkeys (rdev, enigo)
      xdotool          # provides libxdo.so.3
      libx11
      libxtst
      libxi
      libxrandr
      libxcursor
      libxcb
      libxkbcommon

      # wayland (arboard wayland-data-control feature)
      wayland

      # gpu (wgpu + whisper-rs vulkan sidecar)
      vulkan-loader
      vulkan-headers
      shaderc          # provides glslc for whisper.cpp ggml-vulkan build
      libGL
    ];

    # Build-time tools the cargo build needs to find headers / linkers.
    buildTools = with pkgs; [
      pkg-config
      rustc
      cargo
      rustfmt
      clippy
      gcc
      gnumake
      cmake
      # whisper-rs uses bindgen; bindgen calls libclang at compile time.
      # Only the lib is needed (LIBCLANG_PATH); we keep cc=gcc for compilation
      # so cc-rs gets a wrapper that knows the glibc include paths.
      llvmPackages.libclang
      nodejs_22
      pnpm
    ];
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = buildTools ++ runtimeLibs;

      # tauri-build / build.rs need PKG_CONFIG_PATH for webkit2gtk + soup.
      # Set explicitly because nix's mkShell only wires it up for buildInputs,
      # and we are using `packages` so the libs land on PATH but not in the
      # pkg-config search path automatically.
      shellHook = ''
        export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPath "lib/pkgconfig" runtimeLibs}:''${PKG_CONFIG_PATH:-}"
        export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtimeLibs}:''${LD_LIBRARY_PATH:-}"
        export LIBCLANG_PATH="${pkgs.llvmPackages.libclang.lib}/lib"
        # Force gcc as the C/C++ compiler so cc-rs gets the Nix-wrapped one
        # that knows about glibc headers (bare clang from llvmPackages does not).
        export CC=${pkgs.gcc}/bin/gcc
        export CXX=${pkgs.gcc}/bin/g++
        # webkit2gtk DMA-BUF renderer crashes on some drivers; force the
        # legacy compositing renderer for stability inside Tauri.
        export WEBKIT_DISABLE_DMABUF_RENDERER=1
      '';
    };
  };
}
