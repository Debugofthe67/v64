// @ts-check
import { N97_KEY_CODES } from "../../symbian/n97_keymap.js";
import { h } from "./dom.js";

// Physical layout in the RM-505 schematic, switch positions S200–S237.
const rows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "Backspace"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Comma", "Enter"],
    ["Shift", "Z", "X", "C", "V", "B", "N", "M", "Space", "Chr", "Fn"],
];
const rocker = ["Up", "Left", "Select", "Right", "Down"];
const front_keys = ["Send", "Menu", "End"];
const side_keys = ["Lock", "VolumeDown", "VolumeUp", "CameraFocus", "CameraShutter"];
const outer_keys = [...front_keys, ...side_keys];
/** @type {Map<string, "send" | "end" | "lock">} */
const panel_controls = new Map([["Send", "send"], ["End", "end"], ["Lock", "lock"]]);
const labels = {
    Backspace: "⌫", Comma: ",", Left: "←", Up: "↑", Down: "↓", Right: "→", Select: "●",
    Shift: "⇧", Enter: "↵", VolumeDown: "Vol −", VolumeUp: "Vol +", CameraFocus: "Focus", CameraShutter: "Shutter",
};
/** @type {Record<string, string>} */
const shortcuts = {
    Backspace: "Backspace", Enter: "Enter", Space: "Space", Comma: "Comma",
    ShiftLeft: "Shift", ShiftRight: "Shift", Backquote: "Select",
    ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
    F2: "Fn", F3: "Chr", ContextMenu: "Menu", AudioVolumeDown: "VolumeDown",
    AudioVolumeUp: "VolumeUp", F7: "CameraFocus", F8: "CameraShutter",
    Home: "Send", End: "End", F4: "Lock",
};

/**
 * @param {(code: number, pressed: boolean) => void} send
 * @param {(control: "send" | "end" | "lock", pressed: boolean) => void} send_control
 * @param {(open: boolean) => void} move_slider
 */
export function n97_keyboard_panel(send, send_control, move_slider)
{
    const panel = h("div.n97-keyboard#n97_keyboard", { tabindex: 0, role: "group", "aria-label": "Nokia N97 controls" });
    let slide_open = false;
    const slider = h("button#n97_slider", { type: "button", onclick: () => {
        set_slider(!slide_open);
        move_slider(slide_open);
        panel.focus({ preventScroll: true });
    } });
    const keypad = h("div.n97-slide-keys", { hidden: true });
    panel.append(slider, keypad);
    keypad.append(h("p.note", null, "Type with the keyboard focused. F2 is Fn, F3 is Chr, and Backquote is Select."));
    /** @type {Map<string, string[]>} */
    const held = new Map();
    /** @type {Map<string, number>} */
    const counts = new Map();
    /** @type {Map<string, HTMLElement>} */
    const buttons = new Map();
    /** @param {string} key @param {boolean} down */
    function contact(key, down)
    {
        const before = counts.get(key) || 0, count = before + (down ? 1 : -1);
        if(count > 0) counts.set(key, count);
        else counts.delete(key);
        if((before === 0) !== (count === 0))
        {
            const code = N97_KEY_CODES.get(key);
            const control = panel_controls.get(key);
            if(code !== undefined) send(code, !!count);
            else if(control !== undefined) send_control(control, !!count);
            buttons.get(key)?.setAttribute("aria-pressed", String(!!count));
        }
    }
    /** @param {string} source @param {string} key */
    function press(source, key)
    {
        if(held.has(source) || !slide_open && !outer_keys.includes(key)) return;
        const keys = key === "CameraShutter" ? ["CameraFocus", key] : [key];
        held.set(source, keys);
        keys.forEach(key => contact(key, true));
    }
    /** @param {string} source */
    function release(source)
    {
        const keys = held.get(source);
        if(!keys) return;
        held.delete(source);
        for(let n = keys.length - 1; n >= 0; n--) contact(keys[n], false);
    }
    function release_all()
    {
        for(const source of held.keys()) release(source);
    }
    /** @param {boolean} open */
    function set_slider(open)
    {
        if(!open)
        {
            for(const [source, keys] of held)
                if(keys.some(key => !outer_keys.includes(key))) release(source);
        }
        slide_open = open;
        slider.textContent = open ? "Close slider" : "Open slider";
        slider.setAttribute("aria-expanded", String(open));
        keypad.hidden = !open;
    }
    set_slider(false);
    /** @param {string} key */
    function make_button(key)
    {
        const host_key = Object.keys(shortcuts).find(code => shortcuts[code] === key);
        const label = key === "CameraFocus" ? "Camera focus" : key === "CameraShutter" ? "Camera shutter" :
            key === "VolumeUp" ? "Volume up" : key === "VolumeDown" ? "Volume down" :
            key === "Send" ? "Answer call" : key === "End" ? "End call" : key === "Lock" ? "Side lock switch" : key;
        const button = h("button", { type: "button", dataset: { key }, "aria-label": label, "aria-pressed": "false",
            title: host_key ? label + " · " + host_key : label }, labels[key] || key);
        button.addEventListener("pointerdown", event => {
            if(event.button !== 0) return;
            event.preventDefault();
            panel.focus({ preventScroll: true });
            if(event.isTrusted) button.setPointerCapture(event.pointerId);
            press("pointer:" + event.pointerId, key);
        });
        for(const type of ["pointerup", "pointercancel", "lostpointercapture"])
            button.addEventListener(type, /** @param {PointerEvent} event */ event => release("pointer:" + event.pointerId));
        button.addEventListener("click", event => {
            if(event.detail) return;
            const source = "click:" + key;
            if(held.has(source)) return;
            press(source, key);
            window.setTimeout(() => release(source), 70);
        });
        buttons.set(key, button);
        return button;
    }
    keypad.append(h("div.n97-slide-layout", null,
        h("div.n97-key-rocker", { role: "group", "aria-label": "Directional pad" }, rocker.map(make_button)),
        h("div", null, rows.map(row => h("div.n97-key-row", null, row.map(make_button))))));
    panel.append(
        h("div.n97-key-row.n97-outer-keys", { role: "group", "aria-label": "Front controls" }, front_keys.map(make_button)),
        h("div.n97-key-row.n97-outer-keys", { role: "group", "aria-label": "Side controls" }, side_keys.map(make_button)));
    panel.addEventListener("keydown", event => {
        if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
        if(event.target instanceof HTMLButtonElement && (event.code === "Space" || event.code === "Enter")) return;
        const key = shortcuts[event.code] || (/^Key[A-Z]$/.test(event.code) ? event.code[3] : "");
        if(!key || !slide_open && !outer_keys.includes(key)) return;
        event.preventDefault();
        event.stopPropagation();
        if(!event.repeat) press("host:" + event.code, key);
    });
    panel.addEventListener("keyup", event => {
        const source = "host:" + event.code;
        if(!held.has(source)) return;
        event.preventDefault();
        event.stopPropagation();
        release(source);
    });
    panel.addEventListener("focusout", event => {
        if(!(event.relatedTarget instanceof Node) || !panel.contains(event.relatedTarget)) release_all();
    });
    window.addEventListener("blur", release_all);
    window.addEventListener("pagehide", release_all);
    document.addEventListener("visibilitychange", () => { if(document.hidden) release_all(); });
    return { panel, set_slider, release: release_all };
}
