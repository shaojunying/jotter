using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace Jotter;

public partial class App : Application
{
    public static CoreWebView2Environment? WebEnv { get; private set; }

    readonly List<EditorWindow> _windows = [];
    EditorWindow? _lastActive;
    SingleInstance? _single;

    public int WindowCount => _windows.Count;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnUnhandled;

        try
        {
            var files = e.Args.Where(a => !a.StartsWith("--")).Select(Path.GetFullPath).ToArray();

            _single = new SingleInstance();
            if (!_single.TryClaim())
            {
                // Another Jotter is running: hand it the files and quit.
                Native.AllowSetForegroundWindow(Native.ASFW_ANY);
                if (await _single.SendToPrimaryAsync(files))
                {
                    Shutdown();
                    return;
                }
                Paths.Log("primary instance did not answer; starting standalone");
            }
            else
            {
                _single.StartServer(files => Dispatcher.BeginInvoke(() => OnRemoteFiles(files)));
            }

            try
            {
                WebEnv = await CoreWebView2Environment.CreateAsync(null, Paths.WebViewData);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show("没有找到 Microsoft Edge WebView2 运行时，请先安装它。", "Jotter",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Shutdown();
                return;
            }

            SessionEnding += (_, _) => { foreach (var w in _windows.ToList()) w.ForceClose(); };

            var restored = SessionStore.ListIds();
            if (restored.Count == 0)
            {
                OpenWindow(null, files);
            }
            else
            {
                for (int i = 0; i < restored.Count; i++)
                    OpenWindow(restored[i], i == restored.Count - 1 ? files : []);
            }
        }
        catch (Exception ex)
        {
            Paths.Log("startup failed: " + ex);
            MessageBox.Show("Jotter 启动失败：" + ex.Message, "Jotter", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    public EditorWindow OpenWindow(string? windowId, string[] files)
    {
        var w = new EditorWindow(this, windowId ?? Guid.NewGuid().ToString("N"), files);
        WindowPlacement.Apply(w, _windows.Count);
        _windows.Add(w);
        _lastActive = w;
        w.Activated += (_, _) => _lastActive = w;
        w.Closed += (_, _) =>
        {
            _windows.Remove(w);
            if (_lastActive == w) _lastActive = _windows.LastOrDefault();
            if (_windows.Count == 0) Shutdown();
        };
        w.Show();
        return w;
    }

    /// <summary>Jotter was launched again (e.g. a file double-clicked in Explorer).</summary>
    void OnRemoteFiles(string[] files)
    {
        if (files.Length == 0)
        {
            OpenWindow(null, []).BringToFront();
            return;
        }
        var target = _lastActive ?? _windows.LastOrDefault();
        if (target == null) OpenWindow(null, files);
        else
        {
            target.OpenFiles(files);
            target.BringToFront();
        }
    }

    void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Paths.Log("unhandled: " + e.Exception);
        MessageBox.Show("出错了：" + e.Exception.Message + "\n\n详情已写入日志。", "Jotter",
            MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _single?.Dispose();
        base.OnExit(e);
    }
}
