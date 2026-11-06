{ lib
, rustPlatform
, pkg-config
, glib
, gtk3
, gtk-layer-shell
, pango
, cairo
, atk
, gdk-pixbuf
, harfbuzz
}:

rustPlatform.buildRustPackage {
  pname = "voquill-gtk-pill";
  version = "0.1.0";

  src = ../packages/rust_gtk_pill;
  cargoLock.lockFile = ../packages/rust_gtk_pill/Cargo.lock;

  nativeBuildInputs = [ pkg-config ];

  buildInputs = [
    glib
    gtk3
    gtk-layer-shell
    pango
    cairo
    atk
    gdk-pixbuf
    harfbuzz
  ];

  meta = {
    description = "Voquill GTK pill overlay for Wayland (layer-shell)";
    mainProgram = "voquill-gtk-pill";
    platforms = lib.platforms.linux;
  };
}
