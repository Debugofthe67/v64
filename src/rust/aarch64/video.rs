//! Derived scanout buffers: compare complete 32-bit frames before the JS
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

fn same(a: &[u32], b: &[u32]) -> bool {
    let mut at = 0;
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    unsafe {
        use core::arch::wasm32::{i32x4_ne, v128_any_true, v128_load};
        while at + 4 <= a.len() {
            if v128_any_true(i32x4_ne(
                v128_load(a.as_ptr().add(at).cast()),
                v128_load(b.as_ptr().add(at).cast()),
            )) {
                return false;
            }
            at += 4;
        }
    }
    while at < a.len() {
        if a[at] != b[at] {
            return false;
        }
        at += 1;
    }
    true
}

/// Compare every bit, including alpha. On a change copy the full source
/// to the shadow; JS still performs the existing exact pixel conversion.
#[no_mangle]
pub fn a64_video_changed() -> u32 {
    if crate::parallel::active() {
        return 1;
    }
    unsafe {
        let source = &*crate::parallel::machine(&raw mut SOURCE);
        let shadow = &mut *crate::parallel::machine(&raw mut SHADOW);
        if source.is_empty() || source.len() != shadow.len() {
            return 1;
        }
        if same(source, shadow) {
            return 0;
        }
        shadow.copy_from_slice(source);
        1
    }
}
