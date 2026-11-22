// SPDX-License-Identifier: BSD-2-Clause
// EGL 1.1 and GLES 1.1 entry points for the optional RM-356 WebGPU image.
#include "egl_window.h"
#include "opcodes.h"
#include <coemain.h>
#include <e32svr.h>

namespace {
using v86::EglWindow;
constexpr TInt KTls = 0x56383647;
constexpr TInt KRouteTls = 0x56383652;
constexpr TInt KDisplay = 1, KSurface = 1, KContext = 1;
constexpr TUint KInvalidEnum = 0x0500, KInvalidValue = 0x0501, KInvalidOperation = 0x0502;
constexpr TUint KVertexArray = 0x8074, KNormalArray = 0x8075, KColorArray = 0x8076, KTexCoordArray = 0x8078;
constexpr TUint KByte = 0x1400, KUnsignedByte = 0x1401, KShort = 0x1402, KUnsignedShort = 0x1403;
constexpr TUint KFloat = 0x1406, KFixed = 0x140C;
constexpr TUint KAlpha = 0x1906, KRgba = 0x1908;
constexpr TUint KUnpackAlignment = 0x0CF5;

struct Array {
    const TAny* pointer = nullptr;
    TInt size = 0;
    TUint type = 0;
    TInt stride = 0;
    bool enabled = false;
};
struct ThreadContext {
    EglWindow egl;
    Array vertex, normal, color, texcoord;
    RWindow* window = nullptr;
    TUint unpack_alignment = 4;
    TInt error = 0;
    TInt egl_error = v86::EGL_SUCCESS;
    bool context = false;
    bool bound = false;
};

ThreadContext* Current() { return static_cast<ThreadContext*>(UserSvr::DllTls(KTls)); }

ThreadContext* Create() {
    TAny* memory = User::Alloc(sizeof(ThreadContext));
    if (!memory) return nullptr;
    ThreadContext* state = new (memory) ThreadContext;
    if (UserSvr::DllSetTls(KTls, state) != KErrNone) {
        state->~ThreadContext();
        User::Free(state);
        return nullptr;
    }
    return state;
}

TInt EglError(ThreadContext* state, TInt error) {
    if (state) state->egl_error = error;
    return 0;
}

void GlError(ThreadContext& state, TInt error) {
    if (!state.error) state.error = error;
}

Array* ClientArray(ThreadContext& state, TUint name) {
    switch (name) {
        case KVertexArray: return &state.vertex;
        case KNormalArray: return &state.normal;
        case KColorArray: return &state.color;
        case KTexCoordArray: return &state.texcoord;
        default: return nullptr;
    }
}

TUint TypeSize(TUint type) {
    switch (type) {
        case KByte: case KUnsignedByte: return 1;
        case KShort: case KUnsignedShort: return 2;
        case KFloat: case KFixed: return 4;
        default: return 0;
    }
}

void SetArray(TUint name, TInt size, TUint type, TInt stride, const TAny* pointer) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    Array& array = *ClientArray(*state, name);
    if (!TypeSize(type)) return GlError(*state, KInvalidEnum);
    if (size < 2 || size > 4 || stride < 0 || stride > 4096) return GlError(*state, KInvalidValue);
    array = { pointer, size, type, stride, array.enabled };
}

bool UploadArray(ThreadContext& state, const Array& array, TUint name, TUint vertices) {
    if (!array.enabled || !vertices) return true;
    if (!array.pointer) return false;
    const TUint width = array.size * TypeSize(array.type);
    const TUint size = (vertices - 1) * (array.stride ? TUint(array.stride) : width) + width;
    if (!width || size > 512 * 1024) return false;
    const EglWindow::Input bytes { array.pointer, size };
    switch (name) {
        case KVertexArray: state.egl.Gl(gles1::glVertexPointerData, array.size, array.type, array.stride, bytes, size); break;
        case KNormalArray: state.egl.Gl(gles1::glNormalPointerData, array.type, array.stride, bytes, size); break;
        case KColorArray: state.egl.Gl(gles1::glColorPointerData, array.size, array.type, array.stride, bytes, size); break;
        case KTexCoordArray: state.egl.Gl(gles1::glTexCoordPointerData, 0, array.size, array.type, array.stride, bytes, size); break;
    }
    return true;
}

bool UploadArrays(ThreadContext& state, TUint vertices) {
    return UploadArray(state, state.vertex, KVertexArray, vertices) &&
        UploadArray(state, state.normal, KNormalArray, vertices) &&
        UploadArray(state, state.color, KColorArray, vertices) &&
        UploadArray(state, state.texcoord, KTexCoordArray, vertices);
}
}

