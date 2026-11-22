// SPDX-License-Identifier: BSD-2-Clause
#include "egl_window.h"
#include "opcodes.h"

#include <e32keys.h>
#include <u32std.h>

namespace {
using namespace v86;
using Input = EglWindow::Input;
using Output = EglWindow::Output;
extern "C" void ReadEvent(RWsSession*, TWsEvent&) asm("_ZN10RWsSession8GetEventER8TWsEvent");

constexpr TInt KWidth = 192, KHeight = 144, KPictureY = 116;
const TUint8 KTexture[] = { 230, 40, 20, 255, 10, 210, 30, 255, 20, 60, 240, 255, 230, 210, 20, 255 };
const float KTexCoords[] = { 0, 0, 1, 0, 0, 1, 1, 1 };
const float KNarrowCoords[] = { 0.25f, 0.75f, 0.25f, 0.75f, 0.25f, 0.75f, 0.25f, 0.75f };
const float KBoard[] = { -.75f, -.75f, 0, .75f, -.75f, 0, -.75f, .75f, 0, .75f, .75f, 0 };
const float KNear[] = { -.5f, -.25f, -.5f, 0, -.25f, -.5f, -.5f, .25f, -.5f, 0, .25f, -.5f };
const float KFar[] = { -.5f, -.25f, .5f, 0, -.25f, .5f, -.5f, .25f, .5f, 0, .25f, .5f };

constexpr char KVertexSource[] =
    "attribute vec3 pos; attribute vec2 uv; varying vec2 coord;"
    "void main(){coord=uv;gl_Position=vec4(pos,1.0);}";
constexpr char KFragmentSource[] =
    "precision mediump float; uniform sampler2D tex; uniform vec4 tint; varying vec2 coord;"
    "void main(){gl_FragColor=texture2D(tex,coord)*tint;}";

template<class T, TUint N> Input Bytes(const T (&value)[N]) { return { value, sizeof(value) }; }

struct Scene {
    EglWindow egl;
    TInt tint = -1;
    TUint mode = 0;
    TInt frames = 0;
    TInt result = KErrNone;
    TUint samples[6] = {};

    bool Shader(TUint type, Input source, TUint& shader) {
        using namespace gles2;
        TInt status = 0;
        if (!egl.Query(glCreateShader, &shader, 4, type) || !shader) return false;
        egl.Gl(glShaderString, shader, source, source.size);
        egl.Gl(glCompileShader, shader);
        return egl.Query(glGetShaderiv, &status, 4, shader, GL_COMPILE_STATUS, Output{4}) && status;
    }

    bool Program() {
        using namespace gles2;
        TUint vs, fs, program;
        if (!Shader(GL_VERTEX_SHADER, Bytes(KVertexSource), vs) ||
            !Shader(GL_FRAGMENT_SHADER, Bytes(KFragmentSource), fs) ||
            !egl.Query(glCreateProgram, &program, 4) || !program) return false;
        egl.Gl(glAttachShader, program, vs);
        egl.Gl(glAttachShader, program, fs);
        egl.Gl(glBindAttribLocation, program, 0u, Input{"pos", 4});
        egl.Gl(glBindAttribLocation, program, 1u, Input{"uv", 3});
        egl.Gl(glLinkProgram, program);
        TInt status = 0, sampler = -1;
        if (!egl.Query(glGetProgramiv, &status, 4, program, GL_LINK_STATUS, Output{4}) || !status) return false;
        egl.Gl(glUseProgram, program);
        if (!egl.Query(glGetUniformLocation, &sampler, 4, program, Input{"tex", 4}) ||
            !egl.Query(glGetUniformLocation, &tint, 4, program, Input{"tint", 5}) || sampler < 0 || tint < 0) return false;
        egl.Gl(glUniform1i, sampler, 0);
        egl.Gl(glEnableVertexAttribArray, 0u);
        egl.Gl(glEnableVertexAttribArray, 1u);
        return true;
    }

    TInt Pick(TInt first, TInt second) const { return mode == 1 ? first : second; }

