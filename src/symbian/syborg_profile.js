// Pinned Nokia 5800 Syborg profile. See docs/symbian-syborg-reference.md for the build.
export const SYBORG_FORMAT = "v86-symbian-syborg";
export const SYBORG_FORMAT_VERSION = 1;
export const SYBORG_MIB = 1024 * 1024;
export const SYBORG_MACHINE = "symbian-syborg";
export const SYBORG_BOOT_FILES = ["manifest", "rom", "rofs", "devicetree", "nvmemory", "nvmemory2"];
// Available to source-tree diagnostic tests only, never serialized by the library.
export const SYBORG_DIAGNOSTIC = Symbol("Syborg diagnostic ROM");

/** @param {*} value */
export function syborg_wisp_url(value)
{
    if(typeof value !== "string" || !/^wisps?:\/\/[^\s/#?]+[^\s#]*$/.test(value)) return false;
    try
    {
        const url = new URL(value.replace(/^wisp/, "ws"));
        return !!url.hostname && !url.username && !url.password;
    }
    catch(error) { return false; }
}

export const SYBORG_PROFILE = {
    id: "nokia-5800-rm356",
    firmware_version: "31.0.101",
    name: "Nokia 5800 XpressMusic",
    model: "RM-356",
    cpu: "arm1136-r2",
    personality: "sym94",
    personality_id: 3,
    ram_size: 172 * SYBORG_MIB,
    rom_base: 0x80000000,
    rom_address: 0x00010000,
    rofs_address: 0x60000000,
    rofs_window_size: 128 * SYBORG_MIB,
    devicetree_address: 0xC0012000,
    devicetree_sha256: "cbb986294b68586d85d3d2c6dca82e3d3f4f6001a143bd9f8cb4b22618ba8714",
    kernel_data_address: 0xC8000000,
    firmware_user_base: 0x80286DD0,
    firmware_core_sha256: "7e5c51639926d9f9e6ade21f46c1aed4950a56592e669aceb1e4e65548133ea5",
    screen: { width: 360, height: 640 },
    drives: { Z: [9, 10, 11], C: 1, D: 0, E: 2 },
    default_card_size: 1024 * SYBORG_MIB,
    platform_config: "modem.imei=490154203237518;modem.power_off_ms=3000;modem.ind=09ef0506@35>09c0;" +
        "modem.simst=01:01;d_display.panel=1;accelerometer.protocol=pns;exyin.rotate=270;audio.ring_units=16;" +
        "audio.streams=48000/2/24/240,48000/1/24,16000/1/24;audio.lead_pct=25;" +
        "d_display.caps=27;d_display.native=landscape;d_display.pitch=2560;d_display.rows=360",
    qembian_revision: "aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb",
    qembian_sources_lock_sha256: "b9ad89c048115db8c7f844c41d291fa9b904a963946b29919af70b79c57822e2",
};

export const SYBORG_FIRMWARE_FILES = {
    core: {
        name: "RM-356_31.0.101_prd.core.C00",
        bytes: 98474498,
        sha256: "bffaa4b9fb0e727934aa1ffb55ed48f98403f767227f4c746dc27cfe5ea834fb",
    },
    rofs2: {
        name: "RM-356_31.0.101_prd.rofs2.V05",
        bytes: 37036213,
        sha256: "671054fe238ca5634b493f898ad1e415760c5b3b0fdc148c67af61c3fcb23812",
    },
    rofs3: {
        name: "RM-356_31.0.101_C01_prd.rofs3.fpsx",
        bytes: 1287306,
        sha256: "1ce5ca18b5f923b64d10318a52fc61999e338f525d781692ea5611fff7407c1e",
    },
    uda: {
        name: "RM356_31.0.008_020_xxx_U01.uda.fpsx",
        bytes: 90380,
        sha256: "04072dad58a5a01c794955dda3f0cebf24008612c185930290cb0d3c22775ba7",
    },
};

export const SYBORG_ROFS_LAYERS = [
    { role: "rofs1", source: "core", sha256: "2c8627150b67402e6a47efd3adf71c806b73a7744bdc6273db48dab893a34f3e" },
    { role: "rofs2", source: "rofs2", sha256: "8e6b479b4807abda34d6a37be6b512f688e146062897de8ba10f7498938c9885" },
    { role: "rofs3", source: "rofs3", sha256: "972710ad30942bd5ece49e95dea63592059e488ed2b389983a2557c0cf285733" },
];

export const SYBORG_C_SEEDS = {
    blank: {
        name: "C-blank-seed.img",
        bytes: 64 * SYBORG_MIB,
        sha256: "3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351",
    },
    factory: {
        name: "C-factory-seed.img",
        bytes: 90316800,
        sha256: "677adef8b0567d754a9f66e4accae829324ebbfe1a15443ba241f55dc794ab4a",
    },
};