extern "C" TInt v86_use_webgpu() {
    const auto route = reinterpret_cast<TUint>(UserSvr::DllTls(KRouteTls));
    if (route) return route == 1;

    // This tested ABI subset handles the signed Bantumi GL 2.05 executable.
    const TUint bantumi_secure_id = 0xF0273929;
    bool active = false;
    if (RProcess().SecureId().iId == bantumi_secure_id) {
        v86::RGraphics driver;
        if (driver.Open() == KErrNone) {
            active = driver.Available();
            driver.Close();
        }
    }
    UserSvr::DllSetTls(KRouteTls, reinterpret_cast<TAny*>(active ? 1 : 2));
    return active;
}

extern "C" TInt v86_eglGetDisplay(TInt native_display) { return native_display ? 0 : KDisplay; }

extern "C" TInt v86_eglInitialize(TInt display, TInt* major, TInt* minor) {
    if (display != KDisplay) return 0;
    ThreadContext* state = Current();
    if (!state) state = Create();
    if (!state || !state->egl.eglInitialize()) return 0;
    if (major) *major = 1;
    if (minor) *minor = 1;
    return 1;
}

extern "C" TInt v86_eglTerminate(TInt display) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    state->~ThreadContext();
    UserSvr::DllFreeTls(KTls);
    User::Free(state);
    return 1;
}

extern "C" TInt v86_eglGetError() {
    ThreadContext* state = Current();
    if (!state) return v86::EGL_NOT_INITIALIZED;
    const TInt error = state->egl_error;
    state->egl_error = v86::EGL_SUCCESS;
    return error == v86::EGL_SUCCESS ? state->egl.eglGetError() : error;
}

extern "C" TInt v86_eglChooseConfig(TInt display, const TInt* attrs, TInt* configs, TInt size, TInt* count) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    if (!count || size < 0) return EglError(state, v86::EGL_BAD_PARAMETER);
    TInt config, matches;
    if (!state->egl.eglChooseConfig(attrs, config, matches)) return 0;
    *count = matches && configs ? (size > 0) : matches;
    if (*count && configs) configs[0] = config;
    return 1;
}

extern "C" TInt v86_eglGetConfigs(TInt display, TInt* configs, TInt size, TInt* count) {
    return v86_eglChooseConfig(display, nullptr, configs, size, count);
}

extern "C" TInt v86_eglGetConfigAttrib(TInt display, TInt config, TInt key, TInt* value) {
    ThreadContext* state = Current();
    return state && display == KDisplay && value && state->egl.eglGetConfigAttrib(config, key, *value);
}

extern "C" TInt v86_eglCreateWindowSurface(TInt display, TInt config, RWindow* window, const TInt* attrs) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    if (!window || (attrs && *attrs != v86::EGL_NONE)) return EglError(state, v86::EGL_BAD_PARAMETER);
    if (!state->egl.eglCreateWindowSurface(config, *window)) return 0;
    state->window = window;
    return KSurface;
}

extern "C" TInt v86_eglDestroySurface(TInt display, TInt surface) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    if (!state->window || surface != KSurface) return EglError(state, v86::EGL_BAD_SURFACE);
    state->egl.eglDestroySurface();
    state->window = nullptr;
    state->bound = false;
    return 1;
}

extern "C" TInt v86_eglCreateContext(TInt display, TInt config, TInt shared, const TInt* attrs) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    if (shared || state->context) return EglError(state, v86::EGL_BAD_MATCH);
    if (attrs && *attrs != v86::EGL_NONE) return EglError(state, v86::EGL_BAD_ATTRIBUTE);
    state->context = state->egl.eglCreateContext(config, nullptr);
    return state->context ? KContext : 0;
}

extern "C" TInt v86_eglDestroyContext(TInt display, TInt context) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    if (!state->context || context != KContext) return EglError(state, v86::EGL_BAD_CONTEXT);
    state->egl.eglDestroyContext();
    state->bound = state->context = false;
    state->vertex = state->normal = state->color = state->texcoord = {};
    state->unpack_alignment = 4;
    return 1;
}

extern "C" TInt v86_eglMakeCurrent(TInt display, TInt draw, TInt read, TInt context) {
    ThreadContext* state = Current();
    if (!state || display != KDisplay) return 0;
    const bool bind = draw || read || context;
    if (bind && (draw != KSurface || read != KSurface || context != KContext || !state->context || !state->window))
        return EglError(state, v86::EGL_BAD_MATCH);
    if (!state->egl.eglMakeCurrent(bind)) return 0;
    state->bound = bind;
    return 1;
}

extern "C" TInt v86_eglQuerySurface(TInt display, TInt surface, TInt key, TInt* value) {
    ThreadContext* state = Current();
    return state && display == KDisplay && surface == KSurface && value && state->egl.eglQuerySurface(key, *value);
}

