"""Memory counters without importing a monitoring package into the solver."""
import os
import sys


def memory_mb(pid=None, peak=False):
    pid = pid or os.getpid()
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ('peak', 'rss', 'qpp', 'qp', 'qnp', 'qn', 'page', 'peakpage')]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        query = ctypes.WinDLL('psapi').GetProcessMemoryInfo
        query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        handle = kernel.OpenProcess(0x410, False, pid)
        if not handle:
            return 0.0
        try:
            counters = Counters()
            counters.cb = ctypes.sizeof(counters)
            if not query(handle, ctypes.byref(counters), counters.cb):
                return 0.0
            return (counters.peak if peak else counters.rss) / 1048576
        finally:
            kernel.CloseHandle(handle)
    if sys.platform.startswith('linux'):
        try:
            with open(f'/proc/{pid}/status') as stream:
                for line in stream:
                    if line.startswith('VmHWM:' if peak else 'VmRSS:'):
                        return int(line.split()[1]) / 1024
        except FileNotFoundError:
            pass
        return 0.0
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1048576 if sys.platform == 'darwin' else 1024)
