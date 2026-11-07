{ lib
, stdenv
, rustPlatform
, fetchPnpmDeps
, pnpmConfigHook
, pnpm
, nodejs_22
, pkg-config
, makeWrapper
, wrapGAppsHook3
, cargo
, rustc
, glib-networking
  # runtime / link libs
, webkitgtk_4_1
, gtk3
, gtk-layer-shell
, libayatana-appindicator
, glib
, libsoup_3
, librsvg
, gdk-pixbuf
, cairo
, pango
, atk
, harfbuzz
, openssl
, alsa-lib
, libpulseaudio
, xdotool
, wtype
, libx11
, libxtst
, libxi
, libxrandr
, libxcursor
, libxcb
, libxkbcommon
, wayland
, vulkan-loader
, libGL
  # prebuilt pieces
, gtk-pill
, transcription-cpu
  # Omitted by default: the Vulkan backend registers no GPU devices, so the
  # binary exits 1 on spawn (src/bin/gpu.rs) and the frontend falls back to the
  # CPU sidecar anyway. Pass a derivation to put it back in the bundle.
, transcription-gpu ? null
, jq
}:

let
  targetTriple = "x86_64-unknown-linux-gnu";

  # tauri.local.conf.json's productName. Tauri derives PackageInfo.name from it
  # (tauri-codegen context.rs), and resource_dir() is built from that name, so
  # the installed layout below has to spell it exactly.
  productName = "Voquill (local)";

  sidecars = [ { name = "rust-transcription-cpu"; drv = transcription-cpu; } ]
    ++ lib.optional (transcription-gpu != null)
      { name = "rust-transcription-gpu"; drv = transcription-gpu; };

  # Libraries the binary resolves by unqualified SONAME or dlopen, so they
  # must be on LD_LIBRARY_PATH at runtime rather than only in the RPATH.
  dlopenLibs = [
    webkitgtk_4_1
    gtk3
    gtk-layer-shell
    libayatana-appindicator
    glib
    libsoup_3
    librsvg
    gdk-pixbuf
    cairo
    pango
    atk
    harfbuzz
    openssl
    alsa-lib
    libpulseaudio
    xdotool
    libx11
    libxtst
    libxi
    libxrandr
    libxcursor
    libxcb
    libxkbcommon
    wayland
    vulkan-loader
    libGL
  ];
