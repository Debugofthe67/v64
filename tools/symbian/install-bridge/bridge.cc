// SPDX-License-Identifier: BSD-2-Clause
#include <apgcli.h>
#include <c32comm.h>
#include <e32base.h>
#include <e32svr.h>
#include <f32file.h>
#include <u32std.h>

namespace {
constexpr TInt KCommandBytes = 512;
_LIT(KFolder, "E:\\INSTALL\\");

TInt OpenPackage(RFs& files, const TDesC8& command) {
    if (command.Length() != KCommandBytes) return KErrArgument;
    const TUint8* bytes = command.Ptr();
    const TInt units = bytes[0] | (bytes[1] << 8);
    TFileName path(KFolder);
    if (!units || units * 2 + 2 > command.Length() || units > path.MaxLength() - path.Length())
        return KErrBadName;
    for (TInt index = 0; index < units; ++index) {
        const TInt at = 2 + index * 2;
        const TUint ch = bytes[at] | (bytes[at + 1] << 8);
        if (ch < 32 || ch == ':' || ch == '/' || ch == '\\' || ch == '*' || ch == '?')
            return KErrBadName;
        path.Append(TChar(ch));
    }
    _LIT(KSis, ".sis");
    _LIT(KSisx, ".sisx");
    const TInt dot = path.LocateReverse('.');
    if (dot < KFolder().Length() ||
        (path.Mid(dot).CompareF(KSis) && path.Mid(dot).CompareF(KSisx))) return KErrBadName;

    RFile package;
    TInt result = package.Open(files, path, EFileRead | EFileShareReadersOnly);
    if (result != KErrNone) return result;
    RApaLsSession apps;
    result = apps.Connect();
    if (result == KErrNone) {
        TThreadId thread;
        // SWInstSvrUI is the stock S60 handler for x-epoc/x-sisx-app.
        result = apps.StartDocument(package, TUid::Uid(0x101f875a), thread);
        apps.RHandleBase::Close();
    }
    package.Close();
    return result;
}

TInt Write(RComm& port, const TDesC8& data) {
    TRequestStatus written;
    port.Write(written, data);
    User::WaitForRequest(written);
    return written.Int();
}

TInt Serve() {
    RFs files;
    TInt error = files.Connect();
    if (error != KErrNone) return error;
    error = files.ShareProtected();
    RCommServ server;
    RComm port;
    if (error == KErrNone) error = server.Connect();
    if (error == KErrNone) error = server.LoadCommModule(_L("ECUART"));
    if (error == KErrAlreadyExists) error = KErrNone;
    if (error == KErrNone) error = port.Open(server, _L("COMM::1"), ECommExclusive);
    if (error == KErrNone) {
        TCommConfig config;
        port.Config(config);
        config().iRate = EBps115200;
        config().iDataBits = EData8;
        config().iStopBits = EStop1;
        config().iParity = EParityNone;
        config().iHandshake = 0;
        config().iTerminatorCount = 0;
        error = port.SetConfig(config);
    }
    while (error == KErrNone) {
        TRequestStatus read;
        TBuf8<KCommandBytes> command;
        port.Read(read, command, KCommandBytes);
        _LIT8(KReady, "V8I+");
        error = Write(port, KReady);
        if (error != KErrNone) port.ReadCancel();
        User::WaitForRequest(read);
        if (error != KErrNone) break;
        const TInt result = read.Int() != KErrNone ? read.Int() : OpenPackage(files, command);
        TBuf8<8> reply(_L8("V8I="));
        const TUint bits = static_cast<TUint>(result);
        for (TInt i = 0; i < 4; ++i) reply.Append((bits >> (8 * i)) & 255);
        error = Write(port, reply);
    }
    port.Close();
    server.Close();
    files.RHandleBase::Close();
    return error;
}
}  // namespace

extern "C" void RunNotesThread(TInt reason, SStdEpocThreadCreateInfo& info) {
    if (reason != 0 && reason != 1) User::Invariant();
    const TBool secondary = reason == 1;
    TInt error = UserHeap::SetupThreadHeap(secondary, info);
    if (error == KErrNone && secondary) error = info.iFunction(info.iPtr);
    else if (error == KErrNone) {
        User::InitProcess();
        CTrapCleanup* cleanup = CTrapCleanup::New();
        if (cleanup) {
            error = Serve();
            delete cleanup;
        } else error = KErrNoMemory;
    }
    RDebug::Print(_L("v86 SIS bridge exited: %d"), error);
    User::Exit(error);
}
