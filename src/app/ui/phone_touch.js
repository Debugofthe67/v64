// @ts-check
/**
 * @param {HTMLElement} screen
 * @param {() => {width: number, height: number}} dimensions
 * @param {(x: number, y: number) => [number, number]} transform
 * @param {(x: number, y: number, down: boolean) => void} send
 * @param {() => boolean} ready
 * @param {AbortSignal} [signal]
 */
export function bind_phone_touch(screen, dimensions, transform, send, ready, signal)
{
    /** @type {number | null} */
    let finger = null;
    let x = 0, y = 0;
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
        const geometry = dimensions();
        const rect = screen.getBoundingClientRect();
        const factor = Math.min(rect.width / geometry.width, rect.height / geometry.height);
        if(!(factor > 0)) return false;
        // A fullscreen element can have bars around the device's display.
        const display_x = Math.floor((event.clientX - rect.left - (rect.width - geometry.width * factor) / 2) / factor);
        const display_y = Math.floor((event.clientY - rect.top - (rect.height - geometry.height * factor) / 2) / factor);
        if(!clamp && (display_x < 0 || display_x >= geometry.width || display_y < 0 || display_y >= geometry.height)) return false;
        const px = Math.max(0, Math.min(geometry.width - 1, display_x));
        const py = Math.max(0, Math.min(geometry.height - 1, display_y));
        [x, y] = transform(px, py);
        return true;
    }
    const listeners = { signal };
    screen.addEventListener("pointerdown", event => {
        if(finger !== null || event.button !== 0 || !ready() || !locate(event, false)) return;
        event.preventDefault();
        if(screen.tabIndex >= 0) screen.focus({ preventScroll: true });
        finger = event.pointerId;
        try { screen.setPointerCapture(finger); }
        catch(error) { /* Synthetic PointerEvents may not have a native capture. */ }
        send(x, y, true);
    }, listeners);
    screen.addEventListener("pointermove", event => {
        if(event.pointerId === finger && locate(event, true)) send(x, y, true);
    }, listeners);
    screen.addEventListener("pointerup", event => {
        if(event.pointerId !== finger) return;
        locate(event, true);
        release();
    }, listeners);
    const release_pointer = event => { if(event.pointerId === finger) release(); };
    screen.addEventListener("pointercancel", release_pointer, listeners);
    screen.addEventListener("lostpointercapture", release_pointer, listeners);
    screen.ownerDocument.defaultView.addEventListener("blur", release, listeners);
    screen.ownerDocument.defaultView.addEventListener("pagehide", release, listeners);
    screen.ownerDocument.addEventListener("visibilitychange", () => { if(screen.ownerDocument.hidden) release(); }, listeners);
    return release;
}
