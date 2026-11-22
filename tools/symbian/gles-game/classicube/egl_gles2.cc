// SPDX-License-Identifier: BSD-2-Clause
#include "egl_window.h"
#include "opcodes.h"
#include <coemain.h>
#include <e32debug.h>
#include <EGL/egl.h>
#include <GLES2/gl2.h>

namespace {
v86::EglWindow* window;
constexpr TInt Display = 1, Surface = 1, Context = 1;
TUint egl_error = EGL_SUCCESS;
GLenum gl_error = GL_NO_ERROR;

template<typename Handle> Handle handle(TInt value) { return reinterpret_cast<Handle>(value); }
template<typename Handle> bool same(Handle value, TInt expected) { return value == handle<Handle>(expected); }
using Input = v86::EglWindow::Input;
using Output = v86::EglWindow::Output;
using Byte = v86::EglWindow::Byte;

template<typename... Args> void send(TUint op, Args... args) {
    if (window) window->Gl(op, args...);
    else gl_error = GL_INVALID_OPERATION;
}
template<typename Result, typename... Args> Result query(TUint op, Args... args) {
    Result result{};
    if (window) window->Query(op, &result, sizeof(result), args...);
    else gl_error = GL_INVALID_OPERATION;
    return result;
}

TUint text_size(const char* s) {
    TUint size = 0;
    while (s[size]) ++size;
    return size;
}

void egl_failure(const char* operation, EGLint error) {
    egl_error = error;
    RDebug::Printf("CLASSICUBE EGL: %s failed with %x", operation, error);
}

TUint texture_size(GLsizei width, GLsizei height, GLenum format, GLenum type) {
    if (width <= 0 || width > 256 || height <= 0 || height > 256 || type != GL_UNSIGNED_BYTE) return 0;
    if (format != GL_RGBA && format != GL_ALPHA) return 0;
    return TUint(width) * TUint(height) * (format == GL_RGBA ? 4 : 1);
}

void shader_log(TUint op, GLuint id, GLsizei capacity, GLsizei* length, char* log) {
    if (!window || capacity < 0 || capacity > 4096 || !log) return;
    char reply[4096 + 4];
    if (!window->Query(op, reply, 4 + capacity, id, capacity, Output{4}, Output{TUint(capacity)})) return;
    if (length) Mem::Copy(length, reply, 4);
    Mem::Copy(log, reply + 4, capacity);
}
}

