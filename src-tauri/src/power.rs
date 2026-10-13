//! Native macOS sleep notifications. The registration and run loop live on one
//! process-scoped thread; the callback context stays on its stack until cleanup.
use std::ffi::c_void;
use tauri::AppHandle;

const CAN_SLEEP: u32 = 0xe000_0270;
const WILL_SLEEP: u32 = 0xe000_0280;
const DID_WAKE: u32 = 0xe000_0300;

type Callback = unsafe extern "C" fn(*mut c_void, u32, u32, *mut c_void);

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IORegisterForSystemPower(
        context: *mut c_void,
        port: *mut *mut c_void,
        callback: Callback,
        notifier: *mut u32,
    ) -> u32;
    fn IONotificationPortGetRunLoopSource(port: *mut c_void) -> *mut c_void;
    fn IOAllowPowerChange(port: u32, notification_id: isize) -> i32;
    fn IODeregisterForSystemPower(notifier: *mut u32) -> i32;
    fn IONotificationPortDestroy(port: *mut c_void);
    fn IOServiceClose(port: u32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: *const c_void;
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopAddSource(run_loop: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopRemoveSource(run_loop: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopRun();
}

struct Context {
    app: AppHandle,
    root_port: u32,
}

unsafe extern "C" fn on_power(context: *mut c_void, _: u32, message: u32, argument: *mut c_void) {
    // SAFETY: context belongs to the registration thread and outlives its run loop.
    let context = &*(context as *const Context);
    match message {
        WILL_SLEEP => {
            crate::pause_for_system_sleep(&context.app);
            // Acknowledge sleep; Rested must never prevent the Mac from sleeping.
            IOAllowPowerChange(context.root_port, argument as isize);
        }
        CAN_SLEEP => {
            IOAllowPowerChange(context.root_port, argument as isize);
        }
        DID_WAKE => crate::reset_after_wake(&context.app),
        _ => {}
    }
}

pub fn watch(app: AppHandle) {
    if let Err(error) = std::thread::Builder::new().name("rested-power".into()).spawn(move || {
        let mut context = Context { app, root_port: 0 };
        let mut port = std::ptr::null_mut();
        let mut notifier = 0;
        // SAFETY: all out-pointers are valid, and all IOKit/CF objects are used and
        // released on this thread. `context` is not moved while callbacks are registered.
        unsafe {
            context.root_port = IORegisterForSystemPower(
                &mut context as *mut Context as *mut c_void,
                &mut port,
                on_power,
                &mut notifier,
            );
            if context.root_port == 0 || port.is_null() {
                eprintln!("Native sleep observer unavailable; the clock-gap safeguard remains active.");
                return;
            }
            let source = IONotificationPortGetRunLoopSource(port);
            if !source.is_null() {
                let run_loop = CFRunLoopGetCurrent();
                CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                CFRunLoopRun();
                CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
            }
            IODeregisterForSystemPower(&mut notifier);
            IONotificationPortDestroy(port);
            IOServiceClose(context.root_port);
        }
    }) {
        eprintln!("Could not start the sleep observer: {error}");
    }
}
