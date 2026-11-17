//! Derived scanout buffers: compare visible XRGB channels before the JS
//! panel recolors pixels. They are not guest RAM or snapshot state. Only
//! the machine/device thread uses them, with guest cores stopped.
static mut SOURCE: Vec<u32> = Vec::new();
static mut SHADOW: Vec<u32> = Vec::new();

/// A stable staging buffer until the next prepare. Allocate both vectors
/// here, before JS takes views: changed() must never grow Wasm memory.
#[no_mangle]
pub fn a64_video_prepare(words: u32) -> u32 {
    if words == 0 || words > 16 * 1024 * 1024 || crate::parallel::active() {
        return 0;
    }
    unsafe {
        let source = &mut *crate::parallel::machine(&raw mut SOURCE);
        let shadow = &mut *crate::parallel::machine(&raw mut SHADOW);
        source.resize(words as usize, 0);
        shadow.resize(words as usize, 0);
        source.as_mut_ptr() as u32
    }
}

fn same_rgb(a: &[u32], b: &[u32]) -> bool {
    let mut at = 0;
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    unsafe {
        use core::arch::wasm32::{i32x4_splat, v128_and, v128_any_true, v128_load, v128_xor};
        let rgb = i32x4_splat(0x00FFFFFF);
        while at + 4 <= a.len() {
            let difference = v128_xor(
                v128_load(a.as_ptr().add(at).cast()),
                v128_load(b.as_ptr().add(at).cast()),
            );
            if v128_any_true(v128_and(difference, rgb)) {
                return false;
            }
            at += 4;
        }
    }
    while at < a.len() {
        if (a[at] ^ b[at]) & 0x00FFFFFF != 0 {
            return false;
        }
        at += 1;
    }
    true
}

/// Compare visible RGB. On a change copy the full source
/// to the shadow, before converting the staging pixels for presentation.
#[no_mangle]
pub fn a64_video_rgb_changed() -> u32 {
    if crate::parallel::active() {
        return 1;
    }
    unsafe {
        let source = &*crate::parallel::machine(&raw mut SOURCE);
        let shadow = &mut *crate::parallel::machine(&raw mut SHADOW);
        if source.is_empty() || source.len() != shadow.len() {
            return 1;
        }
        if same_rgb(source, shadow) {
            return 0;
        }
        shadow.copy_from_slice(source);
        1
    }
}

/// Entry point used by older panel workers.
#[no_mangle]
pub fn a64_video_changed() -> u32 { a64_video_rgb_changed() }

/// Full-backlight BGRA -> opaque RGBA, in the already allocated staging
/// buffer. The comparison shadow remains BGRA. No allocations or guest stores.
/// Return the OR of the source color channels for black-panel detection.
#[no_mangle]
pub fn a64_video_convert_bgra() -> u32 {
    if crate::parallel::active() {
        return 0;
    }
    unsafe {
        let source = &mut *crate::parallel::machine(&raw mut SOURCE);
        let mut at = 0;
        let mut any = 0u32;
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            use core::arch::wasm32::{
                i32x4_extract_lane, i32x4_splat, i8x16_shuffle, v128_load, v128_or, v128_store,
            };
            let mut seen = i32x4_splat(0);
            let alpha = i32x4_splat(0xFF000000u32 as i32);
            while at + 4 <= source.len() {
                let p = v128_load(source.as_ptr().add(at).cast());
                seen = v128_or(seen, p);
                let rgba =
                    i8x16_shuffle::<2, 1, 0, 3, 6, 5, 4, 7, 10, 9, 8, 11, 14, 13, 12, 15>(p, p);
                v128_store(source.as_mut_ptr().add(at).cast(), v128_or(rgba, alpha));
                at += 4;
            }
            any |= (i32x4_extract_lane::<0>(seen)
                | i32x4_extract_lane::<1>(seen)
                | i32x4_extract_lane::<2>(seen)
                | i32x4_extract_lane::<3>(seen)) as u32;
        }
        while at < source.len() {
            let p = source[at];
            any |= p;
            source[at] = 0xFF000000 | (p & 255) << 16 | p & 0xFF00 | p >> 16 & 255;
            at += 1;
        }
        any & 0xFFFFFF
    }
}