extern "C" {
EGLDisplay eglGetDisplay(EGLNativeDisplayType display) {
    if (display == EGL_DEFAULT_DISPLAY) return handle<EGLDisplay>(Display);
    egl_error = EGL_BAD_PARAMETER;
    return EGL_NO_DISPLAY;
}
EGLBoolean eglInitialize(EGLDisplay display, EGLint* major, EGLint* minor) {
    if (!same(display, Display)) return EGL_FALSE;
    if (!window) window = new v86::EglWindow;
    if (!window || !window->eglInitialize()) return EGL_FALSE;
    if (major) *major = 1;
    if (minor) *minor = 4;
    return EGL_TRUE;
}
EGLBoolean eglTerminate(EGLDisplay display) {
    if (!same(display, Display)) return EGL_FALSE;
    delete window;
    window = nullptr;
    return EGL_TRUE;
}
EGLint eglGetError() {
    if (egl_error != EGL_SUCCESS) {
        const TInt error = egl_error;
        egl_error = EGL_SUCCESS;
        return error;
    }
    return window ? window->eglGetError() : EGL_NOT_INITIALIZED;
}
EGLBoolean eglBindAPI(EGLenum api) { return api == EGL_OPENGL_ES_API; }
EGLBoolean eglChooseConfig(EGLDisplay display, const EGLint* attributes, EGLConfig* output, EGLint capacity, EGLint* count) {
    if (!window || !same(display, Display) || !count || capacity < 0) return EGL_FALSE;
    TInt config, matches;
    if (!window->eglChooseConfig(attributes, config, matches)) return EGL_FALSE;
    if (matches && output && capacity) *output = handle<EGLConfig>(config);
    *count = matches;
    return EGL_TRUE;
}
EGLBoolean eglGetConfigs(EGLDisplay display, EGLConfig* configs, EGLint capacity, EGLint* count) {
    return eglChooseConfig(display, nullptr, configs, capacity, count);
}
EGLBoolean eglGetConfigAttrib(EGLDisplay display, EGLConfig config, EGLint attr, EGLint* value) {
    return window && same(display, Display) && value && window->eglGetConfigAttrib(reinterpret_cast<TInt>(config), attr, *value);
}
EGLContext eglCreateContext(EGLDisplay display, EGLConfig config, EGLContext share, const EGLint* attributes) {
    return window && same(display, Display) && !share && window->eglCreateContext(reinterpret_cast<TInt>(config), attributes) ?
        handle<EGLContext>(Context) : EGL_NO_CONTEXT;
}
EGLSurface eglCreateWindowSurface(EGLDisplay display, EGLConfig config, EGLNativeWindowType native, const EGLint* attributes) {
    if (!window || !same(display, Display) || !native || (attributes && *attributes != EGL_NONE)) {
        egl_failure("window arguments", EGL_BAD_PARAMETER);
        return EGL_NO_SURFACE;
    }
    auto& native_window = *static_cast<RWindow*>(native);
    if (window->eglCreateWindowSurface(reinterpret_cast<TInt>(config), native_window))
        return handle<EGLSurface>(Surface);
    egl_failure("create surface", window->eglGetError());
    return EGL_NO_SURFACE;
}
EGLBoolean eglMakeCurrent(EGLDisplay display, EGLSurface draw, EGLSurface read, EGLContext ctx) {
    if (!window || !same(display, Display) || draw != read) return EGL_FALSE;
    if (!draw && !ctx) return window->eglMakeCurrent(false);
    if (!same(draw, Surface) || !same(ctx, Context)) return EGL_FALSE;
    if (window->eglMakeCurrent(true)) return EGL_TRUE;
    egl_failure("make current", window->eglGetError());
    return EGL_FALSE;
}
EGLBoolean eglDestroyContext(EGLDisplay display, EGLContext ctx) {
    if (!window || !same(display, Display) || !same(ctx, Context)) return EGL_FALSE;
    window->eglDestroyContext();
    return EGL_TRUE;
}
EGLBoolean eglDestroySurface(EGLDisplay display, EGLSurface surface) {
    if (!window || !same(display, Display) || !same(surface, Surface)) return EGL_FALSE;
    window->eglDestroySurface();
    return EGL_TRUE;
}
EGLBoolean eglSwapInterval(EGLDisplay display, EGLint interval) {
    return same(display, Display) && interval >= 0 && interval <= 1;
}
EGLBoolean eglSwapBuffers(EGLDisplay display, EGLSurface surface) {
    if (!window || !same(display, Display) || !same(surface, Surface)) {
        egl_failure("swap surface", EGL_BAD_SURFACE);
        return EGL_FALSE;
    }
    auto* env = CCoeEnv::Static();
    if (!env) {
        egl_failure("window environment", EGL_BAD_ACCESS);
        return EGL_FALSE;
    }
    if (window->eglSwapBuffers(&env->SystemGc())) return EGL_TRUE;
    egl_failure("swap", window->eglGetError());
    return EGL_FALSE;
}
void (*eglGetProcAddress(const char*)) (...) { return nullptr; }

void glAttachShader(GLuint program, GLuint shader) { send(gles2::glAttachShader, program, shader); }
void glBindAttribLocation(GLuint program, GLuint index, const char* name) {
    send(gles2::glBindAttribLocation, program, index, Input{name, text_size(name) + 1});
}
void glBindBuffer(GLenum target, GLuint buffer) { send(gles2::glBindBuffer, target, buffer); }
void glBindTexture(GLenum target, GLuint texture) { send(gles2::glBindTexture, target, texture); }
void glBlendFunc(GLenum src, GLenum dst) { send(gles2::glBlendFunc, src, dst); }
void glBufferData(GLenum target, GLsizeiptr size, const void* data, GLenum usage) {
    if (size < 0 || size > 0xF0000) { gl_error = GL_OUT_OF_MEMORY; return; }
    send(gles2::glBufferData, target, TInt(size), Input{data, data ? TUint(size) : 0}, usage);
}
void glBufferSubData(GLenum target, GLintptr offset, GLsizeiptr size, const void* data) {
    if (offset < 0 || size < 0 || size > 0xF0000 || !data) { gl_error = GL_INVALID_VALUE; return; }
    send(gles2::glBufferSubData, target, TInt(offset), TInt(size), Input{data, TUint(size)});
}
void glClear(GLbitfield mask) { send(gles2::glClear, mask); }
void glClearColor(GLfloat r, GLfloat g, GLfloat b, GLfloat a) { send(gles2::glClearColor, r, g, b, a); }
void glColorMask(GLboolean r, GLboolean g, GLboolean b, GLboolean a) { send(gles2::glColorMask, Byte{r}, Byte{g}, Byte{b}, Byte{a}); }
void glCompileShader(GLuint id) { send(gles2::glCompileShader, id); }
GLuint glCreateProgram() { return query<GLuint>(gles2::glCreateProgram); }
GLuint glCreateShader(GLenum type) { return query<GLuint>(gles2::glCreateShader, type); }
void glDeleteBuffers(GLsizei count, const GLuint* ids) { if (count > 0) send(gles2::glDeleteBuffers, count, Input{ids, TUint(count) * 4}); }
void glDeleteProgram(GLuint id) { send(gles2::glDeleteProgram, id); }
void glDeleteShader(GLuint id) { send(gles2::glDeleteShader, id); }
void glDeleteTextures(GLsizei count, const GLuint* ids) { if (count > 0) send(gles2::glDeleteTextures, count, Input{ids, TUint(count) * 4}); }
void glDepthFunc(GLenum func) { send(gles2::glDepthFunc, func); }
void glDepthMask(GLboolean mask) { send(gles2::glDepthMask, Byte{mask}); }
void glDetachShader(GLuint program, GLuint shader) { send(gles2::glDetachShader, program, shader); }
void glDisable(GLenum cap) { send(gles2::glDisable, cap); }
void glDisableVertexAttribArray(GLuint index) { send(gles2::glDisableVertexAttribArray, index); }
void glDrawArrays(GLenum mode, GLint first, GLsizei count) { send(gles2::glDrawArrays, mode, first, count); }
void glDrawElements(GLenum mode, GLsizei count, GLenum type, const void* offset) {
    send(gles2::glDrawElementsOffset, mode, count, type, reinterpret_cast<TUint>(offset));
}
void glEnable(GLenum cap) { send(gles2::glEnable, cap); }
void glEnableVertexAttribArray(GLuint index) { send(gles2::glEnableVertexAttribArray, index); }
void glGenBuffers(GLsizei count, GLuint* ids) {
    if (window && count > 0) window->Query(gles2::glGenBuffers, ids, TUint(count) * 4, count, Output{TUint(count) * 4});
}
void glGenTextures(GLsizei count, GLuint* ids) {
    if (window && count > 0) window->Query(gles2::glGenTextures, ids, TUint(count) * 4, count, Output{TUint(count) * 4});
}
GLenum glGetError() {
    if (gl_error) { const GLenum error = gl_error; gl_error = GL_NO_ERROR; return error; }
    return query<GLenum>(gles2::glGetError);
}
const GLubyte* glGetString(GLenum name) {
    const char* str = "";
    switch (name) {
        case GL_VENDOR: str = "v86"; break;
        case GL_RENDERER: str = "Syborg WebGPU"; break;
        case GL_VERSION: str = "OpenGL ES 2.0"; break;
        case GL_SHADING_LANGUAGE_VERSION: str = "OpenGL ES GLSL ES 1.00"; break;
        case GL_EXTENSIONS: break;
        default: gl_error = GL_INVALID_ENUM; return nullptr;
    }
    return reinterpret_cast<const GLubyte*>(str);
}
void glGetIntegerv(GLenum pname, GLint* value) {
    if (!window || !value) return;
    if (pname == GL_MAX_TEXTURE_SIZE) { *value = 256; return; }
    if (pname == 33307 || pname == 33308) { *value = 0; gl_error = GL_INVALID_ENUM; return; }
    const TUint size = pname == GL_VIEWPORT ? 16 : 4;
    window->Query(gles2::glGetIntegerv, value, size, pname, Output{size});
}
void glGetProgramInfoLog(GLuint id, GLsizei size, GLsizei* length, char* log) { shader_log(gles2::glGetProgramInfoLog, id, size, length, log); }
void glGetShaderInfoLog(GLuint id, GLsizei size, GLsizei* length, char* log) { shader_log(gles2::glGetShaderInfoLog, id, size, length, log); }
void glGetProgramiv(GLuint id, GLenum name, GLint* value) { *value = query<GLint>(gles2::glGetProgramiv, id, name, Output{4}); }
void glGetShaderiv(GLuint id, GLenum name, GLint* value) { *value = query<GLint>(gles2::glGetShaderiv, id, name, Output{4}); }
GLint glGetUniformLocation(GLuint id, const char* name) { return query<GLint>(gles2::glGetUniformLocation, id, Input{name, text_size(name) + 1}); }
void glLinkProgram(GLuint id) { send(gles2::glLinkProgram, id); }
void glReadPixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void* pixels) {
    if (!window || format != GL_RGBA || type != GL_UNSIGNED_BYTE || width < 1 || height < 1 || width > 640 || height > 640) return;
    const TUint size = TUint(width) * TUint(height) * 4;
    window->Query(gles2::glReadPixels, pixels, size, x, y, width, height, format, type, Output{size});
}
void glScissor(GLint x, GLint y, GLsizei width, GLsizei height) { send(gles2::glScissor, x, y, width, height); }
void glShaderSource(GLuint shader, GLsizei count, const char** strings, const GLint* lengths) {
    if (count != 1 || !strings || !strings[0]) { gl_error = GL_INVALID_VALUE; return; }
    const TUint size = lengths && lengths[0] >= 0 ? TUint(lengths[0]) : text_size(strings[0]);
    send(gles2::glShaderString, shader, Input{strings[0], size}, TInt(size));
}
void glTexImage2D(GLenum target, GLint level, GLenum internal, GLsizei w, GLsizei h, GLint border, GLenum format, GLenum type, const void* pixels) {
    const TUint size = texture_size(w, h, format, type);
    if (!size) { gl_error = GL_INVALID_VALUE; return; }
    send(gles2::glTexImage2D, target, level, internal, w, h, border, format, type, Input{pixels, pixels ? size : 0});
}
void glTexSubImage2D(GLenum target, GLint level, GLint x, GLint y, GLsizei w, GLsizei h, GLenum format, GLenum type, const void* pixels) {
    const TUint size = texture_size(w, h, format, type);
    if (!pixels || !size) { gl_error = GL_INVALID_VALUE; return; }
    send(gles2::glTexSubImage2D, target, level, x, y, w, h, format, type, Input{pixels, size});
}
void glTexParameteri(GLenum target, GLenum name, GLint value) { send(gles2::glTexParameteri, target, name, value); }
void glUniform1f(GLint loc, GLfloat x) { send(gles2::glUniform1f, loc, x); }
void glUniform2f(GLint loc, GLfloat x, GLfloat y) { send(gles2::glUniform2f, loc, x, y); }
void glUniform3f(GLint loc, GLfloat x, GLfloat y, GLfloat z) { send(gles2::glUniform3f, loc, x, y, z); }
void glUniformMatrix4fv(GLint loc, GLsizei count, GLboolean transpose, const GLfloat* data) {
    if (count >= 0 && count <= 64) send(gles2::glUniformMatrix4fv, loc, count, Byte{transpose}, Input{data, TUint(count) * 64});
}
void glUseProgram(GLuint id) { send(gles2::glUseProgram, id); }
void glVertexAttribPointer(GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* offset) {
    send(gles2::glVertexAttribPointerOffset, index, size, type, Byte{normalized}, stride, reinterpret_cast<TUint>(offset));
}
void glViewport(GLint x, GLint y, GLsizei width, GLsizei height) { send(gles2::glViewport, x, y, width, height); }
}
