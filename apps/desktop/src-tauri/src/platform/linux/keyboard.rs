pub fn run_listener_process() -> Result<(), String> {
    if super::detect::is_wayland() {
        return Ok(());
    }
    super::x11::keyboard::run_listener_process()
}

/// Re-queries the X server for the set of physically held keys.
///
/// Used when the key listener state is reset: instead of assuming nothing is
/// held, repopulate from the real keyboard state so a key held across the
/// reset (e.g. a new dictation hold that started while the previous stop
/// pipeline was finishing) isn't lost until re-press.
///
/// Labels are derived from the same rdev keycode table the listener uses, so
/// they match the labels the pressed-keys set is built from.
///
/// Returns `None` when the state can't be queried (Wayland, no X display).
pub fn query_physically_held_keys() -> Option<Vec<String>> {
    if super::detect::is_wayland() {
        return None;
    }

    let mut labels = Vec::new();
    unsafe {
        let display = x11::xlib::XOpenDisplay(std::ptr::null());
        if display.is_null() {
            return None;
        }

        let mut keymap = [0i8; 32];
        x11::xlib::XQueryKeymap(display, keymap.as_mut_ptr());
        x11::xlib::XCloseDisplay(display);

        for keycode in 8u32..256 {
            let byte = keymap[(keycode / 8) as usize] as u8;
            if byte & (1 << (keycode % 8)) == 0 {
                continue;
            }
            let key = rdev::key_from_code(keycode);
            labels.push(crate::platform::keyboard::key_to_label(key));
        }
    }
    Some(labels)
}