    TInt Start(TUint version, RWindow& window) {
        egl.eglDestroyContext();
        egl.eglDestroySurface();
        mode = version;
        frames = 0;
        for (auto& sample : samples) sample = 0;
        const TInt attributes[] = { EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RENDERABLE_TYPE,
            version == 1 ? EGL_OPENGL_ES_BIT : EGL_OPENGL_ES2_BIT, EGL_DEPTH_SIZE, 16, EGL_NONE };
        const TInt context[] = { EGL_CONTEXT_CLIENT_VERSION, TInt(version), EGL_NONE };
        TInt config = 0, configs = 0, width = 0, height = 0;
        if (!egl.eglInitialize() || !egl.eglChooseConfig(attributes, config, configs) || configs != 1 ||
            !egl.eglCreateWindowSurface(config, window) || !egl.eglQuerySurface(EGL_WIDTH, width) ||
            !egl.eglQuerySurface(EGL_HEIGHT, height) || !egl.eglCreateContext(config, context) || !egl.eglMakeCurrent(true))
            return result = egl.eglGetError();

        if (mode == 1) {
            egl.Gl(gles1::glMatrixMode, GL_PROJECTION);
            egl.Gl(gles1::glLoadIdentity);
            egl.Gl(gles1::glMatrixMode, GL_MODELVIEW);
            egl.Gl(gles1::glLoadIdentity);
            egl.Gl(gles1::glEnableClientState, GL_VERTEX_ARRAY);
            egl.Gl(gles1::glEnableClientState, GL_TEXTURE_COORD_ARRAY);
            egl.Gl(gles1::glEnable, GL_TEXTURE_2D);
        } else if (!Program()) return result = 2001;

        TUint texture = 0;
        if (!egl.Query(Pick(gles1::glGenTextures, gles2::glGenTextures), &texture, 4, 1, Output{4}) || !texture)
            return result = 2002;
        egl.Gl(Pick(gles1::glBindTexture, gles2::glBindTexture), GL_TEXTURE_2D, texture);
        const TInt parameter = Pick(gles1::glTexParameteri, gles2::glTexParameteri);
        egl.Gl(parameter, GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        egl.Gl(parameter, GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        egl.Gl(Pick(gles1::glTexImage2D, gles2::glTexImage2D), GL_TEXTURE_2D, 0, GL_RGBA, 2, 2, 0,
            GL_RGBA, GL_UNSIGNED_BYTE, Bytes(KTexture));
        egl.Gl(Pick(gles1::glViewport, gles2::glViewport), 0, 0, width, height);
        egl.Gl(Pick(gles1::glEnable, gles2::glEnable), GL_DEPTH_TEST);
        egl.Gl(Pick(gles1::glDepthFunc, gles2::glDepthFunc), GL_LESS);
        return result = KErrNone;
    }

    void Draw(const float (&vertices)[12], const float (&coords)[8], float alpha) {
        if (mode == 1) {
            egl.Gl(gles1::glColor4f, 1.f, 1.f, 1.f, alpha);
            egl.Gl(gles1::glVertexPointerData, 3, GL_FLOAT, 0, Bytes(vertices), TUint(sizeof(vertices)));
            egl.Gl(gles1::glTexCoordPointerData, 0, 2, GL_FLOAT, 0, Bytes(coords), TUint(sizeof(coords)));
            egl.Gl(gles1::glDrawArrays, GL_TRIANGLE_STRIP, 0, 4);
        } else {
            egl.Gl(gles2::glUniform4f, tint, 1.f, 1.f, 1.f, alpha);
            egl.Gl(gles2::glVertexAttribPointerData, 0u, 3, GL_FLOAT, EglWindow::Byte{0}, 0, Bytes(vertices), TUint(sizeof(vertices)));
            egl.Gl(gles2::glVertexAttribPointerData, 1u, 2, GL_FLOAT, EglWindow::Byte{0}, 0, Bytes(coords), TUint(sizeof(coords)));
            egl.Gl(gles2::glDrawArrays, GL_TRIANGLE_STRIP, 0, 4);
        }
    }

    TInt Check() {
        const TInt positions[][2] = { {45,25}, {146,25}, {45,119}, {146,119}, {72,62}, {72,82} };
        const TInt expected[][3] = { {230,40,20}, {10,210,30}, {20,60,240}, {230,210,20}, {125,50,130}, {20,60,240} };
        bool pixels_ok = true;
        for (TUint i = 0; i < sizeof(samples) / sizeof(samples[0]); ++i) {
            TUint8 pixel[4] = {};
            if (!egl.Query(Pick(gles1::glReadPixels, gles2::glReadPixels), pixel, 4,
                positions[i][0], positions[i][1], 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, Output{4})) return egl.eglGetError();
            samples[i] = TUint(pixel[0]) << 16 | TUint(pixel[1]) << 8 | pixel[2];
            for (TInt component = 0; component < 3; ++component) {
                const TInt difference = TInt(pixel[component]) - expected[i][component];
                pixels_ok = pixels_ok && difference >= -2 && difference <= 2;
            }
        }
        TUint error = 0;
        if (!egl.Query(Pick(gles1::glGetError, gles2::glGetError), &error, 4)) return egl.eglGetError();
        return error ? TInt(error) : pixels_ok ? KErrNone : 2003;
    }

    void Frame() {
        const TInt enable = Pick(gles1::glEnable, gles2::glEnable);
        const TInt disable = Pick(gles1::glDisable, gles2::glDisable);
        egl.Gl(Pick(gles1::glClearColor, gles2::glClearColor), frames & 1 ? .28f : .08f, .13f, .24f, 1.f);
        egl.Gl(Pick(gles1::glClear, gles2::glClear), GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        egl.Gl(disable, GL_BLEND);
        Draw(KBoard, KTexCoords, 1.f);
        egl.Gl(enable, GL_BLEND);
        egl.Gl(Pick(gles1::glBlendFunc, gles2::glBlendFunc), GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        Draw(KNear, KNarrowCoords, .5f);
        Draw(KFar, KTexCoords, 1.f);
        const TInt read_result = frames == 0 ? Check() : KErrNone;
        if (read_result && read_result != 2003) result = read_result;
        else if (!egl.eglSwapBuffers()) result = egl.eglGetError();
        else {
            ++frames;
            result = read_result;
        }
        if (result && result != 2003) {
            egl.eglDestroyContext();
            egl.eglDestroySurface();
        }
    }
};

TInt Run(RWsSession& ws, CWsScreenDevice& screen, CWindowGc& gc) {
    CFont* font = nullptr;
    TInt error = screen.GetNearestFontToDesignHeightInTwips(font, TFontSpec(_L(""), 150));
    if (error != KErrNone) return error;
    const TSize screen_size = screen.SizeInPixels();
    RWindowGroup group(ws);
    RWindow shell(ws), picture(ws);
    RTimer timer;
    error = timer.CreateLocal();
    if (error == KErrNone) error = group.Construct(1, ETrue);
    if (error == KErrNone) error = shell.Construct(group, 2);
    if (error == KErrNone) error = picture.Construct(shell, 3);
    if (error == KErrNone) {
        Scene scene;
        const TInt quarter = screen_size.iWidth >> 2;
        const TInt footer = screen_size.iHeight - 70;
        group.SetOrdinalPosition(0);
        shell.SetExtent(TPoint(0, 0), screen_size);
        shell.Activate();
        picture.SetExtent(TPoint(24, KPictureY), TSize(KWidth, KHeight));
        picture.Activate();
        picture.SetVisible(ETrue);
        shell.SetVisible(ETrue);
        ws.Flush();

        TRequestStatus event, redraw, tick;
        ws.EventReady(&event);
        ws.RedrawReady(&redraw);
        timer.After(tick, 100000);
        TInt requested = 1, read_status = KErrNone;
        bool foreground = true, running = true;
        while (running) {
            if (event == KRequestPending && redraw == KRequestPending && tick == KRequestPending) User::WaitForAnyRequest();
            if (event != KRequestPending) {
                TWsEvent next;
                ReadEvent(&ws, next);
                if (next.Type() == EEventFocusLost) foreground = false;
                if (next.Type() == EEventFocusGained) foreground = true;
                if (next.Type() == EEventKey && next.Key()->iCode == EKeyEscape) running = false;
                if (next.Type() == EEventPointer && next.Handle() == 2 &&
                    next.Pointer()->iType == TPointerEvent::EButton1Down && next.Pointer()->iPosition.iY >= footer) {
                    const TInt x = next.Pointer()->iPosition.iX;
                    if (x >= 3 * quarter) running = false;
                    else requested = x < quarter ? 1 : 2;
                }
                ws.EventReady(&event);
            }
            if (running && tick != KRequestPending) {
                if (foreground && requested) {
                    read_status = KErrNone;
                    scene.Start(requested, picture);
                    requested = 0;
                }
                if (foreground && (scene.result == KErrNone || scene.result == 2003)) {
                    scene.Frame();
                    if (scene.frames == 1 || scene.result) read_status = scene.result;
                }
                shell.Invalidate();
                picture.Invalidate();
                timer.After(tick, 70000);
            }
            if (running && redraw != KRequestPending) {
                TWsRedrawEvent next;
                ws.GetRedraw(next);
                RWindow& target = next.Handle() == 3 ? picture : shell;
                target.BeginRedraw(next.Rect());
                gc.Activate(target);
                gc.SetBrushColor(TRgb(0x142638));
                gc.Clear();
                if (next.Handle() == 3) scene.egl.Draw(gc, TPoint());
                else {
                    gc.SetPenColor(TRgb(0xF5F7F8));
                    gc.UseFont(font);
                    gc.DrawText(_L("v86 EGL / GLES"), TPoint(24, 38));
                    TBuf<48> count;
                    count.Append(scene.mode == 1 ? _L("ES 1.1  ") : _L("ES 2.0  "));
                    count.Append(_L("Swaps "));
                    count.AppendNum(scene.frames);
                    gc.DrawText(count, TPoint(24, 71));
                    TBuf<48> status;
                    status.Append(_L("Readback "));
                    status.AppendNum(scene.result && scene.result != 2003 ? scene.result : read_status);
                    gc.SetPenColor(TRgb(scene.frames && !read_status ? 0xB3FFA8 : 0xFFB84F));
                    gc.DrawText(status, TPoint(24, 96));
                    for (TInt row = 0; row < 2; ++row) {
                        TBuf<32> text;
                        for (TInt j = 0; j < 3; ++j) {
                            text.AppendNumFixedWidth(scene.samples[3 * row + j], EHex, 6);
                            text.Append(TChar(' '));
                        }
                        gc.DrawText(text, TPoint(24, KPictureY + KHeight + 25 + row * 24));
                    }
                    gc.SetPenColor(TRgb(0xF5F7F8));
                    gc.DrawText(_L("ES 1.1"), TPoint(18, footer + 35));
                    gc.DrawText(_L("ES 2.0"), TPoint(2 * quarter - 25, footer + 35));
                    gc.DrawText(_L("Exit"), TPoint(3 * quarter + 12, footer + 35));
                    gc.DiscardFont();
                }
                gc.Deactivate();
                target.EndRedraw();
                ws.RedrawReady(&redraw);
            }
            ws.Flush();
        }
        timer.Cancel();
        ws.EventReadyCancel();
        ws.RedrawReadyCancel();
        if (event == KRequestPending) User::WaitForRequest(event);
        if (redraw == KRequestPending) User::WaitForRequest(redraw);
    }
    timer.Close();
    picture.Close();
    shell.Close();
    group.Close();
    screen.ReleaseFont(font);
    return error;
}

TInt Main() {
    RFbsSession fbs;
    TInt error = fbs.Connect();
    if (error != KErrNone) return error;
    RWsSession ws;
    error = ws.Connect();
    if (error == KErrNone) {
        CWsScreenDevice screen(ws);
        error = screen.Construct();
        if (error == KErrNone) {
            CWindowGc gc(&screen);
            error = gc.Construct();
            if (error == KErrNone) error = Run(ws, screen, gc);
        }
        ws.Close();
    }
    fbs.Disconnect();
    return error;
}
} // namespace

extern "C" void RunGlesThread(TInt reason, SStdEpocThreadCreateInfo& info) {
    if (reason != 0 && reason != 1) User::Invariant();
    const TBool secondary = reason == 1;
    TInt error = UserHeap::SetupThreadHeap(secondary, info);
    if (error == KErrNone && secondary) error = info.iFunction(info.iPtr);
    else if (error == KErrNone) {
        User::InitProcess();
        CTrapCleanup* cleanup = CTrapCleanup::New();
        if (cleanup) {
            error = Main();
            delete cleanup;
        } else error = KErrNoMemory;
    }
    User::Exit(error);
}
