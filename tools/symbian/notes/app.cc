// SPDX-License-Identifier: BSD-2-Clause
#include <e32base.h>
#include <e32keys.h>
#include <f32file.h>
#include <u32std.h>
#include <w32std.h>

namespace {
_LIT(KNote, "note.txt");
_LIT(KTemporary, "note.tmp");
constexpr TInt KNoteLength = 96;
// The N97 SDK exports the non-const Window Server method at ordinal 72.
extern "C" void ReadEvent(RWsSession*, TWsEvent&) asm("_ZN10RWsSession8GetEventER8TWsEvent");

TInt Save(RFs& files, const TDesC& text) {
    TBuf8<KNoteLength> bytes;
    bytes.Copy(text);
    RFile temporary;
    TInt error = temporary.Replace(files, KTemporary, EFileWrite);
    if (error != KErrNone) return error;
    error = temporary.Write(bytes);
    if (error == KErrNone) error = temporary.Flush();
    temporary.Close();
    if (error == KErrNone) error = files.Replace(KTemporary, KNote);
    if (error != KErrNone) files.Delete(KTemporary);
    return error;
}

TInt Run(RWsSession& session, CWsScreenDevice& screen, CWindowGc& gc, RFs& files) {
    const TSize size = screen.SizeInPixels();
    if (size.iWidth < 176 || size.iHeight < 208) return KErrNotSupported;
    CFont* font = nullptr;
    TInt error = screen.GetNearestFontToDesignHeightInTwips(font, TFontSpec(_L(""), 150));
    if (error != KErrNone) return error;
    RWindowGroup group(session);
    RWindow window(session);
    error = group.Construct(1, ETrue);
    if (error == KErrNone) error = window.Construct(group, 2);
    if (error == KErrNone) {
        TBuf<KNoteLength> text;
        RFile note;
        if (note.Open(files, KNote, EFileRead) == KErrNone) {
            TBuf8<KNoteLength> bytes;
            if (note.Read(bytes) == KErrNone) text.Copy(bytes);
            note.Close();
        }
        const TInt footer = size.iHeight - 54;
        const TInt quarter = size.iWidth >> 2;
        const TInt width = size.iWidth >= 320 ? 26 : 16;
        const TDesC* message = nullptr;
        group.SetOrdinalPosition(0);
        window.SetExtent(TPoint(0, 0), size);
        window.SetVisible(ETrue);
        window.Activate();
        TRequestStatus key, paint;
        session.EventReady(&key);
        session.RedrawReady(&paint);
        window.Invalidate();
        session.Flush();
        bool running = true;
        while (running) {
            if (key == KRequestPending && paint == KRequestPending) User::WaitForRequest(key, paint);
            if (key != KRequestPending) {
                error = key.Int();
                if (error != KErrNone) break;
                TWsEvent event;
                ReadEvent(&session, event);
                TInt action = 0;
                if (event.Type() == EEventKey) action = event.Key()->iCode;
                if (event.Handle() == 2 && event.Type() == EEventPointer &&
                    event.Pointer()->iType == TPointerEvent::EButton1Down && event.Pointer()->iPosition.iY >= footer) {
                    const TInt x = event.Pointer()->iPosition.iX;
                    action = x < quarter ? EKeyF2 : x >= 3 * quarter ? EKeyEscape : EKeyF3;
                }
                if (action == EKeyEscape) running = false;
                else if (action == EKeyF2) {
                    _LIT(KSaved, "Saved to note.txt");
                    _LIT(KFailed, "Could not save note");
                    message = Save(files, text) == KErrNone ? &KSaved() : &KFailed();
                } else if (action == EKeyF3 && NOTES_VERSION == 2) {
                    text.Zero();
                    message = nullptr;
                } else if (action == EKeyBackspace && text.Length()) {
                    text.SetLength(text.Length() - 1);
                    message = nullptr;
                } else if (action >= 32 && action <= 126 && text.Length() < KNoteLength) {
                    text.Append(TChar(action));
                    message = nullptr;
                }
                if (running) {
                    session.EventReady(&key);
                    window.Invalidate();
                }
            }
            if (running && paint != KRequestPending) {
                error = paint.Int();
                if (error != KErrNone) break;
                TWsRedrawEvent event;
                session.GetRedraw(event);
                window.BeginRedraw(event.Rect());
                gc.Activate(window);
                gc.SetBrushColor(TRgb(0xF7F2DE));
                gc.Clear();
                gc.SetPenColor(TRgb(0x172D20));
                gc.UseFont(font);
                gc.DrawText(NOTES_VERSION == 1 ? _L("v86 Notes 1.0") : _L("v86 Notes 2.0"), TPoint(12, 38));
                gc.DrawText(_L("Type a short note"), TPoint(12, 68));
                TInt y = 92;
                for (TInt at = 0; at < text.Length() && y < footer - 20; at += width, y += font->HeightInPixels() + 4) {
                    gc.DrawText(text.Mid(at, Min(width, text.Length() - at)), TPoint(12, y));
                }
                if (message) gc.DrawText(*message, TPoint(12, footer - 6));
                gc.DrawText(_L("Save"), TPoint(12, footer + 30));
                if (NOTES_VERSION == 2) gc.DrawText(_L("Clear"), TPoint(2 * quarter - 18, footer + 30));
                gc.DrawText(_L("Exit"), TPoint(3 * quarter + 8, footer + 30));
                gc.DiscardFont();
                gc.Deactivate();
                window.EndRedraw();
                session.RedrawReady(&paint);
            }
            session.Flush();
        }
        session.EventReadyCancel();
        session.RedrawReadyCancel();
        if (key == KRequestPending) User::WaitForRequest(key);
        if (paint == KRequestPending) User::WaitForRequest(paint);
    }
    window.Close();
    group.Close();
    screen.ReleaseFont(font);
    return error;
}
}  // namespace

static TInt NotesMain() {
    RFs files;
    TInt error = files.Connect();
    if (error != KErrNone) return error;
    error = files.CreatePrivatePath(EDriveC);
    if (error == KErrAlreadyExists) error = KErrNone;
    if (error == KErrNone) error = files.SetSessionToPrivate(EDriveC);
    RWsSession session;
    if (error == KErrNone) error = session.Connect();
    if (error == KErrNone) {
        CWsScreenDevice screen(session);
        error = screen.Construct();
        if (error == KErrNone) {
            CWindowGc gc(&screen);
            error = gc.Construct();
            if (error == KErrNone) error = Run(session, screen, gc, files);
        }
        session.Close();
    }
    files.RHandleBase::Close();
    return error;
}

extern "C" void RunNotesThread(TInt reason, SStdEpocThreadCreateInfo& info) {
    if (reason != 0 && reason != 1) User::Invariant();
    const TBool secondary = reason == 1;
    TInt error = UserHeap::SetupThreadHeap(secondary, info);
    if (error == KErrNone && secondary) error = info.iFunction(info.iPtr);
    else if (error == KErrNone) {
        User::InitProcess();
        CTrapCleanup* cleanup = CTrapCleanup::New();
        if (cleanup) {
            error = NotesMain();
            delete cleanup;
        } else error = KErrNoMemory;
    }
    User::Exit(error);
}
