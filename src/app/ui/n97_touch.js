import { N97_TOUCH_WIDTH, N97_TOUCH_HEIGHT } from "../../symbian/n97_touch.js";

/** @param {HTMLElement} screen @param {(x: number, y: number, down: boolean) => void} send @param {() => boolean} ready */
export function n97_touch_surface(screen, send, ready)
{
    const stage = screen.parentElement;
    screen.classList.add("n97-touch-screen");
    screen.setAttribute("aria-label", "Nokia N97 display and touchscreen");
    stage.classList.add("n97-screen-stage");
    let landscape = false, scale = 1;
    /** @type {number | null} */
    let finger = null;
    let x = 0, y = 0;
    const width = () => landscape ? N97_TOUCH_WIDTH : N97_TOUCH_HEIGHT;
    const height = () => landscape ? N97_TOUCH_HEIGHT : N97_TOUCH_WIDTH;
    const resize = () => stage.style.setProperty("--n97-display-width", width() * scale + "px");
    function release()
    {
        if(finger === null) return;
        const id = finger;
        finger = null;
        send(x, y, false);
        if(screen.hasPointerCapture(id)) screen.releasePointerCapture(id);
    }
    /** @param {PointerEvent} event */
    function locate(event, clamp)
    {
        const rect = screen.getBoundingClientRect();
        const factor = Math.min(rect.width / width(), rect.height / height());
        if(!(factor > 0)) return false;
        // A fullscreen element can have bars around the device's display.
        const display_x = Math.floor((event.clientX - rect.left - (rect.width - width() * factor) / 2) / factor);
        const display_y = Math.floor((event.clientY - rect.top - (rect.height - height() * factor) / 2) / factor);
        if(!clamp && (display_x < 0 || display_x >= width() || display_y < 0 || display_y >= height())) return false;
        const px = Math.max(0, Math.min(width() - 1, display_x));
        const py = Math.max(0, Math.min(height() - 1, display_y));
        // Invert the portrait mode's SCR_ROTATION1=270 transform (WsPointer::HandleRawEvent).
        x = landscape ? px : py;
        y = landscape ? py : N97_TOUCH_HEIGHT - 1 - px;
        return true;
    }
    screen.addEventListener("pointerdown", event => {
        if(finger !== null || event.button !== 0 || !ready() || !locate(event, false)) return;
        event.preventDefault();
        finger = event.pointerId;
        try { screen.setPointerCapture(finger); }
        catch(error) { /* Synthetic PointerEvents may not have a native capture. */ }
        send(x, y, true);
    });
    screen.addEventListener("pointermove", event => {
        if(event.pointerId === finger && locate(event, true)) send(x, y, true);
    });
    screen.addEventListener("pointerup", event => {
        if(event.pointerId !== finger) return;
        locate(event, true);
        release();
    });
    const release_pointer = event => { if(event.pointerId === finger) release(); };
    screen.addEventListener("pointercancel", release_pointer);
    screen.addEventListener("lostpointercapture", release_pointer);
    screen.ownerDocument.defaultView.addEventListener("blur", release);
    screen.ownerDocument.defaultView.addEventListener("pagehide", release);
    screen.ownerDocument.addEventListener("visibilitychange", () => { if(screen.ownerDocument.hidden) release(); });
    resize();
    return {
        release,
        set_fit(room_width, room_height)
        {
            scale = Math.max(0.1, Math.min(room_width / width(), room_height / height()));
            resize();
        },
        set_slider(open)
        {
            if(open === landscape) return;
            release();
            landscape = open;
            screen.dataset.landscape = String(open);
            resize();
        },
        set_scale(value) { scale = value; resize(); },
    };
}
