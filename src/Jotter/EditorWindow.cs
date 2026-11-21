using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Jotter;

/// <summary>
/// One editor window: a WebView2 running the web UI, plus the host side of its
/// message bridge (file dialogs, disk access, session storage, window state).
/// </summary>
public sealed class EditorWindow : Window
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif" };
    static string? _lastDir;

    readonly App _app;
    readonly WebView2 _web = new();
    readonly List<string> _pendingFiles;
    bool _jsReady;
    bool _closeConfirmed;
    bool _closePending;
    bool _closeAcked;

    public string WindowId { get; }

    public EditorWindow(App app, string windowId, string[] files)
    {
        _app = app;
        WindowId = windowId;
        _pendingFiles = [.. files];
        Title = "Jotter";
        Width = 1100;
        Height = 720;
        MinWidth = 420;
        MinHeight = 260;
        Content = _web;
        try
        {
            Icon = BitmapFrame.Create(new Uri("pack://application:,,,/jotter.ico"));
        }
        catch (Exception ex)
        {
            Paths.Log("icon: " + ex.Message);
        }
        ApplyTheme();

        SourceInitialized += (_, _) => ApplyTheme();
        Loaded += async (_, _) => await InitAsync();
        Activated += (_, _) =>
        {
            if (!_web.IsKeyboardFocusWithin) _web.Focus();
            Post("activated", null);
        };
        Closing += OnClosing;
    }

    public void ApplyTheme()
    {
        // Same colour as the page's window canvas (--canvas in style.css): no white flash before
        // the page paints, and the title bar blends into the toolbar.
        var canvas = Color.FromRgb(0x16, 0x16, 0x18);
        Background = new SolidColorBrush(canvas);
        _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(canvas.R, canvas.G, canvas.B);
        Native.StyleTitleBar(this, canvas, Color.FromRgb(0xd4, 0xd4, 0xd4));
    }

    async Task InitAsync()
    {
        try
        {
            await _web.EnsureCoreWebView2Async(App.WebEnv);
        }
        catch (Exception ex)
        {
            Paths.Log("webview init: " + ex);
            MessageBox.Show(this, "编辑器组件加载失败：" + ex.Message, "Jotter");
            ForceClose();
            return;
        }
        var core = _web.CoreWebView2;
        var s = core.Settings;
        s.AreBrowserAcceleratorKeysEnabled = false; // no Ctrl+F browser find, F5 reload, Ctrl+P print...
        s.IsZoomControlEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("JOTTER_DEVTOOLS") == "1";

        core.SetVirtualHostNameToFolderMapping("app.jotter", Paths.WwwRoot, CoreWebView2HostResourceAccessKind.Deny);
        core.AddWebResourceRequestedFilter("https://localfile.jotter/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeLocalFile;
        core.WebMessageReceived += OnWebMessage;
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith("https://app.jotter/", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                OpenExternal(e.Uri);
            }
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        core.ProcessFailed += (_, e) => Paths.Log($"webview process failed: {e.ProcessFailedKind}");
        // The query changes whenever the UI is rebuilt, so an updated index.html is never served from cache.
        var stamp = File.GetLastWriteTimeUtc(Path.Combine(Paths.WwwRoot, "index.html")).Ticks;
        core.Navigate($"https://app.jotter/index.html?v={stamp}");
    }

    // ------------------------------------------------------------------ bridge

    void Post(string evt, object? data)
    {
        if (!_jsReady) return;
        try
        {
            _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event = evt, data }, Json));
        }
        catch (Exception ex)
        {
            Paths.Log($"post {evt}: {ex.Message}");
        }
    }

    void Reply(object message)
    {
        try
        {
            _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException)
        {
            // window already closed
        }
    }

    async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(e.WebMessageAsJson).RootElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }
        int? id = root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number ? idEl.GetInt32() : null;
        var method = root.TryGetProperty("method", out var m) ? m.GetString() ?? "" : "";
        var p = root.TryGetProperty("params", out var pe) && pe.ValueKind == JsonValueKind.Object ? pe : default;

        try
        {
            // Dropped files must be read before the first await: the objects die with the event.
            object? result = method == "dropFiles" ? HandleDrop(e) : await Handle(method, p);
            if (id != null) Reply(new { id, result });
        }
        catch (Exception ex)
        {
            if (ex is not UserException) Paths.Log($"{method}: {ex}");
            if (id != null) Reply(new { id, error = ex.Message });
        }
    }

    static string Str(JsonElement p, string name) =>
        p.ValueKind == JsonValueKind.Object && p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()! : "";

    static string? StrOrNull(JsonElement p, string name)
    {
        var s = Str(p, name);
        return s.Length > 0 ? s : null;
    }

    async Task<object?> Handle(string method, JsonElement p)
    {
        switch (method)
        {
            case "init":
                _jsReady = true;
                return Init();

            case "readFile":
                return await Task.Run(() => FileService.Read(Str(p, "path")));

            case "openDialog":
                return OpenDialog(StrOrNull(p, "dir"));

            case "saveFile":
            {
                var path = Str(p, "path");
                var content = Str(p, "content");
                var enc = Str(p, "encoding");
                var eol = Str(p, "eol");
                var mtime = await Task.Run(() => FileService.Write(path, content, enc, eol));
                return new { mtime };
            }

            case "saveAs":
                return SaveAs(p);

            case "stat":
            {
                var result = new Dictionary<string, long?>();
                foreach (var el in p.GetProperty("paths").EnumerateArray())
                {
                    var path = el.GetString();
                    if (path != null) result[path] = FileService.MtimeOrNull(path);
                }
                return result;
            }

            case "saveSession":
                if (!_closeConfirmed) SessionStore.Save(WindowId, p.GetProperty("session").GetRawText());
                return true;

            case "newWindow":
                _app.OpenWindow(null, []).BringToFront();
                return null;

            case "openExternal":
                OpenExternal(Str(p, "url"));
                return null;

            case "reveal":
            {
                var path = Str(p, "path");
                if (File.Exists(path)) Process.Start("explorer.exe", $"/select,\"{path}\"");
                return null;
            }

            case "setTitle":
                Title = Str(p, "title");
                return null;

            case "closeAck":
                _closeAcked = true;
                return null;

            case "closeCancelled":
                _closePending = false;
                _closeAcked = false;
                return null;

            case "closeWindow":
            {
                bool keep = p.TryGetProperty("keepSession", out var k) && k.ValueKind == JsonValueKind.True;
                if (!keep) SessionStore.Delete(WindowId);
                _closeConfirmed = true;
                _ = Dispatcher.BeginInvoke(Close);
                return null;
            }

            default:
                throw new InvalidOperationException("unknown method " + method);
        }
    }

    object Init()
    {
        JsonElement? session = null;
        var raw = SessionStore.Load(WindowId);
        if (raw != null)
        {
            try { session = JsonDocument.Parse(raw).RootElement.Clone(); }
            catch (JsonException ex) { Paths.Log($"bad session {WindowId}: {ex.Message}"); }
        }
        var (files, errors) = ReadMany(_pendingFiles);
        _pendingFiles.Clear();
        return new { windowId = WindowId, session, files, errors };
    }

    static (List<FileData> Files, List<string> Errors) ReadMany(IEnumerable<string> paths)
    {
        var files = new List<FileData>();
        var errors = new List<string>();
        foreach (var path in paths)
        {
            try
            {
                files.Add(FileService.Read(path));
            }
            catch (Exception ex)
            {
                errors.Add($"打不开 {Path.GetFileName(path)}：{ex.Message}");
            }
        }
        return (files, errors);
    }

    object? HandleDrop(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var paths = e.AdditionalObjects?.OfType<CoreWebView2File>().Select(f => f.Path).ToList() ?? [];
        var (files, errors) = ReadMany(paths.Where(File.Exists));
        var folders = paths.Count(Directory.Exists);
        if (folders > 0) errors.Add("暂不支持打开文件夹，请拖入文件");
        Post("openFiles", new { files, errors });
        return null;
    }

    object OpenDialog(string? dir)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "打开",
            Filter = "Markdown 和文本 (*.md;*.markdown;*.txt)|*.md;*.markdown;*.txt|所有文件 (*.*)|*.*",
            InitialDirectory = ExistingDir(dir) ?? ExistingDir(_lastDir) ?? "",
        };
        if (dlg.ShowDialog(this) != true) return new { files = Array.Empty<FileData>(), errors = Array.Empty<string>() };
        _lastDir = Path.GetDirectoryName(dlg.FileNames[0]);
        var (files, errors) = ReadMany(dlg.FileNames);
        return new { files, errors };
    }

    object? SaveAs(JsonElement p)
    {
        var suggested = Str(p, "suggestedName");
        var ext = Path.GetExtension(suggested).ToLowerInvariant();
        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            Title = "另存为",
            FileName = suggested,
            Filter = "Markdown (*.md)|*.md|文本 (*.txt)|*.txt|所有文件 (*.*)|*.*",
            FilterIndex = ext == ".txt" ? 2 : ext is ".md" or ".markdown" or "" ? 1 : 3,
            DefaultExt = ".md",
            AddExtension = true,
            OverwritePrompt = true,
            InitialDirectory = ExistingDir(StrOrNull(p, "dir")) ?? ExistingDir(_lastDir)
                ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dlg.ShowDialog(this) != true) return null;
        var path = dlg.FileName;
        _lastDir = Path.GetDirectoryName(path);
        var mtime = FileService.Write(path, Str(p, "content"), Str(p, "encoding"), Str(p, "eol"));
        return new { path, name = Path.GetFileName(path), mtime };
    }

    static string? ExistingDir(string? dir) => dir != null && Directory.Exists(dir) ? dir : null;

    static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme is not ("http" or "https" or "mailto")) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { Paths.Log("open external: " + ex.Message); }
    }

    /// <summary>Serves images referenced by Markdown files: https://localfile.jotter/?p=&lt;path&gt;.</summary>
    void ServeLocalFile(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = _web.CoreWebView2.Environment;
        try
        {
            var query = new Uri(e.Request.Uri).Query;
            var path = query.StartsWith("?p=") ? Uri.UnescapeDataString(query[3..]) : "";
            var ext = Path.GetExtension(path);
            if (path.Length == 0 || !ImageTypes.Contains(ext) || !File.Exists(path))
            {
                e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }
            var mime = ext.ToLowerInvariant() switch
            {
                ".svg" => "image/svg+xml",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".ico" => "image/x-icon",
                _ => "image/" + ext.TrimStart('.').ToLowerInvariant(),
            };
            var stream = new MemoryStream(File.ReadAllBytes(path));
            e.Response = env.CreateWebResourceResponse(stream, 200, "OK",
                $"Content-Type: {mime}\nCache-Control: no-cache");
        }
        catch (Exception ex)
        {
            Paths.Log("local file: " + ex.Message);
            e.Response = env.CreateWebResourceResponse(null, 500, "Error", "");
        }
    }

    // ------------------------------------------------------------------ files from other launches

    public void OpenFiles(string[] paths)
    {
        if (!_jsReady)
        {
            _pendingFiles.AddRange(paths);
            return;
        }
        var (files, errors) = ReadMany(paths);
        Post("openFiles", new { files, errors });
    }

    public void BringToFront()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Focus();
        _web.Focus();
    }

    // ------------------------------------------------------------------ closing

    void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_closeConfirmed || !_jsReady)
        {
            WindowPlacement.Save(this);
            return;
        }
        // Let the page decide: hot exit for the last window, save prompts otherwise.
        e.Cancel = true;
        if (_closePending) return;
        _closePending = true;
        _closeAcked = false;
        Post("closeRequested", new { isLast = _app.WindowCount == 1 });

        // If the page is hung and never answers, close anyway (its session was saved as you typed).
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            if (_closePending && !_closeAcked && !_closeConfirmed) ForceClose();
        };
        timer.Start();
    }

    public void ForceClose()
    {
        _closeConfirmed = true;
        Close();
    }
}

