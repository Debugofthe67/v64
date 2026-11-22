// SPDX-License-Identifier: BSD-2-Clause
#include "egl_window.h"

namespace v86 {
namespace {
constexpr TUint KMagic = 0x314C4756;
enum { KOpen = 1, KSubmit, KPoll, KReceive, KSwap, KClose };
enum { KWaiting, KReady, KLost };
constexpr TInt KConfig = 3;
constexpr TInt KAvailabilityControl = 0x7f10, KPacketControl = 0x7f11;
}

TInt RGraphics::Open() {
    _LIT(KDriver, "DisplayDriver");
    return DoCreate(KDriver, TVersion(1, 1, 1540), KNullUnit, nullptr, nullptr, EOwnerProcess);
}

TBool RGraphics::Available() {
    TUint availability[2] = {};
    return DoControl(KAvailabilityControl, availability) == KErrNone && availability[0];
}

TInt RGraphics::Submit(const TAny* command, TUint bytes, TAny* result, TUint capacity) {
    const TUint request[] = { reinterpret_cast<TUint>(command), bytes, reinterpret_cast<TUint>(result), capacity };
    return DoControl(KPacketControl, const_cast<TUint*>(request));
}

EglWindow::~EglWindow() {
    eglDestroyContext();
    eglDestroySurface();
    iDriver.Close();
    User::Free(iQueue);
}

bool EglWindow::Error(TInt error) {
    iError = error;
    return false;
}

TInt EglWindow::eglGetError() {
    const TInt error = iError;
    iError = EGL_SUCCESS;
    return error;
}

bool EglWindow::eglInitialize() {
    if (iInitialized) return true;
    if (iDriver.Open() != KErrNone) return Error(EGL_NOT_INITIALIZED);
    if (!iDriver.Available()) {
        iDriver.Close();
        return Error(EGL_NOT_INITIALIZED);
    }
    iQueue = static_cast<TUint8*>(User::Alloc(iCapacity));
    if (!iQueue) { iDriver.Close(); return Error(EGL_BAD_ALLOC); }
    iInitialized = true;
    return true;
}

bool EglWindow::eglGetConfigAttrib(TInt config, TInt key, TInt& value) {
    if (!iInitialized) return Error(EGL_NOT_INITIALIZED);
    if (config != KConfig) return Error(EGL_BAD_CONFIG);
    switch (key) {
        case EGL_CONFIG_ID: value = KConfig; break;
        case EGL_RED_SIZE: case EGL_GREEN_SIZE: case EGL_BLUE_SIZE: case EGL_ALPHA_SIZE: value = 8; break;
        case EGL_DEPTH_SIZE: value = 24; break;
        case EGL_BUFFER_SIZE: value = 32; break;
        case EGL_STENCIL_SIZE: case EGL_SAMPLES: case EGL_NATIVE_VISUAL_ID: value = 0; break;
        case EGL_SURFACE_TYPE: value = EGL_WINDOW_BIT; break;
        case EGL_RENDERABLE_TYPE: value = EGL_OPENGL_ES_BIT | EGL_OPENGL_ES2_BIT; break;
        case EGL_COLOR_BUFFER_TYPE: value = EGL_RGB_BUFFER; break;
        default: return Error(EGL_BAD_ATTRIBUTE);
    }
    return true;
}

bool EglWindow::eglChooseConfig(const TInt* attributes, TInt& config, TInt& count) {
    if (!iInitialized) return Error(EGL_NOT_INITIALIZED);
    count = 0;
    for (const TInt* p = attributes; p && *p != EGL_NONE; p += 2) {
        TInt supported;
        if (!eglGetConfigAttrib(KConfig, p[0], supported)) return false;
        const TInt requested = p[1];
        if (requested == -1) continue;
        const bool matches = p[0] == EGL_SURFACE_TYPE || p[0] == EGL_RENDERABLE_TYPE ?
            (supported & requested) == requested : p[0] == EGL_CONFIG_ID || p[0] == EGL_COLOR_BUFFER_TYPE ?
            supported == requested : supported >= requested;
        if (!matches) return true;
    }
    config = KConfig;
    count = 1;
    return true;
}

bool EglWindow::eglCreateWindowSurface(TInt config, RWindow& window) {
    TInt value;
    if (!eglGetConfigAttrib(config, EGL_CONFIG_ID, value)) return false;
    if (iWindow || !window.WsHandle()) return Error(EGL_BAD_NATIVE_WINDOW);
    const TSize size = window.Size();
    if (size.iWidth <= 0 || size.iHeight <= 0 || size.iWidth > 640 || size.iHeight > 640 ||
        size.iWidth * size.iHeight * 4 > 1 << 20) return Error(EGL_BAD_NATIVE_WINDOW);
    // A full 360x640 swap nearly fills the default 1 MiB application heap.
    const TInt bytes = size.iWidth * size.iHeight * 4;
    if (iPixels.CreateLocal(bytes, bytes, EOwnerThread) != KErrNone || iBitmap.Create(size, EColor16MU) != KErrNone) {
        iPixels.Close();
        return Error(EGL_BAD_ALLOC);
    }
    iWindow = &window;
    iSize = size;
    return true;
}

bool EglWindow::eglQuerySurface(TInt key, TInt& value) {
    if (!iWindow) return Error(EGL_BAD_SURFACE);
    if (key == EGL_WIDTH) value = iSize.iWidth;
    else if (key == EGL_HEIGHT) value = iSize.iHeight;
    else return Error(EGL_BAD_ATTRIBUTE);
    return true;
}

bool EglWindow::eglCreateContext(TInt config, const TInt* attributes) {
    TInt value;
    if (!eglGetConfigAttrib(config, EGL_CONFIG_ID, value)) return false;
    if (iVersion) return Error(EGL_BAD_CONTEXT);
    TInt version = 1;
    for (const TInt* p = attributes; p && *p != EGL_NONE; p += 2) {
        if (p[0] != EGL_CONTEXT_CLIENT_VERSION) return Error(EGL_BAD_ATTRIBUTE);
        version = p[1];
    }
    if (version != 1 && version != 2) return Error(EGL_BAD_MATCH);
    iVersion = version;
    return true;
}

bool EglWindow::eglMakeCurrent(bool bind) {
    if (!bind) {
        if (iBound && !Call(0)) return false;
        iBound = false;
        return true;
    }
    if (!iVersion || !iWindow) return Error(EGL_BAD_MATCH);
    if (iWindow->Size() != iSize) return Error(EGL_BAD_SURFACE);
    if (iSession && iSessionSize != iSize) return Error(EGL_CONTEXT_LOST);
    if (!iSession) {
        const TUint request[] = { KMagic, KOpen, 0, TUint(iVersion), TUint(iSize.iWidth), TUint(iSize.iHeight) };
        if (iDriver.Submit(request, sizeof(request), &iSession, sizeof(iSession)) != KErrNone || !iSession)
            return Error(EGL_CONTEXT_LOST);
        iSessionSize = iSize;
    }
    iBound = true;
    return true;
}

bool EglWindow::Control(TUint op, TAny* out, TUint size) {
    const TUint request[] = { KMagic, op, iSession };
    return iDriver.Submit(request, sizeof(request), out, size) == KErrNone || Error(EGL_CONTEXT_LOST);
}

bool EglWindow::Call(TUint reply) {
    if (iUsed == 16) return !reply;
    const TUint header[] = { KMagic, KSubmit, iSession, reply };
    Mem::Copy(iQueue, header, sizeof(header));
    const TInt status = iDriver.Submit(iQueue, iUsed, nullptr, 0);
    iUsed = 16;
    iCalls = 0;
    return status == KErrNone || Error(EGL_CONTEXT_LOST);
}

bool EglWindow::Read(TAny* out, TUint size) {
    // The copied driver control returns before the renderer completes.
    for (TInt attempt = 0; attempt < 500; ++attempt) {
        TUint status = KWaiting;
        if (!Control(KPoll, &status, sizeof(status))) return false;
        if (status == KReady) return Control(KReceive, out, size);
        if (status == KLost) break;
        User::After(2000);
    }
    return Error(EGL_CONTEXT_LOST);
}

bool EglWindow::Reserve(TUint opcode, TUint size) {
    if (!iBound) return Error(EGL_BAD_CONTEXT);
    if (size > KMaxQueueBytes - 16) return Error(EGL_BAD_ALLOC);
    if ((iUsed + size > iCapacity || iCalls >= 96) && !Call(0)) return false;
    if (iUsed + size > iCapacity) {
        TUint capacity = iCapacity;
        while (capacity < iUsed + size) capacity *= 2;
        auto* queue = static_cast<TUint8*>(User::ReAlloc(iQueue, capacity));
        if (!queue) return Error(EGL_BAD_ALLOC);
        iQueue = queue;
        iCapacity = capacity;
    }
    Append(opcode);
    Append(size);
    ++iCalls;
    return true;
}

void EglWindow::Append(const TAny* data, TUint size) {
    if (size) Mem::Copy(iQueue + iUsed, data, size);
    iUsed += size;
}

bool EglWindow::eglSwapBuffers(CWindowGc* gc) {
    if (!iBound || !iWindow || iWindow->Size() != iSize) return Error(EGL_BAD_SURFACE);
    TUint8* pixels = iPixels.Base();
    if (!Call(0) || !Control(KSwap) || !Read(pixels, iSize.iWidth * iSize.iHeight * 4)) return false;
    iBitmap.LockHeap(ETrue);
    auto* output = reinterpret_cast<TUint8*>(iBitmap.DataAddress());
    const TInt stride = iBitmap.DataStride();
    for (TInt y = 0; y < iSize.iHeight; ++y) {
        const TUint8* input = pixels + y * iSize.iWidth * 4;
        auto* row = reinterpret_cast<TUint32*>(output + y * stride);
        for (TInt x = 0; x < iSize.iWidth; ++x, input += 4)
            row[x] = 0xFF000000 | TUint(input[0]) << 16 | TUint(input[1]) << 8 | input[2];
    }
    iBitmap.UnlockHeap(ETrue);
    iPresented = true;
    if (gc) {
        iWindow->BeginRedraw();
        gc->Activate(*iWindow);
        Draw(*gc, TPoint());
        gc->Deactivate();
        iWindow->EndRedraw();
    } else {
        iWindow->Invalidate();
    }
    return true;
}

void EglWindow::Draw(CWindowGc& gc, const TPoint& origin) const {
    if (iPresented) gc.BitBlt(origin, &iBitmap);
}

void EglWindow::eglDestroyContext() {
    if (iSession) Control(KClose);
    iSession = 0;
    iBound = false;
    iCalls = 0;
    iUsed = 16;
    iVersion = 0;
}

void EglWindow::eglDestroySurface() {
    eglMakeCurrent(false);
    // A new surface for the same window size can use the existing context and GL objects.
    iBound = false;
    iBitmap.Reset();
    iPixels.Close();
    iWindow = nullptr;
    iPresented = false;
}

} // namespace v86