extern "C" TInt v86_eglSwapBuffers(TInt display, TInt surface) {
    ThreadContext* state = Current();
    CCoeEnv* env = CCoeEnv::Static();
    if (!state || display != KDisplay || surface != KSurface || !env ||
        !state->egl.eglSwapBuffers(&env->SystemGc())) return 0;
    env->WsSession().Flush();
    return 1;
}

extern "C" TInt v86_eglWaitGL() {
    ThreadContext* state = Current();
    return !state || !state->bound || state->egl.eglFlush();
}

extern "C" TInt v86_eglWaitNative(TInt engine) { return engine == 0x305B; }

extern "C" TInt v86_eglCreatePbufferSurface(TInt, TInt, const TInt*) {
    return EglError(Current(), v86::EGL_BAD_MATCH);
}
extern "C" TInt v86_eglCreatePixmapSurface(TInt, TInt, void*, const TInt*) {
    return EglError(Current(), v86::EGL_BAD_MATCH);
}
extern "C" TInt v86_eglCopyBuffers(TInt, TInt, void*) {
    return EglError(Current(), v86::EGL_BAD_MATCH);
}

extern "C" TUint v86_glGetError() {
    ThreadContext* state = Current();
    if (!state || !state->bound) return KInvalidOperation;
    if (state->error) {
        const TUint error = state->error;
        state->error = 0;
        return error;
    }
    TUint value = 0;
    if (!state->egl.Query(gles1::glGetError, &value, sizeof(value))) return KInvalidOperation;
    return value;
}

extern "C" const char* v86_glGetString(TUint name) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return nullptr;
    switch (name) {
        case 0x1F00: return "v86";
        case 0x1F01: return "Syborg WebGPU";
        case 0x1F02: return "OpenGL ES-CM 1.1";
        case 0x1F03: return "";
        default: GlError(*state, KInvalidEnum); return nullptr;
    }
}

#define GL_COMMAND(name, params, ...) \
    extern "C" void v86_##name params { \
        ThreadContext* state = Current(); \
        if (state && state->bound) state->egl.Gl(gles1::name, __VA_ARGS__); \
    }
GL_COMMAND(glBindTexture, (TUint target, TUint handle), target, handle)
GL_COMMAND(glBlendFunc, (TUint src, TUint dst), src, dst)
GL_COMMAND(glClear, (TUint mask), mask)
GL_COMMAND(glClearColorx, (TInt r, TInt g, TInt b, TInt a), r, g, b, a)
GL_COMMAND(glColor4x, (TInt r, TInt g, TInt b, TInt a), r, g, b, a)
GL_COMMAND(glDeleteTextures, (TInt count, const TUint* names), count,
    (EglWindow::Input { names, count > 0 && count <= 32 ? TUint(count) * 4 : 0 }))
GL_COMMAND(glDepthFunc, (TUint func), func)
GL_COMMAND(glDisable, (TUint cap), cap)
GL_COMMAND(glEnable, (TUint cap), cap)
GL_COMMAND(glHint, (TUint target, TUint mode), target, mode)
GL_COMMAND(glLightxv, (TUint light, TUint param, const TInt* values), light, param,
    (EglWindow::Input { values, param == 0x1204 ? 12u : param >= 0x1205 ? 4u : 16u }))
GL_COMMAND(glMaterialx, (TUint face, TUint param, TInt value), face, param, value)
GL_COMMAND(glMaterialxv, (TUint face, TUint param, const TInt* values), face, param,
    (EglWindow::Input { values, param == 0x1601 ? 4u : 16u }))
GL_COMMAND(glMatrixMode, (TUint mode), mode)
GL_COMMAND(glMultMatrixx, (const TInt* matrix), (EglWindow::Input { matrix, 64 }))
GL_COMMAND(glOrthox, (TInt l, TInt r, TInt b, TInt t, TInt n, TInt f), l, r, b, t, n, f)
GL_COMMAND(glScissor, (TInt x, TInt y, TInt w, TInt h), x, y, w, h)
GL_COMMAND(glShadeModel, (TUint mode), mode)
GL_COMMAND(glTexParameterx, (TUint target, TUint param, TInt value), target, param, value)
GL_COMMAND(glTranslatex, (TInt x, TInt y, TInt z), x, y, z)
GL_COMMAND(glViewport, (TInt x, TInt y, TInt w, TInt h), x, y, w, h)
#undef GL_COMMAND

#define GL_VOID(name) \
    extern "C" void v86_##name() { \
        ThreadContext* state = Current(); \
        if (state && state->bound) state->egl.Gl(gles1::name); \
    }
GL_VOID(glLoadIdentity)
GL_VOID(glPopMatrix)
GL_VOID(glPushMatrix)
#undef GL_VOID

extern "C" void v86_glFlush() { v86_eglWaitGL(); }

