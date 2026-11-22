// SPDX-License-Identifier: BSD-2-Clause
#include <e32base.h>
#include <e32debug.h>
#include <u32std.h>

extern TInt E32Main();
extern "C" void ConstructCppExceptionGlobals(TAny*) asm("_ZN23TCppRTExceptionsGlobalsC1Ev");
using Constructor = void (*)();
extern "C" Constructor __init_array_start[], __init_array_end[];
extern "C" TInt LegacyDisplayMode(const void* self) asm("_ZN11RWindowBase11DisplayModeEv");
extern "C" TInt NativeDisplayMode(const void* self) asm("_ZNK11RWindowBase11DisplayModeEv");
extern "C" TInt NativeDisplayMode(const void* self) { return LegacyDisplayMode(self); }

// The profile has one virtual CPU. ARMv6 word atomics with compiler barriers
// provide the runtime operations absent from the older euser export table.
extern "C" unsigned __e32_atomic_add_ord32(volatile unsigned* p, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    const unsigned result = __atomic_fetch_add(p, n, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return result;
}
extern "C" unsigned __e32_atomic_and_ord32(volatile unsigned* p, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    const unsigned result = __atomic_fetch_and(p, n, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return result;
}
extern "C" unsigned __e32_atomic_ior_ord32(volatile unsigned* p, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    const unsigned result = __atomic_fetch_or(p, n, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return result;
}
extern "C" unsigned __e32_atomic_swp_ord32(volatile unsigned* p, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    const unsigned result = __atomic_exchange_n(p, n, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return result;
}
extern "C" unsigned __e32_atomic_load_acq32(const volatile unsigned* p) {
    const unsigned result = __atomic_load_n(p, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_ACQUIRE);
    return result;
}
extern "C" unsigned __e32_atomic_store_ord32(volatile unsigned* p, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    __atomic_store_n(p, n, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return n;
}
extern "C" int __e32_atomic_cas_ord32(volatile unsigned* p, unsigned* expected, unsigned n) {
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    const bool result = __atomic_compare_exchange_n(p, expected, n, false, __ATOMIC_RELAXED, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
    return result;
}
extern "C" void RunNotesThread(TInt reason, SStdEpocThreadCreateInfo& info) {
    if (reason != 0 && reason != 1) User::Invariant();
    // drtaeabi keeps per-thread exception state in this live entry frame.
    TUint64 exception_globals[64];
    const TBool secondary = reason == 1;
    TInt error = UserHeap::SetupThreadHeap(secondary, info);
    if (error == KErrNone) {
        ConstructCppExceptionGlobals(exception_globals);
        if (secondary) error = info.iFunction(info.iPtr);
        else {
            User::InitProcess();
            for (auto item = __init_array_start; item < __init_array_end; ++item) (*item)();
            RDebug::Printf("CLASSICUBE: native E32Main");
            error = E32Main();
            RDebug::Printf("CLASSICUBE: E32Main returned %d", error);
        }
    }
    User::Exit(error);
}
