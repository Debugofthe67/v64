//! Bounded host-only backing-page write diagnostics. Compiled solely with
//! ir-test-hooks; no guest debug registers, exceptions or page-table edits.
use crate::cpu::{global_pointers as gp, memory};
use crate::page::Page;

const CAPACITY: usize = 4096;
const WORDS: usize = 24;
static mut PAGES: [u32; 16] = [u32::MAX; 16];
static mut RECORDS: [[u32; WORDS]; CAPACITY] = [[0; WORDS]; CAPACITY];
static mut TOTAL: u32 = 0;

pub fn watched(page: u32) -> bool {
    unsafe { (&*(&raw const PAGES)).contains(&page) }
}

/// Called while stopped. Retire cached write translations so every alias
/// takes the existing code-dirty slow path; guest access checks stay intact.
#[no_mangle]
pub unsafe fn ir_test_write_watch(slot: u32, page: u32) -> bool {
    if crate::cpu::apic::core_count() != 1
        || slot >= 16
        || page != u32::MAX
            && (page >= *gp::memory_size >> 12 || memory::in_mapped_range(page << 12))
    {
        return false;
    }
    PAGES[slot as usize] = page;
    crate::cpu::cpu::full_clear_tlb();
    if crate::x64::state::efer() & crate::x64::state::EFER_LMA != 0 {
        crate::x64::jac::flush(crate::cpu::apic::current_core());
    }
    true
}

#[no_mangle]
pub unsafe fn ir_test_write_watch_total() -> u32 {
    TOTAL
}

#[no_mangle]
pub unsafe fn ir_test_write_watch_word(sequence: u32, word: u32) -> u32 {
    if word as usize >= WORDS || sequence >= TOTAL || TOTAL - sequence > CAPACITY as u32 {
        return 0;
    }
    RECORDS[sequence as usize % CAPACITY][word as usize]
}

pub fn write(page: Page, bytes: Option<(u32, u32)>) {
    if !watched(page.to_u32()) {
        return;
    }
    unsafe {
        let (lo, hi) = bytes.unwrap_or((0, 4096));
        let physical = (page.to_u32() << 12) + lo;
        let ip = *gp::previous_ip as u32;
        let cr3 = *gp::cr.add(3) as u32;
        // Collapse adjacent stores at one instruction (for example an XOR
        // loop), retaining its first registers/preimage and attempt count.
        if TOTAL != 0 {
            let last = &mut RECORDS[(TOTAL - 1) as usize % CAPACITY];
            if last[1] >> 12 == physical >> 12 && last[4] == ip && last[6] == cr3 {
                last[15] = last[15].saturating_add(1);
                return;
            }
        }
        let row = &mut RECORDS[TOTAL as usize % CAPACITY];
        *row = [0; WORDS];
        row[0] = TOTAL;
        row[1] = physical;
        row[2] = hi - lo;
        row[3] = *gp::instruction_pointer as u32;
        row[4] = ip;
        row[5] = *gp::cpl as u32;
        row[6] = cr3;
        for i in 0..8 {
            row[7 + i] = *gp::reg32.add(i) as u32;
        }
        row[15] = 1;
        let base = page.to_u32() << 12;
        for i in 0..8 {
            let at = memory::mem8.add(base as usize + i * 4);
            row[16 + i] = std::ptr::read_unaligned(at as *const u32);
        }
        TOTAL = TOTAL.wrapping_add(1);
    }
}
