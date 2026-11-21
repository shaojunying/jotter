using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Interop;

namespace Jotter;

/// <summary>Where Jotter keeps its data. JOTTER_DATA_DIR overrides the root (used by tests).</summary>
static class Paths
{
    public static readonly string Root =
        Environment.GetEnvironmentVariable("JOTTER_DATA_DIR") is { Length: > 0 } dir
            ? Path.GetFullPath(dir)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jotter");

    public static string Sessions => Directory.CreateDirectory(Path.Combine(Root, "sessions")).FullName;
    public static string WebViewData => Path.Combine(Root, "WebView2");
    public static string Placement => Path.Combine(Root, "window.json");
    public static string WwwRoot => Path.Combine(AppContext.BaseDirectory, "wwwroot");

    /// <summary>Per-user, per-data-folder key for the single-instance mutex and pipe.</summary>
    public static readonly string InstanceKey = "Jotter-" + Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserName + "|" + Root.ToLowerInvariant())))[..16];

    static readonly object LogLock = new();

    public static void Log(string message)
    {
        try
        {
            lock (LogLock)
            {
                Directory.CreateDirectory(Root);
                var file = Path.Combine(Root, "jotter.log");
                if (File.Exists(file) && new FileInfo(file).Length > 1_000_000) File.Delete(file);
                File.AppendAllText(file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // logging must never take the app down
        }
    }
}

/// <summary>Each window's tabs (including unsaved text) live in sessions/&lt;windowId&gt;.json.</summary>
static class SessionStore
{
    static string FileFor(string id) => Path.Combine(Paths.Sessions, id + ".json");

    public static List<string> ListIds() =>
        Directory.GetFiles(Paths.Sessions, "*.json")
            .OrderBy(File.GetLastWriteTimeUtc)
            .Select(f => Path.GetFileNameWithoutExtension(f))
            .ToList();

    public static string? Load(string id)
    {
        var f = FileFor(id);
        return File.Exists(f) ? File.ReadAllText(f, Encoding.UTF8) : null;
    }

    public static void Save(string id, string json)
    {
        var f = FileFor(id);
        var tmp = f + ".tmp";
        File.WriteAllText(tmp, json, new UTF8Encoding(false));
        File.Move(tmp, f, overwrite: true);
    }

    public static void Delete(string id)
    {
        try { File.Delete(FileFor(id)); }
        catch (Exception ex) { Paths.Log($"delete session {id}: {ex.Message}"); }
    }
}

static class Native
{
    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int processId);

    public const int ASFW_ANY = -1;
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

    const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    const int DWMWA_BORDER_COLOR = 34;
    const int DWMWA_CAPTION_COLOR = 35;
    const int DWMWA_TEXT_COLOR = 36;
    const int DWMWCP_ROUND = 2;

    static int ColorRef(System.Windows.Media.Color c) => c.R | (c.G << 8) | (c.B << 16);

    /// <summary>
    /// Dark, rounded window whose title bar has the same colour as the toolbar below it,
    /// so the two read as one unified bar (macOS style). Colour attributes need Windows 11.
    /// </summary>
    public static void StyleTitleBar(Window window, System.Windows.Media.Color caption, System.Windows.Media.Color text)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        int dark = 1;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
        int corner = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
        int captionColor = ColorRef(caption);
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref captionColor, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref captionColor, sizeof(int));
        int textColor = ColorRef(text);
        DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, ref textColor, sizeof(int));
    }
}