in
stdenv.mkDerivation (finalAttrs: {
  pname = "voquill";
  version = "0.1.0";

  src = ../.;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 2;
    hash = "sha256-3MHukVVi2jKCtU7GMBQgow2Rcu0Ot+veHLK1c++fcuM=";
  };

  cargoDeps = rustPlatform.importCargoLock {
    lockFile = ../apps/desktop/src-tauri/Cargo.lock;
    outputHashes = {
      "ferrous-focus-0.4.1" = "sha256-r2S76pQXfA7BMFVfueB9mesPcJu6Ejv3trZx/9c8ldQ=";
      "rdev-0.5.0-2" = "sha256-ubO66nZawEjU8pnQnfXHTVcfnDJ51IOFPsAxqp8NnkE=";
    };
  };

  cargoRoot = "apps/desktop/src-tauri";

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
    rustPlatform.cargoSetupHook
    cargo
    rustc
    pkg-config
    makeWrapper
    wrapGAppsHook3
    jq
  ];

  buildInputs = dlopenLibs ++ [ glib-networking ];

  # The GTK wrapper args are applied to the wrapper we build by hand in
  # installPhase, since the real executable must stay where Tauri's relative
  # lookups expect it.
  dontWrapGApps = true;

  env = {
    # pnpm refuses to run when the packageManager pin differs from the pnpm in
    # scope; nixpkgs' pnpm is close but not identical.
    COREPACK_ENABLE_STRICT = "0";
    # webkit2gtk's DMA-BUF renderer crashes on some drivers.
    WEBKIT_DISABLE_DMABUF_RENDERER = "1";
  };

  buildPhase = ''
    runHook preBuild

    # Compile-time OAuth credentials come from the repo's own env file, which is
    # what the upstream build script does. option_env! bakes them in; without
    # them the app falls back to reading .env at runtime.
    set -a
    . apps/desktop/.env.prod
    set +a

    # Tauri's externalBin entries must exist, target-triple suffixed, before the
    # build runs. We supply prebuilt sidecars instead of letting the repo's
    # wrapper cargo-build them from their own separate lockfiles.
    mkdir -p apps/desktop/src-tauri/binaries
    ${lib.concatMapStrings (s: ''
      cp ${s.drv}/bin/${s.name} \
        "apps/desktop/src-tauri/binaries/${s.name}-${targetTriple}"
    '') sidecars}

    mkdir -p apps/desktop/src-tauri/resources
    cp ${gtk-pill}/bin/voquill-gtk-pill apps/desktop/src-tauri/resources/voquill-gtk-pill
    chmod +w apps/desktop/src-tauri/binaries/* apps/desktop/src-tauri/resources/*

    # The desktop app's tsc resolves @voquill/* to each workspace package's
    # dist/, so the workspace packages have to be built first; pnpm walks them
    # in topological order. Filtering by path rather than by dependency-graph
    # selector because the latter silently matched nothing.
    pnpm --filter "./packages/**" run build

    # A filter that matches nothing exits 0, which would otherwise resurface far
    # downstream as hundreds of TS2307 "cannot find module" lines.
    test -d packages/types/dist || {
      echo "workspace dependencies did not build; check the pnpm filter" >&2
      exit 1
    }

    cd apps/desktop

    # Every externalBin entry must exist before the build runs, so the list has
    # to name exactly the sidecars copied above rather than the base config's
    # pair. --config is merge-patched over tauri.conf.json, and a patched array
    # replaces the original wholesale rather than appending to it.
    jq --argjson bins ${lib.escapeShellArg (builtins.toJSON (map (s: "binaries/${s.name}") sidecars))} \
      '.bundle.externalBin = $bins' \
      src-tauri/tauri.local.conf.json > src-tauri/tauri.nix.conf.json

    # Call the repo's own Tauri CLI directly rather than through the `tauri`
    # package script, which would re-build the sidecars we just supplied.
    # The generated config inherits productName/identifier from
    # tauri.local.conf.json, so this build keeps the user's existing data
    # directory (com.voquill.desktop.local).
    node_modules/.bin/tauri build \
      --no-bundle \
      --config src-tauri/tauri.nix.conf.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # Layout dictated by Tauri's own lookups, both relative to the REAL
    # executable's directory (tauri-utils platform.rs / tauri-plugin-shell
    # relative_command_path):
    #   resource_dir() = <exe_dir>/../lib/<productName>   (must exist; it is
    #                    canonicalize()d, and the fallback is /usr/lib/<name>)
    #   sidecar        = <exe_dir>/binaries/<name>
    #   .env           = <exe_dir>/.env.<flavor>          (flavor_env.rs)
    # $out/bin therefore holds only the wrapper.
    bindir="$out/libexec/voquill/bin"
    resdir="$out/libexec/voquill/lib/${productName}"
    mkdir -p "$bindir" "$resdir" "$out/bin"

    install -Dm755 "src-tauri/target/release/${productName}" "$bindir/${productName}"

    cp -r src-tauri/resources "$resdir/resources"
    cp -r src-tauri/binaries "$bindir/binaries"
    chmod -R u+w "$resdir" "$bindir"

    # The frontend asks for the plain sidecar name; the build produces
    # triple-suffixed files, which the bundler-made layout also keeps.
    for f in "$bindir"/binaries/*-${targetTriple}; do
      ln -s "$(basename "$f")" "''${f%-${targetTriple}}"
    done

    # flavor_env.rs searches the executable's directory first; its only other
    # candidate is a build-time source path that does not exist in the store.
    cp .env.prod "$bindir/.env.prod"
    cp .env.dev "$bindir/.env.dev"

    # Ship the icons so a desktop entry can reference them by name instead of
    # pointing into the user's source checkout.
    install -Dm644 src-tauri/icons/128x128.png \
      "$out/share/icons/hicolor/128x128/apps/voquill.png"
    install -Dm644 src-tauri/icons/32x32.png \
      "$out/share/icons/hicolor/32x32/apps/voquill.png"

    makeWrapper "$bindir/${productName}" "$out/bin/voquill" \
      "''${gappsWrapperArgs[@]}" \
      --prefix PATH : "${lib.makeBinPath [ xdotool wtype ]}" \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath dlopenLibs}" \
      --set WEBKIT_DISABLE_DMABUF_RENDERER 1

    runHook postInstall
  '';

  meta = {
    description = "Voquill voice-typing desktop app";
    mainProgram = "voquill";
    platforms = [ "x86_64-linux" ];
  };
})