/// <summary>Remembers the size and position of the last closed window.</summary>
static class WindowPlacement
{
    sealed record Saved(double Left, double Top, double Width, double Height, bool Maximized);

    public static void Apply(Window w, int index)
    {
        Saved? s = null;
        try
        {
            if (File.Exists(Paths.Placement)) s = JsonSerializer.Deserialize<Saved>(File.ReadAllText(Paths.Placement));
        }
        catch (Exception ex)
        {
            Paths.Log("placement: " + ex.Message);
        }
        if (s == null || s.Width < 300 || s.Height < 200 || !OnScreen(s))
        {
            w.WindowStartupLocation = WindowStartupLocation.CenterScreen;
            return;
        }
        double offset = 28 * index;
        w.WindowStartupLocation = WindowStartupLocation.Manual;
        w.Left = s.Left + offset;
        w.Top = s.Top + offset;
        w.Width = s.Width;
        w.Height = s.Height;
        if (s.Maximized && index == 0) w.WindowState = WindowState.Maximized;
    }

    static bool OnScreen(Saved s) =>
        s.Left + 100 > SystemParameters.VirtualScreenLeft &&
        s.Top + 50 > SystemParameters.VirtualScreenTop &&
        s.Left + 100 < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth &&
        s.Top + 50 < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight;

    public static void Save(Window w)
    {
        try
        {
            var r = w.WindowState == WindowState.Normal ? new Rect(w.Left, w.Top, w.Width, w.Height) : w.RestoreBounds;
            if (r.IsEmpty) return;
            Directory.CreateDirectory(Paths.Root);
            File.WriteAllText(Paths.Placement, JsonSerializer.Serialize(
                new Saved(r.Left, r.Top, r.Width, r.Height, w.WindowState == WindowState.Maximized)));
        }
        catch (Exception ex)
        {
            Paths.Log("save placement: " + ex.Message);
        }
    }
}
