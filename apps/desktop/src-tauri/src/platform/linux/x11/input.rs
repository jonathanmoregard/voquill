use crate::platform::paste_keybind::{parse_paste_keystroke, PasteKeystroke};
use enigo::{Enigo, Key, KeyboardControllable};
use std::process::Command;
use std::sync::Mutex;
use std::{thread, time::Duration};

static CLIPBOARD_HOLD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

pub fn paste_text(text: &str, keybind: Option<&str>) -> Result<(), String> {
    paste_via_clipboard(text, keybind).or_else(|err| {
        log::warn!("Clipboard paste failed ({err}), falling back to simulated typing");
        enigo_type_text(text)
    })
}

fn enigo_type_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new();
    release_stuck_modifiers_if_safe(&mut enigo);
    enigo.key_sequence(text);
    Ok(())
}

/// Releases possibly-stuck modifiers before injecting input, but only when
/// the key listener sees nothing physically held. Synthesizing a modifier
/// release while the user is mid-hold (e.g. a new dictation hold that began
/// while the previous transcript was still being pasted) would end that hold.
fn release_stuck_modifiers_if_safe(enigo: &mut Enigo) {
    if crate::platform::keyboard::any_keys_currently_pressed() {
        log::debug!("Skipping pre-paste modifier release: keys are physically held");
        return;
    }
    enigo.key_up(Key::Shift);
    enigo.key_up(Key::Control);
    enigo.key_up(Key::Alt);
    thread::sleep(Duration::from_millis(30));
}

fn xdotool_available() -> bool {
    Command::new("xdotool")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn xdotool_key(combo: &str, clear_modifiers: bool) -> Result<(), String> {
    let mut command = Command::new("xdotool");
    command.arg("key");
    if clear_modifiers {
        command.arg("--clearmodifiers");
    }
    let output = command
        .arg(combo)
        .output()
        .map_err(|err| format!("xdotool failed: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "xdotool exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn simulate_paste_keystroke(style: PasteKeystroke) -> Result<(), String> {
    // `--clearmodifiers` synthesizes release events for any modifier that is
    // physically held, which would end an active hotkey hold. The injected
    // combo presses its own modifiers, so clearing is only kept as
    // stuck-modifier insurance when nothing is physically held (where it is
    // effectively a no-op safety net).
    let clear_modifiers = !crate::platform::keyboard::any_keys_currently_pressed();

    if xdotool_available() {
        let combo = match style {
            PasteKeystroke::CtrlV => "ctrl+v",
            PasteKeystroke::CtrlShiftV => "ctrl+shift+v",
            PasteKeystroke::ShiftInsert => "shift+Insert",
        };
        log::info!(
            "Using xdotool for paste keystroke ({combo}, clear_modifiers={clear_modifiers})"
        );
        return xdotool_key(combo, clear_modifiers);
    }

    log::info!("xdotool not available, falling back to enigo");
    enigo_paste_keystroke(style)
}

fn enigo_paste_keystroke(style: PasteKeystroke) -> Result<(), String> {
    let mut enigo = Enigo::new();
    release_stuck_modifiers_if_safe(&mut enigo);

    match style {
        PasteKeystroke::CtrlV => {
            enigo.key_down(Key::Control);
            enigo.key_down(Key::Layout('v'));
            thread::sleep(Duration::from_millis(15));
            enigo.key_up(Key::Layout('v'));
            enigo.key_up(Key::Control);
        }
        PasteKeystroke::CtrlShiftV => {
            enigo.key_down(Key::Control);
            enigo.key_down(Key::Shift);
            enigo.key_down(Key::Layout('v'));
            thread::sleep(Duration::from_millis(15));
            enigo.key_up(Key::Layout('v'));
            enigo.key_up(Key::Shift);
            enigo.key_up(Key::Control);
        }
        PasteKeystroke::ShiftInsert => {
            enigo.key_down(Key::Shift);
            enigo.key_down(Key::Insert);
            thread::sleep(Duration::from_millis(15));
            enigo.key_up(Key::Insert);
            enigo.key_up(Key::Shift);
        }
    }
    Ok(())
}

fn paste_via_clipboard(text: &str, keybind: Option<&str>) -> Result<(), String> {
    let style = parse_paste_keystroke(keybind);
    let mut clipboard =
        arboard::Clipboard::new().map_err(|err| format!("clipboard unavailable: {err}"))?;
    let previous = crate::platform::SavedClipboard::save(&mut clipboard);
    clipboard
        .set_text(text.to_string())
        .map_err(|err| format!("failed to store clipboard text: {err}"))?;

    {
        let mut hold = CLIPBOARD_HOLD.lock().unwrap_or_else(|p| p.into_inner());
        *hold = Some(clipboard);
    }

    thread::sleep(Duration::from_millis(40));

    simulate_paste_keystroke(style)?;

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(800));
        let mut hold = CLIPBOARD_HOLD.lock().unwrap_or_else(|p| p.into_inner());
        *hold = None;
        previous.restore();
    });

    Ok(())
}
