use std::collections::VecDeque;
use std::ffi::CStr;
use std::os::raw::{c_int, c_long, c_uchar, c_uint, c_ulong};
use std::time::{Duration, Instant};
use x11::xlib::{self, Atom, Display, Window};

const ACTIVATION_TIMEOUT: Duration = Duration::from_millis(250);
const ACTIVATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SOURCE_INDICATION_PAGER: c_long = 2;

/// Activates the top-level window under the pointer and waits until the
/// window manager reports it active. Returns whether the active window changed.
///
/// A window vanishing mid-query raises BadWindow; inside the app, GDK's
/// process-wide X error handler ignores errors on displays it did not open,
/// so every call here is status-checked instead of aborting.
pub fn focus_window_under_pointer() -> Result<bool, String> {
    unsafe {
        let display = xlib::XOpenDisplay(std::ptr::null());
        if display.is_null() {
            return Err("failed to open X display".to_string());
        }
        let result = activate_client_under_pointer(display);
        xlib::XCloseDisplay(display);
        result
    }
}

unsafe fn activate_client_under_pointer(display: *mut Display) -> Result<bool, String> {
    let root = xlib::XDefaultRootWindow(display);
    let Some(top_level) = root_child_under_pointer(display, root) else {
        return Ok(false);
    };

    let wm_state = intern_atom(display, c"WM_STATE");
    let Some(client) = find_client_window(
        top_level,
        |window| has_property(display, window, wm_state),
        |window| child_windows(display, window),
    ) else {
        return Ok(false);
    };

    let net_active_window = intern_atom(display, c"_NET_ACTIVE_WINDOW");
    if active_window(display, root, net_active_window) == Some(client) {
        return Ok(false);
    }

    request_activation(display, root, client, net_active_window);

    let deadline = Instant::now() + ACTIVATION_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(ACTIVATION_POLL_INTERVAL);
        if active_window(display, root, net_active_window) == Some(client) {
            return Ok(true);
        }
    }
    Err(format!(
        "window manager did not activate window {client:#x} within {}ms",
        ACTIVATION_TIMEOUT.as_millis()
    ))
}

fn find_client_window<W: Copy>(
    top_level: W,
    has_wm_state: impl Fn(W) -> bool,
    children: impl Fn(W) -> Vec<W>,
) -> Option<W> {
    let mut queue = VecDeque::from([top_level]);
    while let Some(window) = queue.pop_front() {
        if has_wm_state(window) {
            return Some(window);
        }
        queue.extend(children(window));
    }
    None
}

unsafe fn intern_atom(display: *mut Display, name: &CStr) -> Atom {
    xlib::XInternAtom(display, name.as_ptr(), xlib::False)
}

unsafe fn root_child_under_pointer(display: *mut Display, root: Window) -> Option<Window> {
    let (mut root_return, mut child) = (0, 0);
    let (mut root_x, mut root_y, mut win_x, mut win_y) = (0, 0, 0, 0);
    let mut mask = 0;
    let on_this_screen = xlib::XQueryPointer(
        display,
        root,
        &mut root_return,
        &mut child,
        &mut root_x,
        &mut root_y,
        &mut win_x,
        &mut win_y,
        &mut mask,
    );
    (on_this_screen != xlib::False && child != 0).then_some(child)
}

unsafe fn read_property(
    display: *mut Display,
    window: Window,
    property: Atom,
    length: c_long,
    requested_type: Atom,
) -> Option<(Atom, c_int, Vec<c_ulong>)> {
    let mut actual_type: Atom = 0;
    let mut actual_format: c_int = 0;
    let mut item_count: c_ulong = 0;
    let mut bytes_after: c_ulong = 0;
    let mut data: *mut c_uchar = std::ptr::null_mut();
    let status = xlib::XGetWindowProperty(
        display,
        window,
        property,
        0,
        length,
        xlib::False,
        requested_type,
        &mut actual_type,
        &mut actual_format,
        &mut item_count,
        &mut bytes_after,
        &mut data,
    );
    if status != xlib::Success as c_int {
        return None;
    }
    let items = if data.is_null() {
        Vec::new()
    } else {
        let items = if actual_format == 32 {
            std::slice::from_raw_parts(data as *const c_ulong, item_count as usize).to_vec()
        } else {
            Vec::new()
        };
        xlib::XFree(data.cast());
        items
    };
    Some((actual_type, actual_format, items))
}

unsafe fn has_property(display: *mut Display, window: Window, property: Atom) -> bool {
    read_property(display, window, property, 0, xlib::AnyPropertyType as Atom)
        .is_some_and(|(actual_type, _, _)| actual_type != 0)
}

unsafe fn active_window(
    display: *mut Display,
    root: Window,
    net_active_window: Atom,
) -> Option<Window> {
    match read_property(display, root, net_active_window, 1, xlib::XA_WINDOW)? {
        (xlib::XA_WINDOW, 32, items) => items.first().copied(),
        _ => None,
    }
}

unsafe fn child_windows(display: *mut Display, window: Window) -> Vec<Window> {
    let (mut root, mut parent) = (0, 0);
    let mut children: *mut Window = std::ptr::null_mut();
    let mut child_count: c_uint = 0;
    let status = xlib::XQueryTree(
        display,
        window,
        &mut root,
        &mut parent,
        &mut children,
        &mut child_count,
    );
    if status == 0 || children.is_null() {
        return Vec::new();
    }
    let windows = std::slice::from_raw_parts(children, child_count as usize).to_vec();
    xlib::XFree(children.cast());
    windows
}

unsafe fn request_activation(
    display: *mut Display,
    root: Window,
    window: Window,
    net_active_window: Atom,
) {
    let mut event = xlib::XEvent::from(xlib::XClientMessageEvent {
        type_: xlib::ClientMessage,
        serial: 0,
        send_event: xlib::True,
        display,
        window,
        message_type: net_active_window,
        format: 32,
        data: xlib::ClientMessageData::from([
            SOURCE_INDICATION_PAGER,
            xlib::CurrentTime as c_long,
            0,
            0,
            0,
        ]),
    });
    xlib::XSendEvent(
        display,
        root,
        xlib::False,
        xlib::SubstructureRedirectMask | xlib::SubstructureNotifyMask,
        &mut event,
    );
    xlib::XFlush(display);
}

#[cfg(test)]
mod tests {
    use super::find_client_window;
    use std::collections::HashMap;

    fn search(tree: &[(u32, &[u32])], with_wm_state: &[u32], top_level: u32) -> Option<u32> {
        let children: HashMap<u32, Vec<u32>> = tree
            .iter()
            .map(|(parent, kids)| (*parent, kids.to_vec()))
            .collect();
        find_client_window(
            top_level,
            |window| with_wm_state.contains(&window),
            |window| children.get(&window).cloned().unwrap_or_default(),
        )
    }

    #[test]
    fn top_level_with_wm_state_is_its_own_client() {
        assert_eq!(search(&[(1, &[2])], &[1, 2], 1), Some(1));
    }

    #[test]
    fn finds_client_nested_inside_a_wm_frame() {
        let frame_tree: &[(u32, &[u32])] = &[(1, &[2]), (2, &[3, 4])];
        assert_eq!(search(frame_tree, &[4], 1), Some(4));
    }

    #[test]
    fn prefers_the_shallowest_client() {
        let tree: &[(u32, &[u32])] = &[(1, &[2, 3]), (2, &[4])];
        assert_eq!(search(tree, &[3, 4], 1), Some(3));
    }

    #[test]
    fn no_client_when_nothing_carries_wm_state() {
        assert_eq!(search(&[(1, &[2, 3])], &[], 1), None);
    }
}
