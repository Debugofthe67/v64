// SPDX-License-Identifier: BSD-2-Clause
#ifndef V86_EGL_WINDOW_H
#define V86_EGL_WINDOW_H

#include <e32base.h>
#include <fbs.h>
#include <w32std.h>

namespace v86 {

enum {
    EGL_FALSE = 0, EGL_TRUE = 1, EGL_SUCCESS = 0x3000, EGL_NOT_INITIALIZED = 0x3001,
    EGL_BAD_ALLOC = 0x3003, EGL_BAD_ATTRIBUTE = 0x3004, EGL_BAD_CONFIG = 0x3005,
    EGL_BAD_CONTEXT = 0x3006, EGL_BAD_MATCH = 0x3009, EGL_BAD_NATIVE_WINDOW = 0x300B,
    EGL_BAD_PARAMETER = 0x300C, EGL_BAD_SURFACE = 0x300D, EGL_CONTEXT_LOST = 0x300E,
    EGL_BUFFER_SIZE = 0x3020, EGL_ALPHA_SIZE = 0x3021, EGL_BLUE_SIZE = 0x3022,
    EGL_GREEN_SIZE = 0x3023, EGL_RED_SIZE = 0x3024, EGL_DEPTH_SIZE = 0x3025, EGL_STENCIL_SIZE = 0x3026,
    EGL_CONFIG_ID = 0x3028, EGL_NATIVE_VISUAL_ID = 0x302E, EGL_SAMPLES = 0x3031,
    EGL_SURFACE_TYPE = 0x3033, EGL_NONE = 0x3038, EGL_RGB_BUFFER = 0x308E,
    EGL_HEIGHT = 0x3056, EGL_WIDTH = 0x3057, EGL_RENDERABLE_TYPE = 0x3040,
    EGL_COLOR_BUFFER_TYPE = 0x303F, EGL_CONTEXT_CLIENT_VERSION = 0x3098,
    EGL_WINDOW_BIT = 4, EGL_OPENGL_ES_BIT = 1, EGL_OPENGL_ES2_BIT = 4,
};
enum {
    GL_COLOR_BUFFER_BIT = 0x4000, GL_DEPTH_BUFFER_BIT = 0x0100, GL_TRIANGLE_STRIP = 5, GL_LESS = 0x0201,
    GL_BLEND = 0x0BE2, GL_DEPTH_TEST = 0x0B71, GL_TEXTURE_2D = 0x0DE1,
    GL_TEXTURE_MAG_FILTER = 0x2800, GL_TEXTURE_MIN_FILTER = 0x2801, GL_NEAREST = 0x2600,
    GL_SRC_ALPHA = 0x0302, GL_ONE_MINUS_SRC_ALPHA = 0x0303, GL_RGBA = 0x1908, GL_UNSIGNED_BYTE = 0x1401,
    GL_FLOAT = 0x1406, GL_VERTEX_ARRAY = 0x8074, GL_TEXTURE_COORD_ARRAY = 0x8078,
    GL_MODELVIEW = 0x1700, GL_PROJECTION = 0x1701, GL_VERTEX_SHADER = 0x8B31,
    GL_FRAGMENT_SHADER = 0x8B30, GL_COMPILE_STATUS = 0x8B81, GL_LINK_STATUS = 0x8B82,
};

class RGraphics : public RBusLogicalChannel {
public:
    TInt Open();
    TBool Available();
    TInt Submit(const TAny* command, TUint bytes, TAny* result, TUint capacity);
};

class EglWindow {
public:
    ~EglWindow();
    bool eglInitialize();
    bool eglChooseConfig(const TInt* attributes, TInt& config, TInt& count);
    bool eglGetConfigAttrib(TInt config, TInt key, TInt& value);
    bool eglCreateWindowSurface(TInt config, RWindow& window);
    bool eglQuerySurface(TInt key, TInt& value);
    bool eglCreateContext(TInt config, const TInt* attributes);
    bool eglMakeCurrent(bool bind);
    bool eglSwapBuffers(CWindowGc* gc = nullptr);
    bool eglFlush() { return Call(0); }
    void eglDestroyContext();
    void eglDestroySurface();
    TInt eglGetError();
    void Draw(CWindowGc& gc, const TPoint& origin) const;
    struct Input { const TAny* data; TUint size; };
    struct Output { TUint size; };
    struct Byte { TUint8 value; };

    template<typename... Args> void Gl(TUint opcode, Args... args) {
        if (!Reserve(opcode, (EncodedSize(args) + ... + 8u))) return;
        (Append(args), ...);
    }

    template<typename... Args> bool Query(TUint opcode, TAny* out, TUint size, Args... args) {
        Gl(opcode, args...);
        return Call(size) && Read(out, size);
    }

private:
    static constexpr TUint KInitialQueueBytes = 16 * 1024, KMaxQueueBytes = 1 << 20;
    RGraphics iDriver;
    TUint8* iQueue = nullptr;
    TUint iCapacity = KInitialQueueBytes;
    TUint iUsed = 16;
    TUint iCalls = 0;
    TUint iSession = 0;
    RWindow* iWindow = nullptr;
    CFbsBitmap iBitmap;
    RChunk iPixels;
    TSize iSize;
    TSize iSessionSize;
    TInt iVersion = 0;
    TInt iError = EGL_SUCCESS;
    bool iInitialized = false;
    bool iBound = false;
    bool iPresented = false;

    bool Error(TInt error);
    bool Control(TUint op, TAny* out = nullptr, TUint size = 0);
    bool Call(TUint reply);
    bool Read(TAny* out, TUint size);
    bool Reserve(TUint opcode, TUint size);
    void Append(const TAny* data, TUint size);
    void Append(TInt word) { Append(&word, sizeof(word)); }
    void Append(TUint word) { Append(&word, sizeof(word)); }
    void Append(float word) { Append(&word, sizeof(word)); }
    void Append(Byte byte) { Append(&byte.value, 1); }
    void Append(Input bytes) { Append(bytes.size); Append(bytes.data, bytes.size); }
    void Append(Output out) { Append(out.size); }
    template<typename T> static TUint EncodedSize(T) { return 4; }
    static TUint EncodedSize(Byte) { return 1; }
    static TUint EncodedSize(Input bytes) { return 4 + bytes.size; }
};

} // namespace v86
#endif
