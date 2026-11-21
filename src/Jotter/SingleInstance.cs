using System.IO;
using System.IO.Pipes;
using System.Text.Json;

namespace Jotter;

/// <summary>
/// One Jotter process per user: later launches pass their file arguments to the
/// first one over a named pipe, so double-clicking files opens them as tabs.
/// </summary>
sealed class SingleInstance : IDisposable
{
    readonly string _name = Paths.InstanceKey;
    Mutex? _mutex;
    readonly CancellationTokenSource _cts = new();

    public bool TryClaim()
    {
        _mutex = new Mutex(initiallyOwned: true, @"Local\" + _name, out bool created);
        return created;
    }

    public async Task<bool> SendToPrimaryAsync(string[] files)
    {
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", _name, PipeDirection.Out);
                await client.ConnectAsync(1500);
                var json = JsonSerializer.SerializeToUtf8Bytes(files);
                await client.WriteAsync(json);
                await client.FlushAsync();
                return true;
            }
            catch (Exception ex) when (ex is TimeoutException or IOException)
            {
                await Task.Delay(300);
            }
        }
        return false;
    }

    public void StartServer(Action<string[]> onFiles)
    {
        var token = _cts.Token;
        Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(_name, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await server.WaitForConnectionAsync(token);
                    using var buffer = new MemoryStream();
                    await server.CopyToAsync(buffer, token);
                    var files = JsonSerializer.Deserialize<string[]>(buffer.ToArray()) ?? [];
                    onFiles(files);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    Paths.Log("pipe server: " + ex.Message);
                    await Task.Delay(500, CancellationToken.None);
                }
            }
        }, token);
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _mutex?.ReleaseMutex(); } catch { /* not owned */ }
        _mutex?.Dispose();
    }
}
