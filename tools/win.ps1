# Test helper: close or activate a top-level window by (partial) title.
#   win.ps1 close "utf8.md - Jotter"
#   win.ps1 activate "gbk"
param([ValidateSet('close', 'activate')][string]$Action, [string]$Title)

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JotterWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public static IntPtr Find(string part) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            var t = sb.ToString();
            if (t.Contains(part) && t.EndsWith("Jotter")) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$h = [JotterWin]::Find($Title)
if ($h -eq [IntPtr]::Zero) { Write-Output "window not found: $Title"; exit 1 }
if ($Action -eq 'close') { [JotterWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
else { [JotterWin]::SetForegroundWindow($h) | Out-Null }
Write-Output "$Action ok"
