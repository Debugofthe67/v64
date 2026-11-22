// @ts-check
import { h } from "./dom.js";
import { bind_phone_touch } from "./phone_touch.js";
import { SYBORG_PROFILE } from "../../symbian/syborg_profile.js";
import { SYBORG_DEVICE } from "../../symbian/catalog.js";

const KEYBOARD = new Map([
    ["Enter", 0x03], ["NumpadEnter", 0x03], ["Backspace", 0x01], ["Escape", 0x04], ["Space", 0x05],
    ["ArrowLeft", 0x0E], ["ArrowRight", 0x0F], ["ArrowUp", 0x10], ["ArrowDown", 0x11],
    ["ShiftLeft", 0x12], ["ShiftRight", 0x13],
]);
for(const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") KEYBOARD.set("Key" + letter, letter.charCodeAt(0));
for(const digit of "0123456789")
{
    KEYBOARD.set("Digit" + digit, digit.charCodeAt(0));
    KEYBOARD.set("Numpad" + digit, digit.charCodeAt(0));
}

/**
 * @param {HTMLElement} screen
 * @param {(code: number, down: boolean) => void} send_key
 * @param {(x: number, y: number, down: boolean) => void} send_touch
 * @param {() => boolean} ready
 */
export function syborg_controls(screen, send_key, send_touch, ready)
{
    const { width, height } = SYBORG_PROFILE.screen;
    const { front, side, top } = SYBORG_DEVICE.controls;
    const stage = h("section.syborg-phone", { "aria-label": SYBORG_DEVICE.name + " controls" });
    screen.replaceWith(stage);
    screen.classList.add("syborg-touch-screen");
    screen.setAttribute("aria-label", SYBORG_DEVICE.name + " touchscreen");
    screen.tabIndex = 0;
    const controls = new AbortController();
    const listeners = { signal: controls.signal };
    const portrait = SYBORG_PROFILE.screen, landscape = { width: height, height: width };
    let clockwise = false;
    const display_size = () => clockwise ? landscape : portrait;
    const release_touch = bind_phone_touch(screen, display_size, (x, y) => clockwise ? [y, height - 1 - x] : [x, y],
        send_touch, ready, controls.signal);
    const releases = [release_touch];

    /** @param {{id: string, label: string, scan: number, min_press_ms?: number}} key */
    function control({ id, label, scan, min_press_ms = 0 })
    {
        const button = /** @type {HTMLButtonElement} */ (h("button.syborg-key", { type: "button", "data-key": id }, label));
        /** @type {number | null} */
        let pointer = null;
        let timer = 0, down = false, started = 0;
        const press = () => {
            if(down || !ready()) return false;
            down = true;
            started = performance.now();
            button.dataset.down = "true";
            send_key(scan, true);
            return true;
        };
        const release = () => {
            if(!down) return;
            down = false;
            clearTimeout(timer);
            delete button.dataset.down;
            const capture = pointer;
            pointer = null;
            send_key(scan, false);
            if(capture !== null && button.hasPointerCapture(capture)) button.releasePointerCapture(capture);
        };
        button.addEventListener("pointerdown", event => {
            if(event.button !== 0 || !press()) return;
            event.preventDefault();
            button.focus({ preventScroll: true });
            pointer = event.pointerId;
            try { button.setPointerCapture(pointer); }
            catch(error) { /* Synthetic events may have no pointer capture. */ }
        }, listeners);
        button.addEventListener("pointerup", event => {
            if(event.pointerId !== pointer) return;
            pointer = null;
            const wait = min_press_ms - (performance.now() - started);
            if(wait > 0) timer = window.setTimeout(release, wait);
            else release();
        }, listeners);
        for(const name of ["pointercancel", "lostpointercapture"])
            button.addEventListener(name, /** @param {PointerEvent} event */ event => { if(event.pointerId === pointer) release(); }, listeners);
        button.addEventListener("blur", release, listeners);
        button.addEventListener("click", event => {
            if(event.detail === 0 && press()) timer = window.setTimeout(release, Math.max(80, min_press_ms));
        }, listeners);
        releases.push(release);
        return button;
    }
    const side_keys = h("div.syborg-side", null, side.map(control));
    const body = h("div.syborg-body", null, screen, side_keys);
    stage.append(body, h("div.syborg-front", null, front.map(control)));

    // The display accepts a focused computer keyboard for guest apps that use
    // raw key input. The phone's on-screen keyboard is drawn by Symbian.
    const held = new Map();
    function release_keyboard()
    {
        for(const scan of new Set(held.values())) send_key(scan, false);
        held.clear();
    }
    screen.addEventListener("keydown", event => {
        const scan = KEYBOARD.get(event.code);
        if(scan === undefined || event.ctrlKey || event.metaKey || event.altKey || !ready()) return;
        event.preventDefault();
        if(held.has(event.code)) return;
        if(!Array.from(held.values()).includes(scan)) send_key(scan, true);
        held.set(event.code, scan);
    }, listeners);
    screen.addEventListener("keyup", event => {
        const scan = held.get(event.code);
        if(scan === undefined) return;
        event.preventDefault();
        held.delete(event.code);
        if(!Array.from(held.values()).includes(scan)) send_key(scan, false);
    }, listeners);
    screen.addEventListener("blur", release_keyboard, listeners);
    releases.push(release_keyboard);

    const release = () => { for(const up of releases) up(); };
    const doc = screen.ownerDocument;
    doc.defaultView.addEventListener("blur", release, listeners);
    doc.defaultView.addEventListener("pagehide", release, listeners);
    doc.addEventListener("visibilitychange", () => { if(doc.hidden) release(); }, listeners);

    let scale = 1;
    const set_scale = next => {
        scale = next;
        stage.style.setProperty("--syborg-screen-width", display_size().width * scale + "px");
    };
    return {
        release,
        dispose() { release(); controls.abort(); },
        top: top.map(control),
        select: control({ id: "select", label: "Open selected file", scan: 0x03 }),
        /** @param {0 | 90} angle */
        set_orientation(angle)
        {
            release_touch();
            clockwise = angle === 90;
            screen.toggleAttribute("data-landscape", clockwise);
            set_scale(scale);
        },
        set_scale,
        set_fit(room_width, room_height)
        {
            const side = side_keys.getBoundingClientRect().width;
            const frame = stage.getBoundingClientRect().height - body.getBoundingClientRect().height;
            const size = display_size();
            set_scale(Math.max(0.1, Math.min((room_width - side - 26) / size.width, (room_height - frame) / size.height)));
        },
    };
}