extern "C" void v86_glPixelStorei(TUint param, TInt value) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    if (param == KUnpackAlignment && (value == 1 || value == 2 || value == 4 || value == 8))
        state->unpack_alignment = value;
    state->egl.Gl(gles1::glPixelStorei, param, value);
}

extern "C" void v86_glGenTextures(TInt count, TUint* names) {
    ThreadContext* state = Current();
    if (!state || !state->bound || !count) return;
    if (!names || count < 0 || count > 32) return GlError(*state, KInvalidValue);
    const TUint bytes = count * sizeof(TUint);
    if (!state->egl.Query(gles1::glGenTextures, names, bytes, count, EglWindow::Output { bytes }))
        GlError(*state, KInvalidOperation);
}

extern "C" void v86_glTexImage2D(TUint target, TInt level, TInt internal, TInt width, TInt height,
                                   TInt border, TUint format, TUint type, const TAny* pixels) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    const TInt channels = format == KRgba ? 4 : format == KAlpha ? 1 : 0;
    if (!channels || type != KUnsignedByte) return GlError(*state, KInvalidEnum);
    if (width <= 0 || height <= 0 || width > 256 || height > 256 || !pixels) return GlError(*state, KInvalidValue);
    const TUint row = width * channels;
    const TUint padding_mask = state->unpack_alignment - 1;
    const TUint stride = (row + padding_mask) & ~padding_mask;
    state->egl.Gl(gles1::glTexImage2D, target, level, internal, width, height, border, format, type,
        EglWindow::Input { pixels, stride * (height - 1) + row });
}

extern "C" void v86_glReadPixels(TInt x, TInt y, TInt width, TInt height, TUint format, TUint type, TAny* pixels) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    if (!pixels || width <= 0 || height <= 0 || width > 640 || height > 640) return GlError(*state, KInvalidValue);
    if (format != KRgba || type != KUnsignedByte) return GlError(*state, KInvalidEnum);
    const TUint bytes = width * height * 4;
    if (!state->egl.Query(gles1::glReadPixels, pixels, bytes, x, y, width, height, format, type, EglWindow::Output { bytes }))
        GlError(*state, KInvalidOperation);
}

extern "C" void v86_glEnableClientState(TUint name) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    Array* array = ClientArray(*state, name);
    if (!array) return GlError(*state, KInvalidEnum);
    array->enabled = true;
    state->egl.Gl(gles1::glEnableClientState, name);
}

extern "C" void v86_glDisableClientState(TUint name) {
    ThreadContext* state = Current();
    if (!state || !state->bound) return;
    Array* array = ClientArray(*state, name);
    if (!array) return GlError(*state, KInvalidEnum);
    array->enabled = false;
    state->egl.Gl(gles1::glDisableClientState, name);
}

extern "C" void v86_glVertexPointer(TInt size, TUint type, TInt stride, const TAny* data) {
    SetArray(KVertexArray, size, type, stride, data);
}
extern "C" void v86_glNormalPointer(TUint type, TInt stride, const TAny* data) {
    SetArray(KNormalArray, 3, type, stride, data);
}
extern "C" void v86_glColorPointer(TInt size, TUint type, TInt stride, const TAny* data) {
    SetArray(KColorArray, size, type, stride, data);
}
extern "C" void v86_glTexCoordPointer(TInt size, TUint type, TInt stride, const TAny* data) {
    SetArray(KTexCoordArray, size, type, stride, data);
}

extern "C" void v86_glDrawElements(TUint mode, TInt count, TUint type, const TAny* indices) {
    ThreadContext* state = Current();
    if (!state || !state->bound || !count) return;
    if (!indices || count < 0 || count > 65536) return GlError(*state, KInvalidValue);
    TUint last = 0;
    if (type == KUnsignedByte) {
        const auto* list = static_cast<const TUint8*>(indices);
        for (TInt i = 0; i < count; ++i) if (list[i] > last) last = list[i];
    } else if (type == KUnsignedShort) {
        const auto* list = static_cast<const TUint16*>(indices);
        for (TInt i = 0; i < count; ++i) if (list[i] > last) last = list[i];
    } else {
        return GlError(*state, KInvalidEnum);
    }
    if (!UploadArrays(*state, last + 1)) return GlError(*state, KInvalidOperation);
    const TUint bytes = count * TypeSize(type);
    state->egl.Gl(gles1::glDrawElementsData, mode, count, type, EglWindow::Input { indices, bytes }, bytes);
}

extern "C" void v86_glDrawArrays(TUint mode, TInt first, TInt count) {
    ThreadContext* state = Current();
    if (!state || !state->bound || !count) return;
    if (first < 0 || count < 0 || first > 65536 || count > 65536 - first) return GlError(*state, KInvalidValue);
    if (!UploadArrays(*state, first + count)) return GlError(*state, KInvalidOperation);
    state->egl.Gl(gles1::glDrawArrays, mode, first, count);
}
