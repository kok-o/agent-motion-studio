"""Isolated Windows console Ctrl+C harness. Never targets the user's console.

GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) broadcasts only in our freshly allocated
hidden console. Commands inherit that console; no CREATE_NEW_PROCESS_GROUP,
SIGTERM, taskkill, or process.kill is used to initiate cancellation.
"""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
                ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]


def main():
    if sys.platform != "win32":
        raise RuntimeError("This harness requires Windows.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    report_path = Path(config["reportPath"]).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetConsoleWindow.restype = wintypes.HWND
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.GetConsoleProcessList.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
    invalid_handle = ctypes.c_void_p(-1).value
    kernel.FreeConsole()
    if not kernel.AllocConsole():
        raise ctypes.WinError(ctypes.get_last_error())
    ctypes.WinDLL("user32").ShowWindow(kernel.GetConsoleWindow(), 0)
    handler_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
    # A callback protects only this Python helper, without the inheritable ignore flag.
    callback = handler_type(lambda event: True)
    if not kernel.SetConsoleCtrlHandler(callback, True):
        raise ctypes.WinError(ctypes.get_last_error())
    iphlp = ctypes.WinDLL("iphlpapi")
    iphlp.GetExtendedTcpTable.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL, wintypes.ULONG, wintypes.ULONG, wintypes.ULONG]

    def snapshot():
        handle = kernel.CreateToolhelp32Snapshot(2, 0)
        if handle == invalid_handle:
            raise ctypes.WinError(ctypes.get_last_error())
        rows = []
        try:
            entry = PROCESSENTRY32W(); entry.dwSize = ctypes.sizeof(entry)
            valid = kernel.Process32FirstW(handle, ctypes.byref(entry))
            while valid:
                rows.append({"pid": entry.th32ProcessID, "parentPid": entry.th32ParentProcessID, "name": entry.szExeFile})
                valid = kernel.Process32NextW(handle, ctypes.byref(entry))
        finally:
            kernel.CloseHandle(handle)
        return rows

    def descendants(rows, pid):
        selected = {pid}; change = True
        while change:
            change = False
            for row in rows:
                if row["parentPid"] in selected and row["pid"] not in selected:
                    selected.add(row["pid"]); change = True
        return [row for row in rows if row["pid"] in selected]

    def listeners(pid):
        size = wintypes.DWORD(0)
        iphlp.GetExtendedTcpTable(None, ctypes.byref(size), False, 2, 5, 0)
        buffer = ctypes.create_string_buffer(size.value)
        code = iphlp.GetExtendedTcpTable(buffer, ctypes.byref(size), False, 2, 5, 0)
        if code:
            raise OSError(code, "GetExtendedTcpTable")
        data = buffer.raw; count = struct.unpack_from("I", data, 0)[0]
        rows = []
        for index in range(count):
            state, address, port, _, _, owner = struct.unpack_from("6I", data, 4 + index * 24)
            if owner == pid and state == 2:
                rows.append({"pid": owner, "address": socket.inet_ntoa(struct.pack("I", address)), "port": socket.ntohs(port & 65535)})
        return rows

    started = time.monotonic()
    stdout_path = report_path.with_suffix(".stdout.log")
    stderr_path = report_path.with_suffix(".stderr.log")
    record = {"method": "Win32 GenerateConsoleCtrlEvent(CTRL_C_EVENT=0, processGroupId=0)",
              "scope": "fresh hidden AllocConsole, only harness and its own command/descendants",
              "helperPid": os.getpid(), "command": config["command"], "cwd": config["cwd"],
              "stdoutPath": str(stdout_path), "stderrPath": str(stderr_path), "phase": config.get("phase", "none")}
    owned_handles = {}
    try:
        with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
            child = subprocess.Popen(config["command"], cwd=config["cwd"], stdout=stdout, stderr=stderr, stdin=subprocess.DEVNULL, env={**os.environ, **config.get("env", {})})
            record["commandPid"] = child.pid
            if record["phase"] != "none":
                ready = False
                timeout = time.monotonic() + config.get("readinessTimeoutSeconds", 90)
                while child.poll() is None and time.monotonic() < timeout:
                    own = descendants(snapshot(), child.pid)
                    for row in own:
                        if row["pid"] not in owned_handles:
                            handle = kernel.OpenProcess(0x00100000 | 0x1000 | 0x0001, False, row["pid"])
                            if handle:
                                owned_handles[row["pid"]] = (handle, row)
                    out = Path(config["out"])
                    stages = list(out.glob(".job-*"))
                    frame_count = sum(len(list((stage / "frames").glob("*.png"))) for stage in stages)
                    live_chrome = any(row["name"].lower() in ("chrome.exe", "msedge.exe") for row in own)
                    live_ffmpeg = any(row["name"].lower() == "ffmpeg.exe" for row in own)
                    tcp = listeners(child.pid)
                    ready = live_chrome and bool(tcp) and frame_count >= config.get("frameThreshold", 2) if record["phase"] == "frames" else frame_count == config["totalFrames"] and live_ffmpeg and any((stage / "contact-sheet.jpg").exists() for stage in stages)
                    if ready:
                        record.update({"ownedBefore": own, "loopbackBefore": tcp, "frameCountAtCancellation": frame_count})
                        break
                    time.sleep(.02)
                record["readinessReached"] = ready
                if not ready:
                    raise RuntimeError("Command finished or timed out before the requested cancellation phase.")
                console_pids = (wintypes.DWORD * 128)()
                console_count = kernel.GetConsoleProcessList(console_pids, 128)
                record["consolePidsBefore"] = list(console_pids)[:console_count]
                if child.pid not in record["consolePidsBefore"]:
                    raise RuntimeError("Command did not share the isolated helper console; refusing a misleading test.")
                record["eventGenerated"] = bool(kernel.GenerateConsoleCtrlEvent(0, 0))
                record["eventError"] = ctypes.get_last_error() if not record["eventGenerated"] else 0
                if not record["eventGenerated"]:
                    raise ctypes.WinError(record["eventError"])
                record["secondsToCtrlC"] = round(time.monotonic() - started, 3)
            record["exitCode"] = child.wait(timeout=config.get("completionTimeoutSeconds", 120))
        time.sleep(.25)
        record["ownedAfter"] = [row for handle, row in owned_handles.values() if kernel.WaitForSingleObject(handle, 0) != 0]
        record["loopbackAfter"] = listeners(record["commandPid"])
        record["emergencyCleanup"] = []
        record["elapsedSeconds"] = round(time.monotonic() - started, 3)
        record["stdout"] = stdout_path.read_text(encoding="utf-8", errors="replace")
        record["stderr"] = stderr_path.read_text(encoding="utf-8", errors="replace")
    except Exception as error:
        record["harnessError"] = str(error)
        record["emergencyCleanup"] = []
        # Only already-opened handles from this command's actual descendant tree.
        # Emergency termination fails acceptance; it is never presented as Ctrl+C.
        for handle, row in reversed(list(owned_handles.values())):
            if kernel.WaitForSingleObject(handle, 0) != 0:
                record["emergencyCleanup"].append(row)
                kernel.TerminateProcess(handle, 137)
        if "child" in locals() and child.poll() is None:
            child.kill(); child.wait(timeout=10)
    finally:
        for handle, _ in owned_handles.values():
            kernel.CloseHandle(handle)
        report_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        kernel.FreeConsole()
    print(json.dumps({"report": str(report_path), "exitCode": record.get("exitCode"), "harnessError": record.get("harnessError"), "ownedAfter": record.get("ownedAfter")}, ensure_ascii=False))
    return 1 if record.get("harnessError") else 0


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:
        import traceback
        config_index = sys.argv.index('--config') + 1
        fatal = Path(sys.argv[config_index]).with_suffix('.helper-fatal.log')
        fatal.write_text(traceback.format_exc(), encoding='utf-8')
        raise
    sys.exit(result)
