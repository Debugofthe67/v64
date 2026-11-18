// RM-505 service manual, Figure 21. The LM8323 reports KP-X in the high
// nibble, KP-Y + 1 in the low nibble, and 0xF for a grounded (SF) input.
const matrix = [
    ["Q", "W", "E", "R", "T", "Y", "U", "Backspace", "Select"],
    ["A", "S", "D", "F", "I", "O", "Enter", "P", "Space"],
    ["Z", "X", "G", "H", "K", "L", "J", "Comma", "Chr"],
    ["Shift", "C", "V", "B", "Menu", "M", "N", "VolumeUp", "Fn"],
    ["Down", "Up", "Left", "Right", null, null, null, "VolumeDown"],
];

export const N97_KEY_CODES = new Map([
    ...matrix.flatMap((row, x) => row.flatMap((key, y) => key ? [[key, (x << 4) | (y + 1)]] : [])),
    ["CameraFocus", 0x0F],
    ["CameraShutter", 0x1F],
]);
export const N97_MATRIX_CODES = new Set(N97_KEY_CODES.values());

export function n97_control(control, pressed)
{
    return typeof pressed === "boolean" && (control === "lock" || control === "power" || control === "send" || control === "end");
}
